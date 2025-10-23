// src/MultiModelCacheManager.ts
import { EventEmitter } from "events";
import { Model } from "sequelize";
import { CacheManager } from "./CacheManager";
import { CacheManagerOptions, PlainRecord, CacheLogger, CacheStats } from "./types";
import { RedisClientType } from "./redis-types";

/**
 * Multi-model cache manager that orchestrates multiple CacheManager instances.
 * 
 * Provides a unified interface for managing cache across multiple Sequelize models,
 * with automatic namespacing, event forwarding, and bulk operations.
 * 
 * **Redis Connection Sharing**: When Redis is configured, a single Redis client
 * is created and shared across all models for efficient resource usage.
 * 
 * **Cluster Sync**: Each individual CacheManager handles its own Pub/Sub subscriber
 * when `enableClusterSync: true` is set. This allows per-model invalidation across
 * instances. For cross-model invalidation patterns, consider application-level
 * coordination or Redis keyspace notifications.
 * 
 * **Event Handling**: Events are forwarded with `{ model: string, ...data }` context.
 * Shared Redis events use `model: 'shared'`. Use event filters to distinguish:
 * ```typescript
 * multiCache.on('redisReconnected', (data) => {
 *   if (data.model === 'shared') {
 *     console.log('Shared Redis reconnected');
 *   } else {
 *     console.log(`${data.model} Redis subscriber reconnected`);
 *   }
 * });
 * ```
 * 
 * @example
 * const multiCache = new MultiModelCacheManager({
 *   User: User,
 *   Product: Product,
 *   Order: Order
 * }, {
 *   ttlMs: 300000,
 *   redis: { 
 *     url: 'redis://localhost:6379',
 *     enableClusterSync: true  // Each model gets its own subscriber
 *   }
 * });
 * 
 * await multiCache.init();
 * const user = await multiCache.getById('User', 123);
 */
export class MultiModelCacheManager extends EventEmitter {
    private managers: Map<string, CacheManager<any>> = new Map();
    private models: Record<string, typeof Model>;
    private baseOptions: CacheManagerOptions<any>;
    private initialized: boolean = false;
    private sharedRedisClient: RedisClientType | null = null; // Shared Redis client across all models
    private logger: CacheLogger; // Logger instance (defaults to console)

    /**
     * Create a multi-model cache manager.
     * 
     * @param models - Record mapping model names to Sequelize model classes
     * @param options - Base cache manager options applied to all models
     */
    constructor(
        models: Record<string, typeof Model>,
        options: CacheManagerOptions<any> = {}
    ) {
        super();
        this.models = models;
        this.baseOptions = options;
        this.logger = options.logger ?? console;
    }

    /**
     * Initialize all cache managers and auto-load their data.
     * 
     * Creates a single shared Redis client (if Redis is configured), then creates
     * a CacheManager instance for each model with namespaced Redis keys. All models
     * share the same Redis connection for efficiency.
     * 
     * @returns Promise that resolves when all cache managers are initialized
     * @throws Error if initialization fails for any model
     */
    async init(): Promise<void> {
        if (this.initialized) {
            throw new Error("MultiModelCacheManager is already initialized");
        }

        // Create shared Redis client if Redis is configured (unless client is already provided)
        if (this.baseOptions.redis && !this.baseOptions.redis.client) {
            await this._initSharedRedis();
        }

        const initPromises: Promise<void>[] = [];

        for (const [modelName, ModelClass] of Object.entries(this.models)) {
            // Clone options and namespace Redis key prefix per model
            const modelOptions: CacheManagerOptions<any> = {
                ...this.baseOptions,
            };

            // Configure Redis with shared client and model-specific key prefix
            if (modelOptions.redis) {
                modelOptions.redis = {
                    ...modelOptions.redis,
                    client: this.sharedRedisClient || modelOptions.redis.client, // Use shared client
                    keyPrefix: modelOptions.redis.keyPrefix
                        ? `${modelOptions.redis.keyPrefix}${modelName}:`
                        : `cache:${modelName}:`,
                };
            }

            const manager = new CacheManager(ModelClass as any, modelOptions);

            // Forward all cache events with model name context
            this._forwardEvents(manager, modelName);

            this.managers.set(modelName, manager);

            // Queue autoLoad for parallel initialization
            initPromises.push(
                manager.autoLoad().catch((err) => {
                    throw new Error(`Failed to initialize cache for model ${modelName}: ${err.message}`);
                })
            );
        }

        await Promise.all(initPromises);
        this.initialized = true;
        this.emit("initialized", { models: Object.keys(this.models) });
    }

