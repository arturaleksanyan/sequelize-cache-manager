// Redis Backend Example
// This example shows how to use Redis as a persistence layer for the cache

import { Sequelize, Model, DataTypes } from "sequelize";
import { CacheManager } from "../src/index";

// Define a simple User model
class User extends Model {
    declare id: number;
    declare name: string;
    declare email: string;
}

async function main() {
    // Initialize Sequelize
    const sequelize = new Sequelize("sqlite::memory:", { logging: false });

    User.init(
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            name: DataTypes.STRING,
            email: DataTypes.STRING,
        },
        { sequelize, modelName: "User" }
    );

    await sequelize.sync();

    // Create some users
    await User.bulkCreate([
        { name: "Alice", email: "alice@example.com" },
        { name: "Bob", email: "bob@example.com" },
        { name: "Charlie", email: "charlie@example.com" },
    ]);

    // ============================================================================
    // Example 1: Redis with Connection URL
    // ============================================================================
    console.log("\n=== Example 1: Redis with URL ===");

    const cache1 = new CacheManager(User, {
        keyFields: ["email"],
        ttlMs: 60_000, // 1 minute
        redis: {
            url: "redis://localhost:6379",
            keyPrefix: "myapp:users:", // Custom prefix for keys
        },
    });

    await cache1.autoLoad();
    console.log("Cache loaded. Stats:", cache1.getStats());

    // Data is now in both memory and Redis
    const user = await cache1.getById(1);
    console.log("User from cache:", user);

    await cache1.destroy();

    // ============================================================================
    // Example 2: Redis with Host/Port Configuration
    // ============================================================================
    console.log("\n=== Example 2: Redis with Host/Port ===");

    const cache2 = new CacheManager(User, {
        redis: {
            host: "localhost",
            port: 6379,
            db: 0, // Redis database number
            password: undefined, // Set if Redis requires authentication
        },
    });

    await cache2.autoLoad();
    console.log("Cache size:", cache2.size());

    await cache2.destroy();

    // ============================================================================
    // Example 3: Using an External Redis Client
    // ============================================================================
    console.log("\n=== Example 3: External Redis Client ===");

    // If you already have a Redis client, you can pass it directly
    // This is useful if you want to share a Redis connection pool
    /*
    import { createClient } from 'redis';
    
    const redisClient = createClient({ url: 'redis://localhost:6379' });
    await redisClient.connect();
    
    const cache3 = new CacheManager(User, {
      redis: {
        client: redisClient, // Use existing client
        keyPrefix: "myapp:users:",
      },
    });
    
    await cache3.autoLoad();
    
    // Both use the same Redis connection
    await redisClient.set('custom:key', 'value');
    
    await cache3.destroy();
    await redisClient.quit();
    */

    // ============================================================================
    // Example 4: Graceful Degradation (Redis Optional)
    // ============================================================================
    console.log("\n=== Example 4: Graceful Degradation ===");

    // If Redis is not available, cache will fall back to memory-only mode
    const cache4 = new CacheManager(User, {
        redis: {
            url: "redis://nonexistent:6379", // This will fail gracefully
        },
    });

    await cache4.autoLoad();
    console.log("Cache still works in memory-only mode");
    console.log("User count:", cache4.size());

    await cache4.destroy();

    // ============================================================================
    // Example 5: Cache Persistence and Recovery
    // ============================================================================
    console.log("\n=== Example 5: Cache Persistence ===");

    // First instance: populate cache
    const cache5a = new CacheManager(User, {
        redis: {
            url: "redis://localhost:6379",
            keyPrefix: "persistent:users:",
        },
        ttlMs: null, // No expiry for this demo
    });

    await cache5a.autoLoad();
    console.log("First instance loaded:", cache5a.size(), "users");
    await cache5a.destroy();

    // Second instance: recover from Redis
    const cache5b = new CacheManager(User, {
        redis: {
            url: "redis://localhost:6379",
            keyPrefix: "persistent:users:",
        },
        ttlMs: null,
    });

    // Data should be recovered from Redis even without calling sync()
    const recovered = await cache5b.getById(1);
    console.log("Recovered from Redis:", recovered);

    await cache5b.destroy();

    // ============================================================================
    // Example 6: Monitoring Redis Operations
    // ============================================================================
    console.log("\n=== Example 6: Monitoring Redis ===");

    const cache6 = new CacheManager(User, {
        redis: {
            url: "redis://localhost:6379",
        },
        logger: {
            info: console.log,
            warn: console.warn,
            error: (...args) => console.error("❌", ...args),
        },
    });

    // Listen to cache events
    cache6.on("error", (err) => {
        console.error("Cache error:", err.message);
    });

    cache6.on("synced", () => {
        console.log("✓ Cache synced with database");
    });

    await cache6.autoLoad();
    await cache6.destroy();

    console.log("\n✅ All Redis examples completed!");
}

// Run examples
main().catch(console.error);

