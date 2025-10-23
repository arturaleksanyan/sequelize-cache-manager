/**
 * Advanced Multi-Model Cache Manager Example
 * 
 * This example demonstrates:
 * - Custom logger integration
 * - Health checks and monitoring
 * - Cache preloading from external sources
 * - Error recovery strategies
 * - Performance optimization patterns
 */

import { Sequelize, Model, DataTypes } from 'sequelize';
import { MultiModelCacheManager, CacheLogger } from '../src';

// Custom logger implementation
const customLogger: CacheLogger = {
    info: (message: string, ...args: any[]) => {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
    },
    warn: (message: string, ...args: any[]) => {
        console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
    },
    error: (message: string, ...args: any[]) => {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
    },
    debug: (message: string, ...args: any[]) => {
        if (process.env.DEBUG) {
            console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
        }
    },
};

// Initialize Sequelize
const sequelize = new Sequelize('sqlite::memory:', {
    logging: false,
});

// Define models
class User extends Model {
    public id!: number;
    public name!: string;
    public email!: string;
    public status!: string;
}

User.init(
    {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        email: { type: DataTypes.STRING },
        status: { type: DataTypes.STRING },
    },
    { sequelize, modelName: 'User', timestamps: true }
);

class Product extends Model {
    public id!: number;
    public name!: string;
    public sku!: string;
    public inventory!: number;
}

Product.init(
    {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        sku: { type: DataTypes.STRING },
        inventory: { type: DataTypes.INTEGER },
    },
    { sequelize, modelName: 'Product', timestamps: true }
);

/**
 * Health check function for monitoring
 */
function performHealthCheck(multiCache: MultiModelCacheManager) {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        models: {} as Record<string, any>,
    };

    try {
        if (!multiCache.isInitialized()) {
            health.status = 'unhealthy';
            return health;
        }

        const managers = multiCache.getManagers();
        const stats = multiCache.getStats();

        for (const [modelName, manager] of managers) {
            const modelStats = stats[modelName];
            health.models[modelName] = {
                cached: modelStats.total,
                ready: manager.isReady(),
                lastSync: modelStats.lastSyncAt ? new Date(modelStats.lastSyncAt).toISOString() : null,
                hitRate: modelStats.metrics?.hitRate || 0,
            };
        }
    } catch (error) {
        health.status = 'error';
        health.models = { error: (error as Error).message };
    }

    return health;
}

/**
 * Performance metrics collector
 */
class MetricsCollector {
    private metrics: Record<string, any> = {};

    collect(multiCache: MultiModelCacheManager) {
        const stats = multiCache.getStats();
        const sizes = multiCache.size();

        for (const modelName of multiCache.getModelNames()) {
            const modelStats = stats[modelName];
            this.metrics[modelName] = {
                cacheSize: sizes[modelName],
                hitRate: modelStats.metrics?.hitRate || 0,
                hits: modelStats.metrics?.hits || 0,
                misses: modelStats.metrics?.misses || 0,
                evictions: modelStats.metrics?.evictions || 0,
                lastSync: modelStats.lastSyncAt,
            };
        }

        return this.metrics;
    }

    getMetrics() {
        return this.metrics;
    }

    reset() {
        this.metrics = {};
    }
}

