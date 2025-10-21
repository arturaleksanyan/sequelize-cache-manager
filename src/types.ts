import { Model } from "sequelize";

export interface CacheManagerOptions<T extends Model> {
    keyFields?: string | string[];
    refreshIntervalMs?: number;
    minAutoSyncInterval?: number;
    ttlMs?: number | null;
    cleanupIntervalMs?: number;
    lazyReload?: boolean;
    staleWhileRevalidate?: boolean;
    logger?: {
        info?: (...args: any[]) => void;
        warn?: (...args: any[]) => void;
        error?: (...args: any[]) => void;
        debug?: (...args: any[]) => void;
    };
}

export type PlainRecord = Record<string, any>;

export type CacheManagerEvents = {
    synced: [];
    refreshed: [];
    refreshedItem: [PlainRecord];
    itemCreated: [PlainRecord];
    itemUpdated: [PlainRecord];
    itemRemoved: [PlainRecord];
    itemInvalidated: [{ field: string; value: string | number }];
    cleared: [];
    clearedField: [string];
    error: [Error];
};

