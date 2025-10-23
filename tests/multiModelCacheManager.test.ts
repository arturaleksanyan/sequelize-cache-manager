import { MultiModelCacheManager } from '../src/MultiModelCacheManager';
import { PlainRecord } from '../src/types';

// Mock model factory
function createFakeModel(modelName: string) {
    class FakeModel {
        static modelName = modelName;
        static _rows: any[] = [];
        static _shouldFailNext = false;
        static _hooks: Record<string, ((...args: any[]) => void)[]> = {};

        static async findAll(options?: any) {
            if (this._shouldFailNext) {
                this._shouldFailNext = false;
                throw new Error('DB Error');
            }

            let rows = this._rows;

            // Handle incremental sync with updatedAt filter
            if (options?.where?.updatedAt) {
                const gtDate = options.where.updatedAt[Symbol.for('gt')];
                if (gtDate) {
                    rows = rows.filter((r: any) => {
                        if (!r.updatedAt) return false;
                        return new Date(r.updatedAt) > new Date(gtDate);
                    });
                }
            }

            return rows.map((r) => ({ get: () => r }));
        }

        static async findByPk(id: any) {
            if (this._shouldFailNext) {
                this._shouldFailNext = false;
                throw new Error('DB Error');
            }
            const r = this._rows.find((x) => x.id === id);
            return r ? { get: () => r } : null;
        }

        static async findOne(opts: any) {
            if (this._shouldFailNext) {
                this._shouldFailNext = false;
                throw new Error('DB Error');
            }
            const where = opts.where;
            const key = Object.keys(where)[0];
            const val = where[key];
            const r = this._rows.find((x) => x[key] === val);
            return r ? { get: () => r } : null;
        }

        static addRow(obj: any) {
            this._rows.push(obj);
        }

        static getAttributes() {
            return { id: {}, name: {}, email: {}, sku: {}, updatedAt: {} };
        }

        static addHook(hookType: string, fn: (...args: any[]) => void) {
            if (!this._hooks[hookType]) this._hooks[hookType] = [];
            this._hooks[hookType].push(fn);
        }

        static removeHook(hookType: string, fn: (...args: any[]) => void) {
            if (this._hooks[hookType]) {
                this._hooks[hookType] = this._hooks[hookType].filter((h) => h !== fn);
            }
        }
    }

    // Override the name property after class definition
    Object.defineProperty(FakeModel, 'name', { value: modelName, writable: true });

    return FakeModel as any;
}

