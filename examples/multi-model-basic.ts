/**
 * Basic Multi-Model Cache Manager Example
 * 
 * This example demonstrates:
 * - Setting up multiple models with a shared cache manager
 * - Basic CRUD operations
 * - Cache statistics
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
    public role!: string;
}

User.init(
    {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        email: { type: DataTypes.STRING, unique: true },
        role: { type: DataTypes.STRING },
    },
    { sequelize, modelName: 'User', timestamps: true }
);

// Define Product model
class Product extends Model {
    public id!: number;
    public name!: string;
    public sku!: string;
    public price!: number;
}

Product.init(
    {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        sku: { type: DataTypes.STRING, unique: true },
        price: { type: DataTypes.REAL },
    },
    { sequelize, modelName: 'Product', timestamps: true }
);

// Define Order model
class Order extends Model {
    public id!: number;
    public userId!: number;
    public productId!: number;
    public quantity!: number;
    public total!: number;
}

Order.init(
    {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: DataTypes.INTEGER },
        productId: { type: DataTypes.INTEGER },
        quantity: { type: DataTypes.INTEGER },
        total: { type: DataTypes.REAL },
    },
    { sequelize, modelName: 'Order', timestamps: true }
);

async function main() {
    console.log('🚀 Multi-Model Cache Manager - Basic Example\n');

    // Sync database
    await sequelize.sync({ force: true });

    // Create sample data
    console.log('📝 Creating sample data...');
    await User.bulkCreate([
        { id: 1, name: 'Alice', email: 'alice@example.com', role: 'admin' },
        { id: 2, name: 'Bob', email: 'bob@example.com', role: 'user' },
        { id: 3, name: 'Charlie', email: 'charlie@example.com', role: 'user' },
    ]);

    await Product.bulkCreate([
        { id: 1, name: 'Laptop', sku: 'LAP-001', price: 999.99 },
        { id: 2, name: 'Mouse', sku: 'MOU-001', price: 29.99 },
        { id: 3, name: 'Keyboard', sku: 'KEY-001', price: 79.99 },
    ]);

    await Order.bulkCreate([
        { id: 1, userId: 1, productId: 1, quantity: 1, total: 999.99 },
        { id: 2, userId: 2, productId: 2, quantity: 2, total: 59.98 },
        { id: 3, userId: 3, productId: 3, quantity: 1, total: 79.99 },
    ]);

    // Initialize Multi-Model Cache Manager
    console.log('⚙️  Initializing cache manager...\n');
    const multiCache = new MultiModelCacheManager(
        { User, Product, Order },
        {
            ttlMs: 300000, // 5 minutes
            refreshIntervalMs: 60000, // Refresh every minute
            keyFields: ['email', 'role', 'sku'],
        }
    );

    // Initialize and wait for all models to be ready
    await multiCache.init();
    await multiCache.waitUntilReady();
    console.log('✅ All cache managers ready!\n');

    // Example 1: Retrieve records by ID
    console.log('📖 Example 1: Get records by ID');
    const user = await multiCache.getById('User', 1);
    const product = await multiCache.getById('Product', 1);
    console.log('User:', user);
    console.log('Product:', product);
    console.log();

    // Example 2: Retrieve records by custom key
    console.log('📖 Example 2: Get records by custom key');
    const userByEmail = await multiCache.getByKey('User', 'email', 'alice@example.com');
    const productBySku = await multiCache.getByKey('Product', 'sku', 'LAP-001');
    console.log('User by email:', userByEmail);
    console.log('Product by SKU:', productBySku);
    console.log();

    // Example 3: Bulk retrieval by key
    console.log('📖 Example 3: Get multiple records by key');
    const usersByEmail = await multiCache.getManyByKey('User', 'email', [
        'alice@example.com',
        'bob@example.com',
    ]);
    console.log('Users by email:', usersByEmail);
    console.log();

    // Example 4: Get all records from a model
    console.log('📖 Example 4: Get all cached records');
    const allUsers = multiCache.getAll('User');
    const allProducts = multiCache.getAll('Product');
    console.log(`All users (${allUsers.length}):`, allUsers.map((u) => u.name));
    console.log(`All products (${allProducts.length}):`, allProducts.map((p) => p.name));
    console.log();

    // Example 5: Cache statistics
    console.log('📊 Example 5: Cache statistics');
    const stats = multiCache.getStats();
    console.log('All stats:', JSON.stringify(stats, null, 2));

    const userStats = multiCache.getStats('User');
    console.log('\nUser stats:', userStats);
    console.log();

    // Example 6: Cache sizes
    console.log('📏 Example 6: Cache sizes');
    const sizes = multiCache.size();
    console.log('Sizes per model:', sizes);
    console.log(`User cache size: ${multiCache.size('User')}`);
    console.log();

    // Example 7: Clear specific model cache
    console.log('🧹 Example 7: Clear cache');
    console.log(`Before clear - User cache size: ${multiCache.size('User')}`);
    await multiCache.clear('User');
    console.log(`After clear - User cache size: ${multiCache.size('User')}`);

    // Refresh to reload
    await multiCache.refresh('User', true);
    console.log(`After refresh - User cache size: ${multiCache.size('User')}`);
    console.log();

    // Example 8: Invalidate specific record
    console.log('❌ Example 8: Invalidate specific record');
    console.log(`Before invalidate - User 1 exists: ${multiCache.getManager('User').hasById(1)}`);
    await multiCache.invalidate('User', 'id', 1);
    console.log(`After invalidate - User 1 exists: ${multiCache.getManager('User').hasById(1)}`);
    console.log();

    // Example 9: Access individual cache manager
    console.log('🎯 Example 9: Direct manager access');
    const userManager = multiCache.getManager('User');
    const hasUser = userManager.hasById(2);
    const userRecord = await userManager.getById(2);
    console.log(`User 2 exists in cache: ${hasUser}`);
    console.log('User 2 record:', userRecord);
    console.log();

    // Example 10: Model names
    console.log('📋 Example 10: Model information');
    const modelNames = multiCache.getModelNames();
    console.log('Managed models:', modelNames);
    console.log(`Has User model: ${multiCache.hasModel('User')}`);
    console.log(`Has InvalidModel: ${multiCache.hasModel('InvalidModel')}`);
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

