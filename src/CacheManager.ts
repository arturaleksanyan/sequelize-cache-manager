// src/CacheManager.ts
import { EventEmitter } from "events";
import { Model, Op } from "sequelize";
import { CacheManagerOptions, PlainRecord, RedisOptions } from "./types";

type CacheEntry = { data: PlainRecord; expiresAt: number };

interface SequelizeModel<T extends Model = any> {
    name: string;
    findByPk(pk: any): Promise<T | null>;
    findAll(options?: any): Promise<T[]>;
    findOne(options?: any): Promise<T | null>;
    addHook(...args: any[]): any;
    removeHook(...args: any[]): any;
    getAttributes?: () => Record<string, any>;
}

export class CacheManager<T extends Model> extends EventEmitter {
    private model: SequelizeModel<T>;
    private keyFields: string[];
    private refreshIntervalMs: number;
    private ttlMs: number | null;
    private cleanupIntervalMs: number;
    private lazyReload: boolean;
    private staleWhileRevalidate: boolean;
    private logger: any;
    private redisClient: any = null; // RedisClientType from 'redis' (optional dep, so using any)
    private redisSubscriber: any = null; // Separate client for Pub/Sub
    private redisKeyPrefix: string = "";
    private redisEnabled: boolean = false;
    private clusterSyncEnabled: boolean = false;

    private cache: { id: Record<string, CacheEntry>; byKey: Record<string, Record<string, CacheEntry>> } = { id: {}, byKey: {} };
    private refreshTimer: NodeJS.Timeout | null = null;
    private cleanupTimer: NodeJS.Timeout | null = null;
    private syncing = false;
    private loadingPromises: Record<string, Promise<any>> = {};
    private lastSyncAt: number | null = null;
    private lastAutoSync = 0;
    private minAutoSyncInterval: number;
    private readyPromise: Promise<void> | null = null;
    private ready: boolean = false;

    constructor(model: typeof Model & SequelizeModel<T>, options: CacheManagerOptions<T> = {}) {
        super();
        this.model = model as any;
        this.keyFields = Array.isArray(options.keyFields) ? options.keyFields : [options.keyFields ?? "id"];
        this.refreshIntervalMs = options.refreshIntervalMs ?? 5 * 60 * 1000;
        this.ttlMs = options.ttlMs ?? null;
        this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 1000;
        this.lazyReload = options.lazyReload ?? true;
        this.staleWhileRevalidate = options.staleWhileRevalidate ?? true;
        this.logger = options.logger ?? console;
        this.minAutoSyncInterval = options.minAutoSyncInterval ?? 10_000;

        // Initialize Redis if configured
        if (options.redis) {
            this._initRedis(options.redis);
        }
    }

