// src/types.ts
import { Model } from "sequelize";

export interface RedisOptions {
    url?: string;
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
    client?: any; // External Redis client (RedisClientType from 'redis')
    enableClusterSync?: boolean; // Enable Pub/Sub for multi-instance cache sync
    reconnectStrategy?: {
        retries?: number; // Max reconnection attempts (default: 10)
        factor?: number; // Exponential backoff factor (default: 2)
        minTimeout?: number; // Min delay in ms (default: 1000)
        maxTimeout?: number; // Max delay in ms (default: 30000)
    };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface CacheManagerOptions<T extends Model> {
    keyFields?: string | string[];
    refreshIntervalMs?: number;
    minAutoSyncInterval?: number;
    ttlMs?: number | null;
    cleanupIntervalMs?: number;
    lazyReload?: boolean;
    staleWhileRevalidate?: boolean;
    redis?: RedisOptions;
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
    ready: [];
    redisReconnecting: [{ attempt: number; delay: number }];
    redisReconnected: [];
    redisDisconnected: [];
};

