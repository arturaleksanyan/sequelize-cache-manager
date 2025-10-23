/**
 * Multi-Model Cache Manager with Redis Backend
 * 
 * This example demonstrates:
 * - Shared Redis connection across multiple models
 * - Cluster-wide cache synchronization
 * - Event monitoring
 * - Graceful shutdown
 */

import { Sequelize, Model, DataTypes } from 'sequelize';
import { MultiModelCacheManager } from '../src';

// Initialize Sequelize
const sequelize = new Sequelize('sqlite::memory:', {
    logging: false,
});

// Define User model
class User extends Model {
    public id!: number;
    public name!: string;
    public email!: string;
}

User.init(
    {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        email: { type: DataTypes.STRING },
    },
    { sequelize, modelName: 'User', timestamps: true }
);

// Define Product model
class Product extends Model {
    public id!: number;
    public name!: string;
    public sku!: string;
}

Product.init(
    {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        sku: { type: DataTypes.STRING },
    },
    { sequelize, modelName: 'Product', timestamps: true }
);

async function main() {
    console.log('🚀 Multi-Model Cache Manager - Redis Example\n');

    // Sync database
    await sequelize.sync({ force: true });

    // Create sample data
    console.log('📝 Creating sample data...');
    await User.bulkCreate([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
    ]);

    await Product.bulkCreate([
        { id: 1, name: 'Widget', sku: 'WDG-001' },
        { id: 2, name: 'Gadget', sku: 'GDG-001' },
    ]);

    // Initialize Multi-Model Cache Manager with Redis
    console.log('⚙️  Initializing cache manager with Redis...\n');
    const multiCache = new MultiModelCacheManager(
        { User, Product },
        {
            ttlMs: 300000,
            refreshIntervalMs: 60000,
            keyFields: ['email', 'sku'],
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                password: process.env.REDIS_PASSWORD,
                // Enable cluster sync for multi-instance invalidation
                enableClusterSync: true,
                // Custom reconnection strategy
                reconnectStrategy: {
                    retries: 5,
                    factor: 2,
                    minTimeout: 1000,
                    maxTimeout: 10000,
                },
            },
        }
    );

    // Set up event listeners for monitoring
    console.log('📡 Setting up event listeners...\n');

    multiCache.on('ready', (data) => {
        console.log(`✅ Cache ready for model: ${data.model}`);
    });

    multiCache.on('synced', (data) => {
        console.log(`🔄 Cache synced for model: ${data.model}`);
    });

    multiCache.on('error', (data) => {
        console.error(`❌ Error in model ${data.model}:`, data.error.message);
    });

    // Redis connection events
    multiCache.on('redisReconnecting', (data) => {
        console.log(`🔌 Redis reconnecting for ${data.model}...`);
    });

    multiCache.on('redisReconnected', (data) => {
        console.log(`✅ Redis reconnected for ${data.model || 'shared'}`);
    });

    multiCache.on('redisDisconnected', (data) => {
        console.log(`⚠️  Redis disconnected for ${data.model || 'shared'}`);
    });

    // Initialize and wait for all models
    await multiCache.init();
    await multiCache.waitUntilReady(10000); // 10 second timeout
    console.log('\n✅ All cache managers ready with Redis!\n');

    // Example 1: Basic operations with Redis backend
    console.log('📖 Example 1: Operations with Redis persistence');
    const user = await multiCache.getById('User', 1);
    console.log('User from cache:', user);

    const product = await multiCache.getByKey('Product', 'sku', 'WDG-001');
    console.log('Product from cache:', product);
    console.log();

    // Example 2: Cache statistics with Redis info
    console.log('📊 Example 2: Cache statistics');
    const stats = multiCache.getStats() as Record<string, any>;
    console.log('User stats:', {
        total: stats.User.total,
        redisEnabled: stats.User.redisEnabled,
        clusterSyncEnabled: stats.User.clusterSyncEnabled,
    });
    console.log('Product stats:', {
        total: stats.Product.total,
        redisEnabled: stats.Product.redisEnabled,
        clusterSyncEnabled: stats.Product.clusterSyncEnabled,
    });
    console.log();

    // Example 3: Export/Import with Redis
    console.log('📦 Example 3: Export/Import cache data');
    const exportedData = multiCache.toJSON('User', true);
    console.log(`Exported ${exportedData.length} users with metadata`);

    await multiCache.clear('User');
    console.log(`Cleared User cache. Size: ${multiCache.size('User')}`);

    multiCache.loadFromJSON('User', exportedData, true);
    console.log(`Imported users back. Size: ${multiCache.size('User')}`);
    console.log();

    // Example 4: Cluster-wide invalidation
    console.log('🌐 Example 4: Cluster-wide invalidation');
    console.log('Invalidating User 1 across all instances...');
    await multiCache.invalidate('User', 'id', 1);
    console.log('User 1 invalidated. This will sync across all instances via Redis Pub/Sub');
    console.log();

    // Example 5: Manual refresh
    console.log('🔄 Example 5: Manual refresh');
    await multiCache.refresh('Product', true);
    console.log('Product cache refreshed from database');
    console.log();

    // Example 6: Get all cache managers for custom operations
    console.log('🎛️  Example 6: Advanced manager access');
    const managers = multiCache.getManagers();
    console.log('Available managers:', Array.from(managers.keys()));

    for (const [modelName, manager] of managers) {
        const modelStats = manager.getStats();
        console.log(`${modelName}: ${modelStats.total} items, last sync: ${modelStats.lastSyncAt ? new Date(modelStats.lastSyncAt).toISOString() : 'never'}`);
    }
    console.log();

    // Example 7: Graceful shutdown
    console.log('🛑 Example 7: Graceful shutdown with Redis cleanup');

    // Set up SIGTERM handler for production
    const shutdownHandler = async () => {
        console.log('\n📡 Received shutdown signal, cleaning up...');
        await multiCache.destroy();
        await sequelize.close();
        console.log('✅ Graceful shutdown complete');
        process.exit(0);
    };

    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);

    // Simulate some work
    console.log('💤 Simulating application work (Ctrl+C to trigger shutdown)...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Manual cleanup for example
    console.log('\n🧹 Cleaning up...');
    await multiCache.destroy();
    await sequelize.close();
    console.log('✅ Done!');
}

// Run the example
main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