    private async _initRedis(redisOptions: RedisOptions) {
        try {
            // Use provided client or create new one
            if (redisOptions.client) {
                this.redisClient = redisOptions.client;
                this.redisEnabled = true;
            } else {
                // Try to dynamically require redis
                let redis: any;
                try {
                    redis = await (Function('return import("redis")')() as Promise<any>);
                } catch {
                    this.logger.warn?.('Redis module not found. Install with: npm install redis');
                    return;
                }

                // Configure reconnect strategy
                const reconnectConfig = redisOptions.reconnectStrategy ?? {};
                const retries = reconnectConfig.retries ?? 10;
                const factor = reconnectConfig.factor ?? 2;
                const minTimeout = reconnectConfig.minTimeout ?? 1000;
                const maxTimeout = reconnectConfig.maxTimeout ?? 30000;

                const clientOptions: any = {
                    url: redisOptions.url,
                    socket: {
                        ...(redisOptions.host ? {
                            host: redisOptions.host,
                            port: redisOptions.port ?? 6379
                        } : {}),
                        // Exponential backoff reconnection strategy
                        reconnectStrategy: (attempt: number) => {
                            if (attempt > retries) {
                                this.logger.error?.(`Redis reconnect failed after ${retries} attempts`);
                                return new Error(`Max reconnection attempts (${retries}) exceeded`);
                            }
                            const delay = Math.min(minTimeout * Math.pow(factor, attempt - 1), maxTimeout);
                            this.logger.info?.(`Redis reconnecting (attempt ${attempt}/${retries}) in ${delay}ms...`);
                            this.emit('redisReconnecting', { attempt, delay });
                            return delay;
                        }
                    },
                    password: redisOptions.password,
                    database: redisOptions.db ?? 0,
                };

                this.redisClient = redis.createClient(clientOptions);

                // Connection event handlers
                this.redisClient.on('error', (err: Error) => {
                    this.logger.error?.('Redis client error:', err);
                    this.emit('error', err);
                });

                this.redisClient.on('connect', () => {
                    this.logger.info?.('Redis connected successfully');
                });

                this.redisClient.on('ready', () => {
                    this.logger.info?.('Redis client ready');
                    this.emit('redisReconnected');
                });

                this.redisClient.on('end', () => {
                    this.logger.warn?.('Redis connection closed');
                    this.emit('redisDisconnected');
                });

                await this.redisClient.connect();
                this.redisEnabled = true;
            }

            this.redisKeyPrefix = redisOptions.keyPrefix ?? `cache:${this.model.name}:`;
            this.logger.info?.(`Redis backend enabled for ${this.model.name}`);

            // Initialize Pub/Sub for cluster-wide cache sync if enabled
            if (redisOptions.enableClusterSync) {
                await this._initClusterSync();
            }
        } catch (err) {
            this.logger.error?.('Failed to initialize Redis:', err);
            this.redisEnabled = false;
        }
    }

    private async _initClusterSync() {
        try {
            // Create a separate subscriber client (Redis requirement)
            // It inherits the reconnection strategy from the main client
            this.redisSubscriber = this.redisClient.duplicate();

            // Add event handlers for subscriber
            this.redisSubscriber.on('error', (err: Error) => {
                this.logger.error?.('Redis subscriber error:', err);
            });

            this.redisSubscriber.on('ready', () => {
                this.logger.info?.('Redis subscriber reconnected');
            });

            await this.redisSubscriber.connect();

            const channel = `${this.redisKeyPrefix}invalidate`;

            // Subscribe to invalidation messages
            await this.redisSubscriber.subscribe(channel, (message: string) => {
                try {
                    const { field, value, source } = JSON.parse(message);

                    // Ignore messages from this instance
                    if (source === this._instanceId) return;

                    this.logger.debug?.(`Cluster invalidation received: ${field}=${value}`);

                    // Invalidate locally without re-publishing
                    if (field && value !== undefined) {
                        const entry = this.cache.byKey?.[field]?.[String(value)];
                        if (entry) {
                            const id = entry.data.id;
                            this._removeById(id);
                            for (const kf of this.keyFields) {
                                const kv = entry.data[kf];
                                if (kv !== undefined && kv !== null) {
                                    this._removeByKey(kf, kv);
                                }
                            }
                        }
                    }
                } catch (err) {
                    this.logger.error?.('Error processing cluster invalidation:', err);
                }
            });

            // Publish local invalidations to cluster
            this.on('itemInvalidated', ({ field, value }) => {
                if (this.clusterSyncEnabled && this.redisClient) {
                    const message = JSON.stringify({ field, value, source: this._instanceId });
                    this.redisClient.publish(channel, message)
                        .catch((err: Error) => this.logger.error?.('Pub/Sub publish failed:', err));
                }
            });

            this.clusterSyncEnabled = true;
            this.logger.info?.(`Redis cluster sync enabled for ${this.model.name}`);
        } catch (err) {
            this.logger.error?.('Failed to initialize cluster sync:', err);
            this.clusterSyncEnabled = false;
        }
    }