async function main() {
    console.log('🚀 Multi-Model Cache Manager - Advanced Example\n');

    // Sync database
    await sequelize.sync({ force: true });

    // Create sample data
    console.log('📝 Creating sample data...');
    await User.bulkCreate([
        { id: 1, name: 'Alice', email: 'alice@example.com', status: 'active' },
        { id: 2, name: 'Bob', email: 'bob@example.com', status: 'active' },
        { id: 3, name: 'Charlie', email: 'charlie@example.com', status: 'inactive' },
    ]);

    await Product.bulkCreate([
        { id: 1, name: 'Laptop', sku: 'LAP-001', inventory: 50 },
        { id: 2, name: 'Mouse', sku: 'MOU-001', inventory: 200 },
    ]);

    // Example 1: Initialize with custom logger
    console.log('\n📖 Example 1: Custom logger integration');
    const multiCache = new MultiModelCacheManager(
        { User, Product },
        {
            ttlMs: 300000,
            refreshIntervalMs: 60000,
            maxSize: 1000, // LRU eviction after 1000 items
            keyFields: ['email', 'status', 'sku'],
            logger: customLogger,
        }
    );

    await multiCache.init();
    await multiCache.waitUntilReady();
    console.log();

    // Example 2: Health check monitoring
    console.log('📖 Example 2: Health check monitoring');
    const health = performHealthCheck(multiCache);
    console.log('Health check result:', JSON.stringify(health, null, 2));
    console.log();

    // Example 3: Performance metrics collection
    console.log('📖 Example 3: Performance metrics');
    const metricsCollector = new MetricsCollector();

    // Perform some cache operations
    await multiCache.getById('User', 1);
    await multiCache.getById('User', 2);
    await multiCache.getByKey('Product', 'sku', 'LAP-001');

    const metrics = metricsCollector.collect(multiCache);
    console.log('Collected metrics:', JSON.stringify(metrics, null, 2));
    console.log();

    // Example 4: Preload cache from external API
    console.log('📖 Example 4: Preload from external source');

    // Simulate external API data
    const externalUserData = async () => {
        console.log('  Fetching from external API...');
        await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate API delay
        return [
            { id: 100, name: 'External User', email: 'external@api.com', status: 'active' },
            { id: 101, name: 'Another External', email: 'another@api.com', status: 'active' },
        ];
    };

    await multiCache.preload('User', externalUserData);
    console.log(`  Preloaded ${multiCache.size('User')} users (including external data)`);

    const externalUser = await multiCache.getById('User', 100);
    console.log('  External user from cache:', externalUser);
    console.log();

    // Example 5: Event-driven monitoring
    console.log('📖 Example 5: Event-driven monitoring');

    let eventCount = 0;
    const eventMonitor = {
        synced: 0,
        errors: 0,
        invalidations: 0,
    };

    multiCache.on('synced', (data) => {
        eventMonitor.synced++;
        console.log(`  📊 Synced event from ${data.model}`);
    });

    multiCache.on('error', (data) => {
        eventMonitor.errors++;
        console.log(`  ❌ Error event from ${data.model}: ${data.error.message}`);
    });

    multiCache.on('itemInvalidated', (data) => {
        eventMonitor.invalidations++;
        console.log(`  🗑️  Invalidated ${data.field}=${data.value} in ${data.model}`);
    });

    // Trigger some events
    await multiCache.refresh('User');
    await multiCache.invalidate('Product', 'id', 1);

    console.log('  Event summary:', eventMonitor);
    console.log();

    // Example 6: Batch operations for performance
    console.log('📖 Example 6: Batch operations');

    const startTime = Date.now();

    // Get multiple users in parallel
    const userIds = [1, 2, 3];
    const users = await Promise.all(
        userIds.map((id) => multiCache.getById('User', id))
    );

    const elapsed = Date.now() - startTime;
    console.log(`  Retrieved ${users.length} users in ${elapsed}ms`);
    console.log(`  Average: ${(elapsed / users.length).toFixed(2)}ms per user`);
    console.log();

    // Example 7: Error recovery strategy
    console.log('📖 Example 7: Error recovery');

    try {
        // Try to get from non-existent model
        await multiCache.getById('NonExistentModel', 1);
    } catch (error) {
        console.log('  ✅ Caught expected error:', (error as Error).message);

        // Verify other models still work
        const user = await multiCache.getById('User', 1);
        console.log('  ✅ Other models still functional:', user?.name);
    }
    console.log();

    // Example 8: Cache warming strategy
    console.log('📖 Example 8: Cache warming on startup');

    const warmCache = async () => {
        const startTime = Date.now();

        // Refresh all models
        await multiCache.refresh();

        const elapsed = Date.now() - startTime;
        const sizes = multiCache.size();

        console.log(`  Warmed cache in ${elapsed}ms:`);
        for (const [model, size] of Object.entries(sizes)) {
            console.log(`    - ${model}: ${size} items`);
        }
    };

    await warmCache();
    console.log();

    // Example 9: Export for backup/disaster recovery
    console.log('📖 Example 9: Backup and restore');

    const backup: Record<string, any> = {};

    for (const modelName of multiCache.getModelNames()) {
        backup[modelName] = multiCache.toJSON(modelName, true);
        console.log(`  Backed up ${modelName}: ${backup[modelName].length} items`);
    }

    // Simulate cache loss
    await multiCache.clear();
    console.log('  Cache cleared (simulating failure)');

    // Restore from backup
    for (const [modelName, data] of Object.entries(backup)) {
        multiCache.loadFromJSON(modelName, data, true);
        console.log(`  Restored ${modelName}: ${multiCache.size(modelName)} items`);
    }
    console.log();

    // Example 10: Real-time monitoring dashboard
    console.log('📖 Example 10: Real-time monitoring');

    const dashboardData = {
        timestamp: new Date().toISOString(),
        health: performHealthCheck(multiCache),
        metrics: metricsCollector.collect(multiCache),
        sizes: multiCache.size(),
        modelNames: multiCache.getModelNames(),
    };

    console.log('Dashboard data:', JSON.stringify(dashboardData, null, 2));
    console.log();

    // Cleanup
    console.log('🧹 Cleaning up...');
    await multiCache.destroy();
    await sequelize.close();
    console.log('✅ Done!');
}

// Run the example
main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

