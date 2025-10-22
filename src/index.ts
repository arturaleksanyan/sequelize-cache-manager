// src/index.ts
export { CacheManager } from "./CacheManager";
export * from "./types";

// Type-safe event declarations using module augmentation
import { Model } from "sequelize";
import { CacheManagerEvents } from "./types";

declare module "./CacheManager" {
    interface CacheManager<T extends Model> {
        on<U extends keyof CacheManagerEvents>(
            event: U,
            listener: (...args: CacheManagerEvents[U]) => void
        ): this;

        once<U extends keyof CacheManagerEvents>(
            event: U,
            listener: (...args: CacheManagerEvents[U]) => void
        ): this;

        emit<U extends keyof CacheManagerEvents>(
            event: U,
            ...args: CacheManagerEvents[U]
        ): boolean;
    }
}

