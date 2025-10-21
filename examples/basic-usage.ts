/**
 * Basic Usage Example for sequelize-cache-manager
 * 
 * This example demonstrates the core features of the cache manager.
 */

import { Sequelize, Model, DataTypes } from 'sequelize';
import { CacheManager } from '../src';

// Define a User model
class User extends Model {
    declare id: number;
    declare email: string;
    declare name: string;
    declare createdAt: Date;
    declare updatedAt: Date;
}

async function main() {
    // Initialize Sequelize with SQLite in-memory database
    const sequelize = new Sequelize('sqlite::memory:', {
        logging: false
    });

    // Initialize User model
    User.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        email: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        }
    }, {
        sequelize,
        modelName: 'User',
        timestamps: true
    });

    // Sync database
    await sequelize.sync();

    // Create some test data
    await User.bulkCreate([
        { email: 'john@example.com', name: 'John Doe' },
        { email: 'jane@example.com', name: 'Jane Smith' },
        { email: 'bob@example.com', name: 'Bob Johnson' }
    ]);

    console.log('✓ Created test users');

    // Create cache manager with multiple key fields
    const userCache = new CacheManager(User, {
        keyFields: ['email'],          // Index by email
        ttlMs: 60000,                  // 1 minute TTL
        refreshIntervalMs: 300000,     // Refresh every 5 minutes
        lazyReload: true,              // Auto-fetch missing entries
        staleWhileRevalidate: true,    // Return stale data while refreshing
        logger: {
            info: (msg: string) => console.log(`[Cache] ${msg}`),
            warn: (msg: string) => console.warn(`[Cache] ${msg}`),
            error: (msg: string) => console.error(`[Cache] ${msg}`)
        }
    });

    // Subscribe to cache events
    userCache.on('synced', () => {
        console.log('✓ Cache synchronized');
    });

    userCache.on('itemCreated', (user: any) => {
        console.log(`✓ User created: ${user.name}`);
    });

    userCache.on('itemUpdated', (user: any) => {
        console.log(`✓ User updated: ${user.name}`);
    });

    // Initialize cache (sync + hooks + auto-refresh)
    await userCache.autoLoad();

    console.log('\n--- Cache Queries ---\n');

    // Query by ID
    const user1 = await userCache.getById(1);
    console.log('getById(1):', user1?.name);

    // Query by email
    const user2 = await userCache.getByKey('email', 'jane@example.com');
    console.log('getByKey(email):', user2?.name);

    // Get all users
    const allUsers = userCache.getAll();
    console.log('getAll():', allUsers.length, 'users');

    // Bulk fetch by email
    const emails = ['john@example.com', 'bob@example.com', 'nonexistent@example.com'];
    const results = await userCache.getManyByKey('email', emails);
    console.log('\nBulk fetch results:');
    emails.forEach(email => {
        const user = results[email];
        console.log(`  ${email}: ${user ? user.name : 'Not found'}`);
    });

    console.log('\n--- Test Lazy Loading ---\n');

    // Create a new user directly in DB (bypassing cache)
    const newUser = await User.create({
        email: 'alice@example.com',
        name: 'Alice Wonder'
    });
    console.log('Created new user in DB:', newUser.name);

    // Due to hooks, the cache should be updated automatically
    await new Promise(resolve => setTimeout(resolve, 100));

    const cachedAlice = await userCache.getByKey('email', 'alice@example.com');
    console.log('Fetched from cache:', cachedAlice?.name);

    console.log('\n--- Test Updates ---\n');

    // Update a user
    const userToUpdate = await User.findOne({ where: { email: 'john@example.com' } });
    if (userToUpdate) {
        userToUpdate.name = 'John Updated';
        await userToUpdate.save();
    }

    // Check cache
    await new Promise(resolve => setTimeout(resolve, 100));
    const updatedUser = await userCache.getByKey('email', 'john@example.com');
    console.log('Updated user in cache:', updatedUser?.name);

    console.log('\n--- Export/Import ---\n');

    // Export cache to JSON
    const cacheData = userCache.toJSON();
    console.log('Exported cache:', cacheData.length, 'entries');

    // Clear and reload
    userCache.clear();
    console.log('After clear:', userCache.getAll().length, 'entries');

    userCache.loadFromJSON(cacheData);
    console.log('After import:', userCache.getAll().length, 'entries');

    console.log('\n--- Cleanup ---\n');

    // Cleanup
    userCache.destroy();
    console.log('✓ Cache destroyed');

    await sequelize.close();
    console.log('✓ Database connection closed');
}

// Run the example
main().catch(console.error);

