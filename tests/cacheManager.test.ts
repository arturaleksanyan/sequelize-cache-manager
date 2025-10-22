import { CacheManager } from "../src/CacheManager";

// We'll stub a minimal model to simulate Sequelize
class FakeModel {
    static modelName = "Fake";
    static _rows: any[] = [];
    static _shouldFailNext = false;
    static _hooks: Record<string, Function[]> = {};

    static async findAll(options?: any) {
        if (this._shouldFailNext) {
            this._shouldFailNext = false;
            throw new Error("DB Error");
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

        return rows.map(r => ({ get: () => r }));
    }

    static async findByPk(id: any) {
        if (this._shouldFailNext) {
            this._shouldFailNext = false;
            throw new Error("DB Error");
        }
        const r = this._rows.find(x => x.id === id);
        return r ? { get: () => r } : null;
    }

    static async findOne(opts: any) {
        if (this._shouldFailNext) {
            this._shouldFailNext = false;
            throw new Error("DB Error");
        }
        const where = opts.where;
        const key = Object.keys(where)[0];
        const val = where[key];
        const r = this._rows.find(x => x[key] === val);
        return r ? { get: () => r } : null;
    }

    static addRow(obj: any) { this._rows.push(obj); }

    static getAttributes() {
        return { id: {}, name: {}, updatedAt: {} };
    }

    static addHook(hookType: string, fn: Function) {
        if (!this._hooks[hookType]) this._hooks[hookType] = [];
        this._hooks[hookType].push(fn);
    }

    static removeHook(hookType: string, fn: Function) {
        if (this._hooks[hookType]) {
            this._hooks[hookType] = this._hooks[hookType].filter(h => h !== fn);
        }
    }
}

// Override the name property after class definition
Object.defineProperty(FakeModel, 'name', { value: 'Fake', writable: true });

describe("CacheManager", () => {
    beforeEach(() => {
        FakeModel._rows = [];
        FakeModel._shouldFailNext = false;
        FakeModel._hooks = {};
    });

    describe("basic operations", () => {
        it("syncs and returns items", async () => {
            FakeModel._rows = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
            const cm = new CacheManager(FakeModel as any, {
                keyFields: ["name"],
                ttlMs: 1000,
                refreshIntervalMs: 60 * 60 * 1000
            });
            await cm.sync(false);
            const all = cm.getAll();
            const item = all.find((x: any) => x.id === 1);
            expect(item).toBeDefined();
            expect(item?.name).toBe("A");
        });

        it("getById returns correct item", async () => {
            FakeModel._rows = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
            const cm = new CacheManager(FakeModel as any, {
                lazyReload: true
            });
            await cm.sync(false);
            const item = await cm.getById(1);
            expect(item?.name).toBe("A");
        });

        it("getByKey returns correct item", async () => {
            FakeModel._rows = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
            const cm = new CacheManager(FakeModel as any, {
                keyFields: ["name"]
            });
            await cm.sync(false);
            const item = await cm.getByKey("name", "B");
            expect(item?.id).toBe(2);
        });
    });

    describe("new features", () => {
        it("getStats returns cache statistics", async () => {
            FakeModel._rows = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
            const cm = new CacheManager(FakeModel as any, {
                keyFields: ["name"],
                ttlMs: 60000
            });
            await cm.sync(false);

            const stats = cm.getStats();
            expect(stats.total).toBe(2);
            expect(stats.byKey.name).toBe(2);
            expect(stats.ttlMs).toBe(60000);
            expect(stats.syncing).toBe(false);
            expect(stats.lazyReload).toBe(true);
            expect(stats.staleWhileRevalidate).toBe(true);
        });

        it("invalidate removes item from cache", async () => {
            FakeModel._rows = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
            const cm = new CacheManager(FakeModel as any, {
                keyFields: ["name"]
            });
            await cm.sync(false);

            const itemBefore = await cm.getByKey("name", "A");
            expect(itemBefore).toBeDefined();

            cm.invalidate("name", "A");

            // Direct cache check (without lazy load)
            const stats = cm.getStats();
            expect(stats.byKey.name).toBe(1);
        });

        it("waitUntilReady waits for autoLoad to complete", async () => {
            FakeModel._rows = [{ id: 1, name: "A" }];
            const cm = new CacheManager(FakeModel as any, {
                logger: { info: () => { }, warn: () => { }, error: () => { } }
            });

            const loadPromise = cm.autoLoad();
            await cm.waitUntilReady();
            await loadPromise;

            const stats = cm.getStats();
            expect(stats.total).toBe(1);

            cm.destroy();
        });

        it("handles lazy load errors gracefully", async () => {
            FakeModel._rows = [{ id: 1, name: "A" }];
            const errors: any[] = [];
            const cm = new CacheManager(FakeModel as any, {
                lazyReload: true,
                logger: {
                    info: () => { },
                    warn: () => { },
                    error: (msg: string, err: any) => errors.push(err)
                }
            });

            cm.on("error", (err) => errors.push(err));

            // Trigger error on next query
            FakeModel._shouldFailNext = true;

            const result = await cm.getById(999);
            expect(result).toBeNull();
            expect(errors.length).toBeGreaterThan(0);
        });

        it("emits itemInvalidated event", async () => {
            FakeModel._rows = [{ id: 1, name: "A" }];
            const cm = new CacheManager(FakeModel as any, {
                keyFields: ["name"]
            });
            await cm.sync(false);

            const events: any[] = [];
            cm.on("itemInvalidated", (data) => events.push(data));

            cm.invalidate("name", "A");

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ field: "name", value: "A" });
        });
    });