    // Unique instance identifier for cluster sync
    private _instanceId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    private _getExpiryTime() { return this.ttlMs ? Date.now() + this.ttlMs : Infinity; }

    private _deepClone<T>(obj: T): T {
        if (obj === null || typeof obj !== "object") return obj;
        if (obj instanceof Date) return new Date(obj.getTime()) as any;
        if (Array.isArray(obj)) return obj.map(o => this._deepClone(o)) as any;
        const result: any = {};
        for (const [k, v] of Object.entries(obj)) result[k] = this._deepClone(v);
        return result;
    }

    private _setItem(instance: T) {
        const plain = instance.get ? instance.get({ plain: true }) : { ...(instance as any) };
        const expiresAt = this._getExpiryTime();
        const entry: CacheEntry = { data: plain, expiresAt };

        // Warn if id is missing and not in keyFields
        if (plain.id === undefined && !this.keyFields.includes("id")) {
            this.logger.warn?.(`Model ${this.model.name} has no 'id' field, caching may be inconsistent`);
        }

        // store by id as canonical entry
        this.cache.id[plain.id] = entry;

        for (const keyField of this.keyFields) {
            const keyValue = plain[keyField];
            if (keyValue !== undefined && keyValue !== null) {
                if (!this.cache.byKey[keyField]) this.cache.byKey[keyField] = {};
                this.cache.byKey[keyField][String(keyValue)] = entry; // share reference
            }
        }

        // Persist to Redis if enabled (fire-and-forget for performance)
        if (this.redisEnabled && this.redisClient) {
            const key = `${this.redisKeyPrefix}${plain.id}`;
            const ttlSeconds = this.ttlMs ? Math.ceil(this.ttlMs / 1000) : undefined;
            if (ttlSeconds) {
                this.redisClient.set(key, JSON.stringify(entry), { EX: ttlSeconds })
                    .catch((err: Error) => this.logger.error?.('Redis set failed:', err));
            } else {
                this.redisClient.set(key, JSON.stringify(entry))
                    .catch((err: Error) => this.logger.error?.('Redis set failed:', err));
            }
        }

        // Log memory usage periodically and warn if too large
        const cacheSize = Object.keys(this.cache.id).length;
        if (cacheSize % 1000 === 0 && cacheSize > 0) {
            this.logger.info?.(`${this.model.name} cache size: ${cacheSize} entries`);
        }
        if (cacheSize > 50_000 && cacheSize % 10_000 === 0) {
            this.logger.warn?.(`Cache size exceeded ${cacheSize} for ${this.model.name}, consider TTL tuning.`);
        }
    }

    private _removeById(id: string | number) {
        delete this.cache.id[String(id)];

        // Remove from Redis if enabled (fire-and-forget for performance)
        if (this.redisEnabled && this.redisClient) {
            const key = `${this.redisKeyPrefix}${id}`;
            this.redisClient.del(key)
                .catch((err: Error) => this.logger.error?.('Redis delete failed:', err));
        }
    }
    private _removeByKey(field: string, value: string | number) { if (this.cache.byKey[field]) delete this.cache.byKey[field][String(value)]; }

    private _removeItem(instance: T) {
        const id = (instance as any).id ?? instance.get?.("id");
        this._removeById(id);
        for (const k of this.keyFields) {
            const v = (instance as any)[k] ?? instance.get?.(k);
            if (v !== undefined) this._removeByKey(k, v);
        }
    }

    private _cleanupExpired() {
        if (!this.ttlMs || this.syncing) return;
        const now = Date.now();
        try {
            for (const [id, entry] of Object.entries(this.cache.id)) {
                if (entry.expiresAt < now) this._removeById(id);
            }
            for (const [field, values] of Object.entries(this.cache.byKey)) {
                for (const [value, entry] of Object.entries(values)) {
                    if (entry.expiresAt < now) this._removeByKey(field, value);
                }
            }
        } catch (err) {
            this.logger.error?.("Error during cache cleanup:", err);
        }
    }