    /**
     * Initialize a shared Redis client for all models.
     * 
     * Uses dynamic import to load the optional 'redis' dependency at runtime.
     * This approach requires:
     * - Node.js 12.20+ or 14.13+ (for dynamic import support)
     * - TypeScript with esModuleInterop: true (already configured)
     * - Works with both CommonJS and ESM module systems
     * 
     * @private
     * @returns Promise that resolves when Redis client is connected
     * @throws Error if Redis module is not installed or connection fails
     */
    private async _initSharedRedis(): Promise<void> {
        if (!this.baseOptions.redis) return;

        try {
            // Dynamically import redis module (handles optional dependency)
            // Using dynamic import with .catch() for cleaner error handling
            // Handle both ESM and CommonJS module formats
            const redisModule = await import('redis').catch(() => {
                throw new Error('Redis module not found. Install with: npm install redis');
            });
            const redis = (redisModule as any).default ?? redisModule;

            const redisOptions = this.baseOptions.redis;
            const reconnectConfig = redisOptions.reconnectStrategy ?? {};
            const retries = reconnectConfig.retries ?? 10;
            const factor = reconnectConfig.factor ?? 2;
            const minTimeout = reconnectConfig.minTimeout ?? 1000;
            const maxTimeout = reconnectConfig.maxTimeout ?? 30000;

            // Build client options
            // Precedence: url > host/port (if both provided, url takes priority)
            const clientOptions: any = {
                url: redisOptions.url,
                socket: {
                    // Only use host/port if url is not provided
                    ...(redisOptions.host && !redisOptions.url ? {
                        host: redisOptions.host,
                        port: redisOptions.port ?? 6379
                    } : {}),
                    // Exponential backoff reconnection strategy
                    reconnectStrategy: (attempt: number) => {
                        if (attempt > retries) {
                            this.logger.error?.(`Redis reconnect failed after ${retries} attempts`);
                            // Return null to stop reconnection attempts (per node-redis docs)
                            return null;
                        }
                        const delay = Math.min(minTimeout * Math.pow(factor, attempt - 1), maxTimeout);
                        this.logger.info?.(`Redis reconnecting (attempt ${attempt}/${retries}) in ${delay}ms...`);
                        return delay;
                    }
                },
                password: redisOptions.password,
                database: redisOptions.db ?? 0,
            };

            const client = redis.createClient(clientOptions);
            // Cast to our RedisClientType interface for type safety
            // This works because our interface matches the actual Redis client API
            this.sharedRedisClient = client as unknown as RedisClientType;

            // Connection event handlers
            client.on('error', (err: Error) => {
                this.logger.error?.('Shared Redis client error:', err);
                this.emit('error', { model: 'shared', error: err });
            });

            client.on('connect', () => {
                this.logger.info?.('Shared Redis client connected');
            });

            client.on('ready', () => {
                this.logger.info?.('Shared Redis client ready');
                // Emit with 'shared' model context to distinguish from per-model events
                this.emit('redisReconnected', { model: 'shared', source: 'shared-client' });
            });

            client.on('end', () => {
                this.logger.warn?.('Shared Redis connection closed');
                // Emit with 'shared' model context to distinguish from per-model events
                this.emit('redisDisconnected', { model: 'shared', source: 'shared-client' });
            });

            // Connect with retry logic for ephemeral Redis instances
            const maxRetries = 3;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    await client.connect();
                    this.logger.info?.('Shared Redis client initialized for all models');
                    this.logger.debug?.(`Redis config: url=${redisOptions.url || 'none'}, host=${redisOptions.host || 'none'}, db=${redisOptions.db ?? 0}`);
                    return; // Success
                } catch (err) {
                    lastError = err as Error;
                    if (attempt < maxRetries) {
                        const delay = attempt * 1000; // 1s, 2s, 3s
                        this.logger.warn?.(`Redis connection attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }

            // All retries failed
            this.logger.error?.('Failed to initialize shared Redis client after retries:', lastError);
            throw lastError;

        } catch (err) {
            this.logger.error?.('Failed to initialize shared Redis client:', err);
            throw err;
        }
    }

    /**
     * Forward events from a CacheManager to this MultiModelCacheManager with model context.
     * 
     * @private
     * @param manager - The CacheManager instance to forward events from
     * @param modelName - The name of the model for event context
     */
    private _forwardEvents(manager: CacheManager<any>, modelName: string): void {
        // Forward lifecycle events
        manager.on("ready", () => this.emit("ready", { model: modelName }));
        manager.on("synced", () => this.emit("synced", { model: modelName }));
        manager.on("refreshed", () => this.emit("refreshed", { model: modelName }));
        manager.on("cleared", () => this.emit("cleared", { model: modelName }));

        // Forward item events with data
        manager.on("itemCreated", (item) => this.emit("itemCreated", { model: modelName, item }));
        manager.on("itemUpdated", (item) => this.emit("itemUpdated", { model: modelName, item }));
        manager.on("itemRemoved", (item) => this.emit("itemRemoved", { model: modelName, item }));
        manager.on("refreshedItem", (item) => this.emit("refreshedItem", { model: modelName, item }));
        manager.on("itemInvalidated", (data) => this.emit("itemInvalidated", { model: modelName, ...data }));
        manager.on("clearedField", (field) => this.emit("clearedField", { model: modelName, field }));
        manager.on("evicted", (data) => this.emit("evicted", { model: modelName, ...data }));

        // Forward Redis events
        // Note: redisReconnecting has data, but redisReconnected/redisDisconnected don't emit data
        manager.on("redisReconnecting", (data) => this.emit("redisReconnecting", { model: modelName, ...data }));
        manager.on("redisReconnected", () => this.emit("redisReconnected", { model: modelName }));
        manager.on("redisDisconnected", () => this.emit("redisDisconnected", { model: modelName }));

        // Forward errors with model context
        manager.on("error", (err) => this.emit("error", { model: modelName, error: err }));
    }

    /**
     * Get the CacheManager instance for a specific model.
     * 
     * @param modelName - The name of the model
     * @returns The CacheManager instance for the model
     * @throws Error if model name is not found or manager not initialized
     */
    getManager(modelName: string): CacheManager<any> {
        this._assertInitialized();
        const manager = this.managers.get(modelName);
        if (!manager) {
            throw new Error(`No cache manager found for model: ${modelName}`);
        }
        return manager;
    }

    /**
     * Retrieve a record by its primary key ID.
     * 
     * @param modelName - The name of the model
     * @param id - The primary key ID of the record
     * @returns The cached record or null/undefined if not found
     * @throws Error if model name is not found
     */
    async getById(modelName: string, id: string | number): Promise<PlainRecord | null | undefined> {
        this.logger.debug?.(`MultiCache.getById: model=${modelName}, id=${id}`);
        return this.getManager(modelName).getById(id);
    }

    /**
     * Retrieve a record by a custom indexed key field.
     * 
     * @param modelName - The name of the model
     * @param field - The key field name (must be in keyFields config)
     * @param value - The value to look up
     * @returns The cached record or null/undefined if not found
     * @throws Error if model name is not found
     */
    async getByKey(
        modelName: string,
        field: string,
        value: string | number
    ): Promise<PlainRecord | null | undefined> {
        this.logger.debug?.(`MultiCache.getByKey: model=${modelName}, field=${field}, value=${value}`);
        return this.getManager(modelName).getByKey(field, value);
    }

    /**
     * Bulk retrieve multiple records by a custom indexed key field.
     * 
     * @param modelName - The name of the model
     * @param field - The key field name (must be in keyFields config)
     * @param values - Array of values to look up
     * @returns Record mapping string keys to cached records (null for missing entries)
     * @throws Error if model name is not found
     */
    async getManyByKey(
        modelName: string,
        field: string,
        values: Array<string | number>
    ): Promise<Record<string, PlainRecord | null>> {
        return this.getManager(modelName).getManyByKey(field, values);
    }

    /**
     * Preload cache for a model from an external async data source.
     * 
     * Useful for warming cache from external APIs, files, or other data sources
     * without hitting the database.
     * 
     * @param modelName - The name of the model
     * @param source - Async function that returns an array of plain records
     * @returns Promise that resolves when preload is complete
     * @throws Error if model name is not found
     */
    async preload(modelName: string, source: () => Promise<PlainRecord[]>): Promise<void> {
        return this.getManager(modelName).preload(source);
    }

    /**
     * Clear cache for a specific model or all models.
     * 
     * @param modelName - Optional model name. If omitted, clears all models.
     * @returns Promise that resolves when clear is complete
     */
    async clear(modelName?: string): Promise<void> {
        if (modelName) {
            this.logger.debug?.(`MultiCache.clear: model=${modelName}`);
            await this.getManager(modelName).clear();
        } else {
            this.logger.debug?.('MultiCache.clear: all models');
            await Promise.all(
                Array.from(this.managers.values()).map((manager) => manager.clear())
            );
        }
    }

    /**
     * Manually trigger a cache refresh for a specific model or all models.
     * 
     * @param modelName - Optional model name. If omitted, refreshes all models.
     * @param forceFull - If true, forces full sync instead of incremental (default: false)
     * @returns Promise that resolves when refresh is complete
     */
    async refresh(modelName?: string, forceFull: boolean = false): Promise<void> {
        if (modelName) {
            await this.getManager(modelName).refresh(forceFull);
        } else {
            await Promise.all(
                Array.from(this.managers.values()).map((manager) => manager.refresh(forceFull))
            );
        }
    }

    /**
     * Destroy all cache managers and free resources.
     * 
     * Stops auto-refresh, disconnects Redis, removes hooks, and clears all caches.
     * The shared Redis client is disconnected last after all managers are destroyed.
     * Each manager destruction is wrapped in try/catch to ensure one failure doesn't block others.
     * After calling this, the MultiModelCacheManager cannot be reused.
     * 
     * @returns Promise that resolves when all managers are destroyed
     */
    async destroy(): Promise<void> {
        // Destroy all individual cache managers first (with error isolation)
        const destroyPromises = Array.from(this.managers.entries()).map(async ([modelName, manager]) => {
            try {
                await manager.destroy();
                this.logger.debug?.(`Successfully destroyed cache manager for ${modelName}`);
                return { modelName, success: true };
            } catch (err) {
                this.logger.error?.(`Failed to destroy cache manager for ${modelName}:`, err);
                // Continue destroying other managers even if one fails
                return { modelName, success: false, error: err };
            }
        });

        const results = await Promise.allSettled(destroyPromises);

        // Log summary
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        const failed = results.length - successful;
        if (failed > 0) {
            this.logger.warn?.(`Destroyed ${successful}/${results.length} cache managers (${failed} failed)`);
        } else {
            this.logger.debug?.(`Successfully destroyed all ${successful} cache managers`);
        }

        this.managers.clear();

        // Disconnect shared Redis client if we created it
        if (this.sharedRedisClient && !this.baseOptions.redis?.client) {
            try {
                if (this.sharedRedisClient.isOpen) {
                    await this.sharedRedisClient.quit();
                    this.logger.info?.('Shared Redis client disconnected');
                }
            } catch (err) {
                this.logger.error?.('Failed to disconnect shared Redis client:', err);
            }
            this.sharedRedisClient = null;
        }

        this.removeAllListeners();
        this.initialized = false;
        this.emit("destroyed");
    }

    /**
     * Get cache statistics for a specific model or all models.
     * 
     * @param modelName - Optional model name. If omitted, returns stats for all models.
     * @returns Cache statistics object or record of stats per model
     */
    getStats(modelName?: string): CacheStats | Record<string, CacheStats> {
        this._assertInitialized();

        if (modelName) {
            return this.getManager(modelName).getStats();
        }

        // Return stats for all models
        const allStats: Record<string, CacheStats> = {};
        for (const [name, manager] of this.managers.entries()) {
            allStats[name] = manager.getStats();
        }
        return allStats;
    }

    /**
     * Check if the multi-model cache manager is initialized.
     * 
     * @returns True if initialized, false otherwise
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Get the list of all registered model names.
     * 
     * @returns Array of model names
     */
    getModelNames(): string[] {
        return Array.from(this.managers.keys());
    }

    /**
     * Check if a specific model is registered.
     * 
     * @param modelName - The name of the model to check
     * @returns True if the model is registered, false otherwise
     */
    hasModel(modelName: string): boolean {
        return this.managers.has(modelName);
    }

    /**
     * Get a copy of all cache managers.
     * 
     * Returns a new Map to prevent external modifications to the internal managers.
     * Useful for advanced scenarios like custom event handling or metrics collection.
     * 
     * @returns Map of model names to their cache managers
     * @example
     * ```typescript
     * const managers = multiCache.getManagers();
     * for (const [modelName, manager] of managers) {
     *   console.log(`${modelName}: ${manager.size()} items`);
     * }
     * ```
     */
    getManagers(): Map<string, CacheManager<any>> {
        this._assertInitialized();
        return new Map(this.managers);
    }

    /**
     * Wait for all cache managers to be ready.
     * 
     * @param timeoutMs - Optional timeout in milliseconds (default: 30000ms / 30s)
     * @returns Promise that resolves when all managers are ready
     * @throws Error if timeout is exceeded before all managers are ready
     */
    async waitUntilReady(timeoutMs: number = 30000): Promise<void> {
        this._assertInitialized();

        const readyPromise = Promise.all(
            Array.from(this.managers.values()).map((manager) => manager.waitUntilReady())
        );

        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`waitUntilReady timeout exceeded (${timeoutMs}ms)`));
            }, timeoutMs);
        });

        try {
            await Promise.race([
                readyPromise.finally(() => timeoutHandle && clearTimeout(timeoutHandle)),
                timeoutPromise
            ]);
        } finally {
            // Ensure timeout is always cleared
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    /**
     * Invalidate a specific cached item across a model.
     * 
     * @param modelName - The name of the model
     * @param field - The key field name
     * @param value - The value to invalidate
     */
    invalidate(modelName: string, field: string, value: string | number): void {
        this.logger.debug?.(`MultiCache.invalidate: model=${modelName}, field=${field}, value=${value}`);
        this.getManager(modelName).invalidate(field, value);
    }

    /**
     * Get all cached records for a specific model.
     * 
     * @param modelName - The name of the model
     * @returns Array of all cached records (excluding expired items if TTL is set)
     * @throws Error if model name is not found
     */
    getAll(modelName: string): PlainRecord[] {
        return this.getManager(modelName).getAll();
    }

    /**
     * Export cache data for a specific model as JSON.
     * 
     * @param modelName - The name of the model
     * @param includeMeta - If true, includes metadata (expiry times)
     * @returns Serializable cache data (array of records or array of {data, expiresAt})
     * @throws Error if model name is not found
     */
    toJSON(modelName: string, includeMeta: boolean = false): PlainRecord[] | Array<{ data: PlainRecord; expiresAt: number }> {
        return this.getManager(modelName).toJSON(includeMeta);
    }

    /**
     * Import cache data for a specific model from JSON.
     * 
     * @param modelName - The name of the model
     * @param data - Previously exported cache data
     * @param hasMeta - If true, expects metadata in the data
     * @throws Error if model name is not found
     */
    loadFromJSON(
        modelName: string,
        data: PlainRecord[] | Array<{ data: PlainRecord; expiresAt: number }>,
        hasMeta: boolean = false
    ): void {
        this.getManager(modelName).loadFromJSON(data, hasMeta);
    }

    /**
     * Get the size (number of cached items) for a specific model or all models.
     * 
     * @param modelName - Optional model name. If omitted, returns sizes for all models.
     * @returns Cache size or record of sizes per model
     */
    size(modelName?: string): number | Record<string, number> {
        this._assertInitialized();

        if (modelName) {
            return this.getManager(modelName).size();
        }

        // Return sizes for all models
        const allSizes: Record<string, number> = {};
        for (const [name, manager] of this.managers.entries()) {
            allSizes[name] = manager.size();
        }
        return allSizes; // TypeScript already infers Record<string, number>
    }

    /**
     * Assert that the manager is initialized, throw error if not.
     * 
     * @private
     * @throws Error if not initialized
     */
    private _assertInitialized(): void {
        if (!this.initialized) {
            throw new Error("MultiModelCacheManager is not initialized. Call init() first.");
        }
    }
}

