// src/redis-types.ts
/**
 * Type definitions for Redis client (optional dependency).
 * 
 * These types are extracted to avoid requiring 'redis' at compile time.
 * The actual Redis module is loaded dynamically at runtime.
 */

/**
 * Minimal type definition for Redis client.
 * 
 * This interface defines the subset of Redis client methods used by the cache managers.
 * It's intentionally minimal to support dynamic imports and avoid tight coupling to
 * specific Redis module versions.
 * 
 * For full type safety with autocomplete, install @types/redis as a dev dependency
 * and import the actual RedisClientType from 'redis'.
 */
export interface RedisClientType {
    isOpen: boolean;
    connect(): Promise<any>; // Changed from Promise<void> to match actual redis module signature
    quit(): Promise<void>;
    disconnect(): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
    del(...keys: string[]): Promise<number>;
    scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string>;
    publish(channel: string, message: string): Promise<number>;
    duplicate(): any; // Returns a new client with same type
    on(event: string, listener: (...args: any[]) => void): this;
}

/**
 * Type guard to check if an object is a Redis client.
 * 
 * @param client - Object to check
 * @returns True if object has Redis client methods
 */
export function isRedisClient(client: any): client is RedisClientType {
    return (
        client &&
        typeof client.connect === 'function' &&
        typeof client.quit === 'function' &&
        typeof client.get === 'function' &&
        typeof client.set === 'function'
    );
}