    startCleanup() {
        if (!this.ttlMs) return;
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this.cleanupTimer = setInterval(() => this._cleanupExpired(), this.cleanupIntervalMs);
        this.logger.info?.(`TTL cleanup active for ${this.model.name} (TTL: ${this.ttlMs} ms, cleanup interval: ${this.cleanupIntervalMs} ms)`);
    }

    stopCleanup() { if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; } }

    private async _lazyLoadById(id: string | number, emitEvent = true) {
        if (!this.lazyReload) return undefined;
        const key = `id:${id}`;
        if (!this.loadingPromises[key]) {
            this.loadingPromises[key] = this.model.findByPk(id)
                .then((instance: T | null) => {
                    if (instance) {
                        this._setItem(instance);
                        if (emitEvent) this.emit("refreshedItem", instance.get({ plain: true }));
                        return instance.get({ plain: true });
                    }
                    return null;
                })
                .catch(err => {
                    this.logger.error?.(`Lazy load failed for ${key}:`, err);
                    this.emit("error", err instanceof Error ? err : new Error(String(err)));
                    return null;
                })
                .finally(() => delete this.loadingPromises[key]);
        }
        return this.loadingPromises[key];
    }

    private async _lazyLoadByKey(field: string, value: string | number, emitEvent = true) {
        if (!this.lazyReload) return undefined;
        const key = `key:${field}:${String(value)}`;
        if (!this.loadingPromises[key]) {
            const where: any = {};
            where[field] = value;
            this.loadingPromises[key] = this.model.findOne({ where })
                .then((instance: T | null) => {
                    if (instance) {
                        this._setItem(instance);
                        if (emitEvent) this.emit("refreshedItem", instance.get({ plain: true }));
                        return instance.get({ plain: true });
                    }
                    return null;
                })
                .catch(err => {
                    this.logger.error?.(`Lazy load failed for ${key}:`, err);
                    this.emit("error", err instanceof Error ? err : new Error(String(err)));
                    return null;
                })
                .finally(() => delete this.loadingPromises[key]);
        }
        return this.loadingPromises[key];
    }

    async getById(id: string | number) {
        let entry = this.cache.id[String(id)];
        const now = Date.now();

        // Try Redis if not in memory and Redis is enabled
        if (!entry && this.redisEnabled && this.redisClient) {
            try {
                const key = `${this.redisKeyPrefix}${id}`;
                const cached = await this.redisClient.get(key);
                if (cached) {
                    entry = JSON.parse(cached);
                    this.cache.id[String(id)] = entry; // Restore to memory
                }
            } catch (err) {
                this.logger.error?.('Redis get failed:', err);
            }
        }

        if (!entry) return await this._lazyLoadById(id);
        if (this.ttlMs && entry.expiresAt < now) {
            if (this.staleWhileRevalidate) {
                this._lazyLoadById(id);
                return entry.data;
            } else {
                return await this._lazyLoadById(id, true);
            }
        }
        return entry.data;
    }

    async getByKey(field: string, value: string | number) {
        const entry = this.cache.byKey?.[field]?.[String(value)];
        const now = Date.now();
        if (!entry) return await this._lazyLoadByKey(field, value);
        if (this.ttlMs && entry.expiresAt < now) {
            if (this.staleWhileRevalidate) {
                this._lazyLoadByKey(field, value);
                return entry.data;
            } else {
                return await this._lazyLoadByKey(field, value, true);
            }
        }
        return entry.data;
    }

    getAll() {
        const now = Date.now();
        return Object.values(this.cache.id)
            .filter(e => !this.ttlMs || e.expiresAt > now)
            .map(e => e.data);
    }

    async clear(field?: string) {
        if (!field) {
            this.cache = { id: {}, byKey: {} };

            // Clear Redis if enabled (using SCAN for better performance)
            if (this.redisEnabled && this.redisClient) {
                try {
                    for await (const key of this.redisClient.scanIterator({
                        MATCH: `${this.redisKeyPrefix}*`,
                        COUNT: 100
                    })) {
                        this.redisClient.del(key).catch((err: Error) =>
                            this.logger.error?.('Redis delete failed:', err)
                        );
                    }
                } catch (err) {
                    this.logger.error?.('Redis clear failed:', err);
                }
            }

            this.emit("cleared");
            return;
        }
        delete this.cache.byKey[field];
        this.emit("clearedField", field);
    }

    async sync(incremental = true) {
        if (this.syncing) {
            this.logger.warn?.(`Sync already in progress for ${this.model.name}, skipping.`);
            return;
        }
        this.syncing = true;
        try {
            if (incremental && this.lastSyncAt) {
                // Check if model has updatedAt field
                const hasUpdatedAt = this.model.getAttributes ?
                    'updatedAt' in this.model.getAttributes() :
                    true; // Assume it exists if getAttributes is not available

                if (!hasUpdatedAt) {
                    this.logger.info?.(`Model ${this.model.name} has no updatedAt field — using full sync always`);
                    incremental = false;
                }
            }

            if (incremental && this.lastSyncAt) {
                // incremental sync by updatedAt
                const rows = await this.model.findAll({ where: { updatedAt: { [Op.gt]: new Date(this.lastSyncAt) } } });
                rows.forEach((r: T) => this._setItem(r));
                if (rows.length === 0) {
                    this.logger.debug?.(`No new updates for ${this.model.name}`);
                } else {
                    this.logger.info?.(`Incremental synced ${rows.length} items for ${this.model.name}`);
                }
            } else {
                const data = await this.model.findAll();
                await this.clear();

                // Batch Redis writes for full sync (performance optimization)
                if (this.redisEnabled && this.redisClient && data.length > 0) {
                    try {
                        const pipeline = this.redisClient.multi();
                        const ttlSeconds = this.ttlMs ? Math.ceil(this.ttlMs / 1000) : undefined;

                        data.forEach((item: T) => {
                            const plain = item.get ? item.get({ plain: true }) : { ...(item as any) };
                            const expiresAt = this._getExpiryTime();
                            const entry = { data: plain, expiresAt };
                            const key = `${this.redisKeyPrefix}${plain.id}`;

                            if (ttlSeconds) {
                                pipeline.set(key, JSON.stringify(entry), { EX: ttlSeconds });
                            } else {
                                pipeline.set(key, JSON.stringify(entry));
                            }
                        });

                        await pipeline.exec();
                    } catch (err) {
                        this.logger.error?.('Redis batch write failed:', err);
                    }
                }

                data.forEach((item: T) => this._setItem(item));
                this.logger.info?.(`Full synced ${data.length} items for ${this.model.name}`);
            }
            this.lastSyncAt = Date.now();
            this.emit("synced");
        } catch (err) {
            this.logger.error?.("Error syncing cache:", err);
            this.emit("error", err instanceof Error ? err : new Error(String(err)));
        } finally { this.syncing = false; }
    }

    attachHooks() {
        const m = this.model;
        // keep a reference to bound handlers so we can remove them later
        const created = (i: any) => { this._setItem(i); this.emit("itemCreated", i.get?.({ plain: true }) ?? i); };
        const updated = (i: any) => { this._setItem(i); this.emit("itemUpdated", i.get?.({ plain: true }) ?? i); };
        const destroyed = (i: any) => { this._removeItem(i); this.emit("itemRemoved", i.get?.({ plain: true }) ?? i); };

        // save references to remove later
        (this as any)._hookRefs = { created, updated, destroyed };

        m.addHook("afterCreate", created);
        m.addHook("afterUpdate", updated);
        m.addHook("afterDestroy", destroyed);

        this.logger.info?.(`Cache hooks attached to ${m.name}`);
    }

    detachHooks() {
        const m = this.model;
        const refs = (this as any)._hookRefs;
        if (!refs) return;

        const tryRemove = (type: string, fn: (...args: any[]) => void) => {
            try {
                m.removeHook(type, fn as any);
            } catch (err) {
                this.logger.warn?.(`Failed to remove ${type} hook for ${m.name}:`, err);
            }
        };

        tryRemove("afterCreate", refs.created);
        tryRemove("afterUpdate", refs.updated);
        tryRemove("afterDestroy", refs.destroyed);

        delete (this as any)._hookRefs;
        this.logger.info?.(`Cache hooks detached from ${m.name}`);
    }

    async autoLoad() {
        this.readyPromise = this.sync(false).then(() => {
            this.attachHooks();
            this.startAutoRefresh();
            this.startCleanup();
            this.ready = true;
            this.emit("ready");
        });
        await this.readyPromise;
    }

    async waitUntilReady() {
        if (this.readyPromise) {
            await this.readyPromise;
        }
    }

    isReady(): boolean {
        return this.ready;
    }

    startAutoRefresh() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = setInterval(async () => {
            if (Date.now() - this.lastAutoSync < this.minAutoSyncInterval) return;
            this.lastAutoSync = Date.now();
            try { await this.sync(true); this.emit("refreshed"); this.logger.info?.(`Auto-refreshed ${this.model.name}`); }
            catch (err) { this.logger.error?.("Auto-refresh failed:", err); this.emit("error", err instanceof Error ? err : new Error(String(err))); }
        }, this.refreshIntervalMs);
        this.logger.info?.(`Auto-refresh started for ${this.model.name}`);
    }

    stopAutoRefresh() { if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; this.logger.info?.("Auto-refresh stopped"); } }

    async destroy() {
        this.stopAutoRefresh();
        this.stopCleanup();
        this.detachHooks();
        this.removeAllListeners();
        await this.clear();

        // Disconnect Redis subscriber if enabled
        if (this.redisSubscriber) {
            try {
                await this.redisSubscriber.unsubscribe();
                if (this.redisSubscriber.isOpen) {
                    await this.redisSubscriber.quit();
                }
            } catch (err) {
                this.logger.error?.('Redis subscriber disconnect failed:', err);
            }
        }

        // Disconnect Redis if enabled
        if (this.redisEnabled && this.redisClient) {
            try {
                if (this.redisClient.isOpen) {
                    await this.redisClient.quit();
                }
            } catch (err) {
                this.logger.error?.('Redis disconnect failed:', err);
            }
        }

        this.ready = false;
        this.logger.info?.(`${this.model.name} cache destroyed`);
    }

    async refresh(forceFull = false) {
        await this.sync(!forceFull);
    }

    handleProcessSignals() {
        const cleanup = () => {
            this.logger.info?.("Received termination signal, cleaning up cache...");
            this.destroy();
        };
        process.on("SIGTERM", cleanup);
        process.on("SIGINT", cleanup);
    }

    // --- utilities ---
    invalidate(field: string, value: string | number) {
        this._removeByKey(field, value);
        this.emit("itemInvalidated", { field, value });
    }

    has(field: string, value: string | number): boolean {
        return !!this.cache.byKey?.[field]?.[String(value)];
    }

    hasById(id: string | number): boolean {
        return !!this.cache.id[String(id)];
    }

    isExpired(id: string | number): boolean {
        const entry = this.cache.id[String(id)];
        return !!(entry && this.ttlMs && entry.expiresAt < Date.now());
    }

    getStats() {
        return {
            total: Object.keys(this.cache.id).length,
            byKey: Object.entries(this.cache.byKey).reduce((acc, [field, values]) => {
                acc[field] = Object.keys(values).length;
                return acc;
            }, {} as Record<string, number>),
            lastSyncAt: this.lastSyncAt,
            ttlMs: this.ttlMs,
            syncing: this.syncing,
            refreshIntervalMs: this.refreshIntervalMs,
            lazyReload: this.lazyReload,
            staleWhileRevalidate: this.staleWhileRevalidate,
        };
    }

    size(): number {
        return Object.keys(this.cache.id).length;
    }

    toJSON(includeMeta = false) {
        if (includeMeta) {
            return Object.values(this.cache.id).map(entry => ({
                data: this._deepClone(entry.data),
                expiresAt: entry.expiresAt
            }));
        }
        return this.getAll().map(item => this._deepClone(item));
    }

    loadFromJSON(arr: PlainRecord[] | Array<{ data: PlainRecord; expiresAt: number }>, hasMeta = false) {
        const now = Date.now();
        let loaded = 0;

        if (hasMeta) {
            // Load with metadata
            (arr as Array<{ data: PlainRecord; expiresAt: number }>).forEach(({ data, expiresAt }) => {
                // Skip expired entries
                if (this.ttlMs && expiresAt < now) return;

                const entry: CacheEntry = { data, expiresAt };
                this.cache.id[data.id] = entry;

                for (const keyField of this.keyFields) {
                    const keyValue = data[keyField];
                    if (keyValue !== undefined && keyValue !== null) {
                        if (!this.cache.byKey[keyField]) this.cache.byKey[keyField] = {};
                        this.cache.byKey[keyField][String(keyValue)] = entry;
                    }
                }
                loaded++;
            });
            this.logger.info?.(`Loaded ${loaded}/${arr.length} ${this.model.name} items from JSON (${arr.length - loaded} expired)`);
        } else {
            // Load without metadata (legacy format)
            (arr as PlainRecord[]).forEach(obj => {
                this._setItem({ get: () => ({ ...obj }), ...obj } as any);
                loaded++;
            });
            this.logger.info?.(`Loaded ${loaded} ${this.model.name} items from JSON`);
        }
    }

    /**
     * Preload cache from an external source (e.g., file, snapshot).
     * @param source - Async function that returns array of records
     */
    async preload(source: () => Promise<PlainRecord[]>) {
        const items = await source();
        this.loadFromJSON(items);
        this.logger.info?.(`Preloaded ${items.length} ${this.model.name} items into cache`);
    }

    /**
     * Debug utility: dump cache contents for inspection.
     * @param limit - Maximum number of entries to return
     * @returns Array of cache entries with metadata
     */
    dump(limit = 10) {
        return Object.entries(this.cache.id)
            .slice(0, limit)
            .map(([id, entry]) => ({
                id,
                keys: Object.entries(this.cache.byKey)
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    .filter(([_key, vals]) => Object.values(vals).includes(entry))
                    .map(([field]) => field),
                expiresAt: entry.expiresAt,
                expired: this.ttlMs ? entry.expiresAt < Date.now() : false,
                data: entry.data,
            }));
    }

    /**
     * Bulk fetch items by key. Missing items are fetched from DB in a single query.
     * @param field - The field name to query by
     * @param values - Array of values to fetch
     * @returns Object mapping values to their records (or null if not found)
     */
    async getManyByKey(field: string, values: Array<string | number>) {
        const result: Record<string, PlainRecord | null> = {};
        const missing: Array<string | number> = [];
        for (const v of values) {
            const entry = this.cache.byKey?.[field]?.[String(v)];
            if (entry && (!this.ttlMs || entry.expiresAt > Date.now())) result[String(v)] = entry.data;
            else missing.push(v);
        }

        if (missing.length === 0) return result;

        // fetch missing with a single query
        const rows = await this.model.findAll({ where: { [field]: { [Op.in]: missing } } });
        rows.forEach((r: any) => this._setItem(r));

        for (const v of missing) {
            const entry = this.cache.byKey?.[field]?.[String(v)];
            result[String(v)] = entry ? entry.data : null;
        }

        return result;
    }
}