    describe("incremental sync", () => {
        it("checks for updatedAt field before incremental sync", async () => {
            const ModelWithoutUpdatedAt: any = Object.create(FakeModel);
            ModelWithoutUpdatedAt.getAttributes = () => ({ id: {}, name: {} });
            ModelWithoutUpdatedAt._rows = [{ id: 1, name: "A" }];
            ModelWithoutUpdatedAt.findAll = FakeModel.findAll.bind(ModelWithoutUpdatedAt);
            ModelWithoutUpdatedAt.name = "FakeWithoutUpdatedAt";

            const infoMessages: string[] = [];
            const cm = new CacheManager(ModelWithoutUpdatedAt as any, {
                logger: {
                    info: (msg: string) => infoMessages.push(msg),
                    warn: () => { },
                    error: () => { },
                    debug: () => { }
                }
            });

            await cm.sync(false);

            // Try incremental sync - should fall back to full sync and log info
            await cm.sync(true);

            // Should have logged about missing updatedAt
            expect(infoMessages.some(w => w.includes('using full sync always'))).toBe(true);
        });

        it("logs debug message when no updates found", async () => {
            FakeModel._rows = [{ id: 1, name: "A", updatedAt: new Date() }];
            const debugMessages: string[] = [];
            const cm = new CacheManager(FakeModel as any, {
                logger: {
                    info: () => { },
                    warn: () => { },
                    error: () => { },
                    debug: (msg: string) => debugMessages.push(msg)
                }
            });

            await cm.sync(false);

            // Wait a bit to ensure updatedAt is in the past
            await new Promise(resolve => setTimeout(resolve, 10));

            // Do incremental sync with no changes (no rows updated since last sync)
            await cm.sync(true);

            // Should log debug message about no updates
            expect(debugMessages.some(m => m.includes('No new updates'))).toBe(true);
        });
    });

    describe("utility methods", () => {
        beforeEach(() => {
            FakeModel._rows = [
                { id: 1, name: "A", email: "a@example.com" },
                { id: 2, name: "B", email: "b@example.com" }
            ];
        });

        it("has() checks if item exists in cache", async () => {
            const cm = new CacheManager(FakeModel as any, {
                keyFields: ["name", "email"]
            });
            await cm.sync(false);

            expect(cm.has("name", "A")).toBe(true);
            expect(cm.has("email", "a@example.com")).toBe(true);
            expect(cm.has("name", "Z")).toBe(false);
        });

        it("hasById() checks if item exists by ID", async () => {
            const cm = new CacheManager(FakeModel as any);
            await cm.sync(false);

            expect(cm.hasById(1)).toBe(true);
            expect(cm.hasById(2)).toBe(true);
            expect(cm.hasById(999)).toBe(false);
        });

        it("isExpired() checks if item is expired", async () => {
            const cm = new CacheManager(FakeModel as any, {
                ttlMs: 100 // Very short TTL
            });
            await cm.sync(false);

            expect(cm.isExpired(1)).toBe(false);

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 150));

            expect(cm.isExpired(1)).toBe(true);
        });

        it("refresh() forces full sync", async () => {
            const cm = new CacheManager(FakeModel as any, {
                logger: { info: () => { }, warn: () => { }, error: () => { }, debug: () => { } }
            });
            await cm.sync(false);

            FakeModel._rows.push({ id: 3, name: "C", email: "c@example.com" });

            await cm.refresh(true); // Force full sync

            const stats = cm.getStats();
            expect(stats.total).toBe(3);
        });

        it("toJSON() exports with metadata", async () => {
            const cm = new CacheManager(FakeModel as any, {
                ttlMs: 60000
            });
            await cm.sync(false);

            const withMeta = cm.toJSON(true) as Array<{ data: any; expiresAt: number }>;
            expect(withMeta.length).toBe(2);
            expect(withMeta[0]).toHaveProperty('data');
            expect(withMeta[0]).toHaveProperty('expiresAt');
            expect(typeof withMeta[0].expiresAt).toBe('number');

            const withoutMeta = cm.toJSON(false);
            expect(withoutMeta.length).toBe(2);
            expect(withoutMeta[0]).not.toHaveProperty('expiresAt');
        });

        it("loadFromJSON() imports with metadata", async () => {
            const cm = new CacheManager(FakeModel as any, {
                keyFields: ["name"],
                ttlMs: 60000
            });

            const dataWithMeta = [
                { data: { id: 1, name: "X" }, expiresAt: Date.now() + 10000 },
                { data: { id: 2, name: "Y" }, expiresAt: Date.now() + 20000 }
            ];

            cm.loadFromJSON(dataWithMeta, true);

            expect(cm.hasById(1)).toBe(true);
            expect(cm.has("name", "X")).toBe(true);
            expect(cm.getStats().total).toBe(2);
        });

        it("clear(field) clears specific field index", async () => {
            const cm = new CacheManager(FakeModel as any, {
                keyFields: ["name", "email"]
            });
            await cm.sync(false);

            expect(cm.has("name", "A")).toBe(true);
            expect(cm.has("email", "a@example.com")).toBe(true);

            let clearedField: string | undefined;
            cm.on("clearedField", (field: string) => {
                clearedField = field;
            });

            cm.clear("name");

            expect(cm.has("name", "A")).toBe(false);
            expect(cm.has("email", "a@example.com")).toBe(true);
            expect(clearedField).toBe("name");
        });

        it("toJSON() returns cloned data to prevent mutations", async () => {
            const cm = new CacheManager(FakeModel as any);
            await cm.sync(false);

            const data = cm.toJSON() as any[];
            const original = data[0];

            // Mutate exported data
            data[0].name = "MUTATED";

            // Get again - should not be mutated
            const data2 = cm.toJSON() as any[];
            expect(data2[0].name).not.toBe("MUTATED");
            expect(data2[0].name).toBe("A");
        });
    });
});