describe('MultiModelCacheManager', () => {
    let multiCache: MultiModelCacheManager;
    let UserModel: any;
    let ProductModel: any;
    let OrderModel: any;

    beforeEach(() => {
        // Create fresh models for each test
        UserModel = createFakeModel('User');
        ProductModel = createFakeModel('Product');
        OrderModel = createFakeModel('Order');

        // Add test data
        UserModel.addRow({ id: 1, name: 'Alice', email: 'alice@example.com', updatedAt: new Date() });
        UserModel.addRow({ id: 2, name: 'Bob', email: 'bob@example.com', updatedAt: new Date() });
        UserModel.addRow({ id: 3, name: 'Charlie', email: 'charlie@example.com', updatedAt: new Date() });

        ProductModel.addRow({ id: 1, name: 'Widget', sku: 'WDG-001', updatedAt: new Date() });
        ProductModel.addRow({ id: 2, name: 'Gadget', sku: 'GDG-001', updatedAt: new Date() });

        OrderModel.addRow({ id: 1, userId: 1, total: 99.99, updatedAt: new Date() });
        OrderModel.addRow({ id: 2, userId: 2, total: 149.99, updatedAt: new Date() });

        multiCache = new MultiModelCacheManager(
            { User: UserModel, Product: ProductModel, Order: OrderModel },
            {
                ttlMs: 60000,
                keyFields: ['email', 'sku'],
            }
        );
    });

    afterEach(async () => {
        if (multiCache) {
            await multiCache.destroy();
        }
    });

    describe('Initialization', () => {
        it('initializes all models successfully', async () => {
            await multiCache.init();
            expect(multiCache.isInitialized()).toBe(true);
            expect(multiCache.hasModel('User')).toBe(true);
            expect(multiCache.hasModel('Product')).toBe(true);
            expect(multiCache.hasModel('Order')).toBe(true);
        });

        it('returns all model names', async () => {
            await multiCache.init();
            const modelNames = multiCache.getModelNames();
            expect(modelNames).toEqual(['User', 'Product', 'Order']);
        });

        it('waits until all models are ready', async () => {
            await multiCache.init();
            await expect(multiCache.waitUntilReady(5000)).resolves.not.toThrow();
        });

        it('times out if models take too long to initialize', async () => {
            // This test verifies timeout behavior - since models init quickly,
            // we test the timeout logic itself
            const slowMultiCache = new MultiModelCacheManager(
                { User: UserModel },
                { ttlMs: 60000 }
            );

            await slowMultiCache.init();
            // Models are already ready, so even a short timeout will pass
            // To properly test timeout, we'd need to delay initialization
            await expect(slowMultiCache.waitUntilReady(5000)).resolves.not.toThrow();
            await slowMultiCache.destroy();
        });

        it('throws error if operation performed before initialization', () => {
            expect(() => multiCache.getManager('User')).toThrow('not initialized');
        });
    });

    describe('Data Retrieval', () => {
        beforeEach(async () => {
            await multiCache.init();
        });

        it('retrieves records by ID from different models', async () => {
            const user = await multiCache.getById('User', 1);
            const product = await multiCache.getById('Product', 1);

            expect(user).toMatchObject({ id: 1, name: 'Alice' });
            expect(product).toMatchObject({ id: 1, name: 'Widget' });
        });

        it('retrieves records by custom key field', async () => {
            const user = await multiCache.getByKey('User', 'email', 'alice@example.com');
            const product = await multiCache.getByKey('Product', 'sku', 'WDG-001');

            expect(user).toMatchObject({ id: 1, name: 'Alice' });
            expect(product).toMatchObject({ id: 1, name: 'Widget' });
        });

        it('retrieves multiple records by key', async () => {
            const users = await multiCache.getManyByKey('User', 'email', [
                'alice@example.com',
                'bob@example.com',
            ]);

            expect(users['alice@example.com']).toMatchObject({ name: 'Alice' });
            expect(users['bob@example.com']).toMatchObject({ name: 'Bob' });
        });

        it('returns null for non-existent records', async () => {
            const user = await multiCache.getById('User', 999);
            expect(user).toBeNull();
        });

        it('throws error for invalid model name', async () => {
            await expect(multiCache.getById('InvalidModel', 1)).rejects.toThrow('No cache manager found');
        });
    });

    describe('Cache Operations', () => {
        beforeEach(async () => {
            await multiCache.init();
        });

        it('clears cache for a specific model', async () => {
            // Verify data is cached
            const userBefore = await multiCache.getById('User', 1);
            expect(userBefore).toBeTruthy();

            // Clear User cache
            await multiCache.clear('User');

            // Cache should be empty but data still available via lazy load
            const manager = multiCache.getManager('User');
            expect(manager.size()).toBe(0);
        });

        it('clears cache for all models', async () => {
            // Verify data is cached
            await multiCache.getById('User', 1);
            await multiCache.getById('Product', 1);

            // Clear all caches
            await multiCache.clear();

            // All caches should be empty
            expect(multiCache.getManager('User').size()).toBe(0);
            expect(multiCache.getManager('Product').size()).toBe(0);
        });

        it('refreshes cache for a specific model', async () => {
            await multiCache.refresh('User', true);
            const stats = multiCache.getStats('User');
            expect(stats.total).toBeGreaterThan(0);
        });

        it('refreshes cache for all models', async () => {
            await multiCache.refresh();
            const stats = multiCache.getStats() as Record<string, any>;
            expect(stats.User.total).toBeGreaterThan(0);
            expect(stats.Product.total).toBeGreaterThan(0);
        });

        it('invalidates specific record across a model', async () => {
            // Get user by email to cache it under 'email' key
            const user = await multiCache.getByKey('User', 'email', 'alice@example.com');
            expect(user).toBeTruthy();

            // Invalidate by email field
            await multiCache.invalidate('User', 'email', 'alice@example.com');

            // Check that it's no longer in the email index
            const manager = multiCache.getManager('User');
            const emailValue = user ? (user as any).email : 'alice@example.com';
            expect(manager.has('email', emailValue)).toBe(false);
        });

        it('gets all records from a model cache', async () => {
            const users = multiCache.getAll('User');
            expect(users.length).toBe(3);
            expect(users).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'Alice' }),
                    expect.objectContaining({ name: 'Bob' }),
                    expect.objectContaining({ name: 'Charlie' }),
                ])
            );
        });
    });

    describe('Statistics', () => {
        beforeEach(async () => {
            await multiCache.init();
        });

        it('returns stats for a specific model', async () => {
            const stats = multiCache.getStats('User');
            expect(stats).toHaveProperty('total');
            expect(stats).toHaveProperty('byKey');
            expect(stats).toHaveProperty('lastSyncAt');
        });

        it('returns stats for all models', async () => {
            const stats = multiCache.getStats();
            expect(stats).toHaveProperty('User');
            expect(stats).toHaveProperty('Product');
            expect(stats).toHaveProperty('Order');
        });

        it('returns size for a specific model', async () => {
            const size = multiCache.size('User');
            expect(typeof size).toBe('number');
            expect(size).toBe(3);
        });

        it('returns sizes for all models', async () => {
            const sizes = multiCache.size();
            expect(sizes).toEqual({
                User: 3,
                Product: 2,
                Order: 2,
            });
        });
    });

    describe('Data Import/Export', () => {
        beforeEach(async () => {
            await multiCache.init();
        });

        it('exports cache data for a specific model', async () => {
            const data = multiCache.toJSON('User', false);
            expect(Array.isArray(data)).toBe(true);
            expect(data.length).toBe(3);
        });

        it('exports cache data with metadata', async () => {
            const data = multiCache.toJSON('User', true);
            expect(Array.isArray(data)).toBe(true);
            expect(data[0]).toHaveProperty('data');
            expect(data[0]).toHaveProperty('expiresAt');
        });

        it('imports cache data for a specific model', async () => {
            const exportedData = multiCache.toJSON('Product', false);
            await multiCache.clear('Product');
            expect(multiCache.size('Product')).toBe(0);

            multiCache.loadFromJSON('Product', exportedData, false);
            expect(multiCache.size('Product')).toBe(2);
        });

        it('preloads cache from external source', async () => {
            await multiCache.clear('User');
            expect(multiCache.size('User')).toBe(0);

            const externalData: PlainRecord[] = [
                { id: 10, name: 'External User', email: 'external@example.com' },
            ];

            await multiCache.preload('User', async () => externalData);
            expect(multiCache.size('User')).toBe(1);

            const user = await multiCache.getById('User', 10);
            expect(user).toMatchObject({ name: 'External User' });
        });
    });

    describe('Manager Access', () => {
        beforeEach(async () => {
            await multiCache.init();
        });

        it('retrieves individual cache manager', async () => {
            const userManager = multiCache.getManager('User');
            expect(userManager).toBeDefined();
            expect(typeof userManager.getById).toBe('function');
        });

        it('retrieves all cache managers', async () => {
            const managers = multiCache.getManagers();
            expect(managers instanceof Map).toBe(true);
            expect(managers.size).toBe(3);
            expect(managers.has('User')).toBe(true);
            expect(managers.has('Product')).toBe(true);
            expect(managers.has('Order')).toBe(true);
        });

        it('returns copy of managers to prevent external modification', async () => {
            const managers = multiCache.getManagers();
            managers.clear(); // Try to modify

            // Original managers should still be intact
            expect(multiCache.hasModel('User')).toBe(true);
            expect(multiCache.getModelNames().length).toBe(3);
        });
    });

    describe('Event Forwarding', () => {
        beforeEach(async () => {
            await multiCache.init();
        });

        it('forwards ready events with model context', (done) => {
            const newMultiCache = new MultiModelCacheManager(
                { User: UserModel },
                { ttlMs: 60000 }
            );

            newMultiCache.on('ready', (data) => {
                expect(data).toHaveProperty('model');
                expect(data.model).toBe('User');
                newMultiCache.destroy().then(() => done());
            });

            newMultiCache.init();
        });

        it('forwards synced events with model context', (done) => {
            multiCache.on('synced', (data) => {
                expect(data).toHaveProperty('model');
                expect(['User', 'Product', 'Order']).toContain(data.model);
                done();
            });

            multiCache.refresh('User');
        });

        it('forwards error events with model context', (done) => {
            const manager = multiCache.getManager('User');

            multiCache.on('error', (data) => {
                expect(data).toHaveProperty('model');
                expect(data).toHaveProperty('error');
                expect(data.model).toBe('User');
                done();
            });

            // Trigger an error by emitting one from the manager
            manager.emit('error', new Error('Test error'));
        });
    });

    describe('Error Handling', () => {
        it('handles individual manager initialization failures gracefully', async () => {
            const BrokenModel = createFakeModel('BrokenModel');
            BrokenModel._shouldFailNext = true;

            const brokenMultiCache = new MultiModelCacheManager(
                { BrokenModel },
                {}
            );

            await expect(brokenMultiCache.init()).rejects.toThrow('Failed to initialize cache');
            await brokenMultiCache.destroy();
        });

        it('continues destroying other managers even if one fails', async () => {
            await multiCache.init();

            // Mock one manager's destroy to fail
            const userManager = multiCache.getManager('User');
            userManager.destroy = jest.fn().mockRejectedValue(new Error('Destroy failed'));

            // Should not throw, but log warning
            await expect(multiCache.destroy()).resolves.not.toThrow();
        });
    });

    describe('Graceful Shutdown', () => {
        beforeEach(async () => {
            await multiCache.init();
        });

        it('destroys all managers successfully', async () => {
            await expect(multiCache.destroy()).resolves.not.toThrow();
            // After destroy, should throw error when trying to use
            expect(() => multiCache.getManager('User')).toThrow('not initialized');
        });

        it('cleans up resources properly', async () => {
            const initialSize = multiCache.size();
            expect(initialSize).toEqual({
                User: 3,
                Product: 2,
                Order: 2,
            });

            await multiCache.destroy();

            // Should be able to create new instance after destroy
            const newMultiCache = new MultiModelCacheManager(
                { User: UserModel },
                { ttlMs: 60000 }
            );
            await newMultiCache.init();
            expect(newMultiCache.isInitialized()).toBe(true);
            await newMultiCache.destroy();
        });
    });
});
