import { EventEmitter } from "events";
import { Model, Op } from "sequelize";
import { CacheManagerOptions, PlainRecord } from "./types";

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

    private cache: { id: Record<string, CacheEntry>; byKey: Record<string, Record<string, CacheEntry>> } = { id: {}, byKey: {} };
    private refreshTimer: NodeJS.Timeout | null = null;
    private cleanupTimer: NodeJS.Timeout | null = null;
    private syncing = false;
    private loadingPromises: Record<string, Promise<any>> = {};
    private lastSyncAt: number | null = null;
    private lastAutoSync = 0;
    private minAutoSyncInterval: number;
    private readyPromise: Promise<void> | null = null;

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
    }

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

        // Log memory usage periodically
        const cacheSize = Object.keys(this.cache.id).length;
        if (cacheSize % 1000 === 0 && cacheSize > 0) {
            this.logger.info?.(`${this.model.name} cache size: ${cacheSize} entries`);
        }
    }

    private _removeById(id: string | number) { delete this.cache.id[String(id)]; }
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
        const entry = this.cache.id[String(id)];
        const now = Date.now();
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

    clear(field?: string) {
        if (!field) {
            this.cache = { id: {}, byKey: {} };
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
                    this.logger.warn?.(`Model ${this.model.name} has no updatedAt field — falling back to full sync`);
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
                this.clear();
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

        const tryRemove = (type: string, fn: Function) => {
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
        });
        await this.readyPromise;
    }

    async waitUntilReady() {
        if (this.readyPromise) {
            await this.readyPromise;
        }
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

    destroy() { this.stopAutoRefresh(); this.stopCleanup(); this.detachHooks(); this.removeAllListeners(); this.clear(); this.logger.info?.(`${this.model.name} cache destroyed`); }

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
        if (hasMeta) {
            // Load with metadata
            (arr as Array<{ data: PlainRecord; expiresAt: number }>).forEach(({ data, expiresAt }) => {
                const entry: CacheEntry = { data, expiresAt };
                this.cache.id[data.id] = entry;

                for (const keyField of this.keyFields) {
                    const keyValue = data[keyField];
                    if (keyValue !== undefined && keyValue !== null) {
                        if (!this.cache.byKey[keyField]) this.cache.byKey[keyField] = {};
                        this.cache.byKey[keyField][String(keyValue)] = entry;
                    }
                }
            });
        } else {
            // Load without metadata (legacy format)
            (arr as PlainRecord[]).forEach(obj => {
                this._setItem({ get: () => ({ ...obj }), ...obj } as any);
            });
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
                    .filter(([_, vals]) => Object.values(vals).includes(entry))
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

