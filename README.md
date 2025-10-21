# sequelize-cache-manager

[![CI](https://github.com/arturaleksanyan/sequelize-cache-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/arturaleksanyan/sequelize-cache-manager/actions)
[![npm version](https://badge.fury.io/js/sequelize-cache-manager.svg)](https://www.npmjs.com/package/sequelize-cache-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, production-ready cache manager for Sequelize models with advanced caching strategies. Built for applications that need fast, reliable data access without complex infrastructure.

## ✨ Features

- 🚀 **High Performance** - In-memory caching with multiple key lookups
- ⏰ **TTL Support** - Automatic expiration with configurable time-to-live
- 🔄 **Stale-While-Revalidate** - Serve stale data while refreshing in background
- 🔁 **Auto-Refresh** - Periodic cache updates (full or incremental)
- 🪝 **Sequelize Hooks** - Automatic cache invalidation on model changes
- 🔍 **Multi-Key Indexing** - Query by ID or any custom field(s)
- 📦 **Lazy Loading** - Fetch missing data on-demand with error handling
- 🧹 **Auto Cleanup** - Periodic removal of expired entries
- 📊 **Event-Driven** - Subscribe to cache lifecycle events
- 💾 **JSON Import/Export** - Serialize and restore cache state
- 📈 **Cache Statistics** - Monitor cache size and performance metrics
- 🎯 **Selective Invalidation** - Remove specific items from cache
- ⚡ **Ready State Management** - Wait for cache initialization to complete

## 📦 Installation

```bash
npm install sequelize-cache-manager
```

**Peer Dependencies:**
- `sequelize` >= 6.0.0

## 🚀 Quick Start

```typescript
import { Sequelize, Model, DataTypes } from 'sequelize';
import { CacheManager } from 'sequelize-cache-manager';

// Define your Sequelize model
class User extends Model {
  declare id: number;
  declare email: string;
  declare name: string;
}

const sequelize = new Sequelize('sqlite::memory:');
User.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING, unique: true },
  name: { type: DataTypes.STRING }
}, { sequelize, modelName: 'User' });

// Create cache manager
const userCache = new CacheManager(User, {
  keyFields: ['email'],           // Index by email field
  ttlMs: 60000,                  // 1 minute TTL
  refreshIntervalMs: 300000,     // Refresh every 5 minutes
  lazyReload: true,              // Fetch missing data on-demand
  staleWhileRevalidate: true     // Return stale data while refreshing
});

// Initialize cache (sync + hooks + auto-refresh)
await userCache.autoLoad();

// Use the cache
const user = await userCache.getByKey('email', 'john@example.com');
const userById = await userCache.getById(123);
const allUsers = userCache.getAll();
```

## 📖 API Reference

### Constructor

```typescript
new CacheManager<T extends Model>(model: typeof Model, options?: CacheManagerOptions<T>)
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keyFields` | `string \| string[]` | `['id']` | Fields to index for fast lookups |
| `ttlMs` | `number \| null` | `null` | Time-to-live in milliseconds (null = no expiration) |
| `refreshIntervalMs` | `number` | `300000` | Auto-refresh interval (5 minutes) |
| `cleanupIntervalMs` | `number` | `60000` | TTL cleanup interval (1 minute) |
| `lazyReload` | `boolean` | `true` | Load missing items on-demand |
| `staleWhileRevalidate` | `boolean` | `true` | Return stale data while refreshing |
| `logger` | `object` | `console` | Custom logger with `info`, `warn`, `error`, `debug` methods |

### Core Methods

#### `async autoLoad(): Promise<void>`

One-shot initialization: performs full sync, attaches hooks, starts auto-refresh and cleanup.

```typescript
await cache.autoLoad();
```

#### `async sync(incremental?: boolean): Promise<void>`

Manually sync cache with database.
- `incremental=true`: Only fetch records updated since last sync (requires `updatedAt` field)
- `incremental=false`: Full refresh

```typescript
await cache.sync(false); // Full sync
await cache.sync(true);  // Incremental sync
```

#### `async getById(id: string | number): Promise<PlainRecord | null | undefined>`

Retrieve item by primary key. Uses lazy loading if not found.

```typescript
const user = await cache.getById(123);
```

#### `async getByKey(field: string, value: string | number): Promise<PlainRecord | null | undefined>`

Retrieve item by custom indexed field.

```typescript
const user = await cache.getByKey('email', 'john@example.com');
const product = await cache.getByKey('sku', 'ABC-123');
```

#### `getAll(): PlainRecord[]`

Get all cached items (excludes expired entries).

```typescript
const allUsers = cache.getAll();
```

#### `async getManyByKey(field: string, values: Array<string | number>): Promise<Record<string, PlainRecord | null>>`

Bulk fetch multiple items by key. Missing items are fetched in a single query.

```typescript
const results = await cache.getManyByKey('email', [
  'john@example.com',
  'jane@example.com',
  'bob@example.com'
]);

console.log(results['john@example.com']); // User object or null
```

#### `clear(field?: string): void`

Remove all items from cache, or clear a specific field index.

```typescript
// Clear entire cache
cache.clear();

// Clear specific field index only (useful for multi-tenant)
cache.clear('organizationId');
```

#### `destroy(): void`

Complete cleanup: stops timers, detaches hooks, clears cache, removes event listeners.

```typescript
cache.destroy();
```

#### `async waitUntilReady(): Promise<void>`

Wait for cache initialization to complete. Useful when you need to ensure cache is fully loaded before use.

```typescript
const cache = new CacheManager(User);
cache.autoLoad(); // Don't await
// ... do other initialization ...
await cache.waitUntilReady(); // Wait for cache to be ready
```

#### `invalidate(field: string, value: string | number): void`

Manually invalidate (remove) a specific item from cache by field and value.

```typescript
cache.invalidate('email', 'john@example.com');
cache.invalidate('id', 123);
```

#### `getStats(): CacheStats`

Get detailed cache statistics including size, configuration, and status.

```typescript
const stats = cache.getStats();
console.log(stats);
// {
//   total: 1500,
//   byKey: { email: 1500, username: 1500 },
//   lastSyncAt: 1634567890000,
//   ttlMs: 60000,
//   syncing: false,
//   refreshIntervalMs: 300000,
//   lazyReload: true,
//   staleWhileRevalidate: true
// }
```

#### `async refresh(forceFull?: boolean): Promise<void>`

Manually trigger a cache refresh. Optionally force a full sync instead of incremental.

```typescript
// Incremental refresh (default)
await cache.refresh();

// Force full refresh
await cache.refresh(true);
```

#### `has(field: string, value: string | number): boolean`

Check if an item exists in cache by field and value.

```typescript
if (cache.has('email', 'user@example.com')) {
  console.log('User is in cache');
}
```

#### `hasById(id: string | number): boolean`

Check if an item exists in cache by ID.

```typescript
if (cache.hasById(123)) {
  console.log('Item 123 is cached');
}
```

#### `isExpired(id: string | number): boolean`

Check if a cached item has expired (only works with TTL enabled).

```typescript
if (cache.isExpired(123)) {
  console.log('Item 123 has expired');
  await cache.refresh(); // Refresh cache
}
```

#### `handleProcessSignals(): void`

Automatically clean up cache on process termination (SIGTERM, SIGINT).

```typescript
cache.handleProcessSignals();
// Cache will be properly destroyed on process exit
```

### Cache Lifecycle Control

#### `attachHooks(): void`

Attach Sequelize hooks for automatic cache invalidation.

```typescript
cache.attachHooks();
// Now creates/updates/deletes will automatically update cache
```

#### `detachHooks(): void`

Remove Sequelize hooks.

```typescript
cache.detachHooks();
```

#### `startAutoRefresh(): void`

Start periodic background refresh (uses `refreshIntervalMs`).

```typescript
cache.startAutoRefresh();
```

#### `stopAutoRefresh(): void`

Stop auto-refresh timer.

```typescript
cache.stopAutoRefresh();
```

#### `startCleanup(): void`

Start periodic cleanup of expired entries (runs every 60 seconds).

```typescript
cache.startCleanup();
```

#### `stopCleanup(): void`

Stop cleanup timer.

```typescript
cache.stopCleanup();
```

### Serialization

#### `toJSON(includeMeta?: boolean): PlainRecord[] | Array<{data: PlainRecord, expiresAt: number}>`

Export cache to JSON array, optionally with expiration metadata.

```typescript
// Export data only
const data = cache.toJSON();
fs.writeFileSync('cache-backup.json', JSON.stringify(data));

// Export with expiration metadata
const dataWithMeta = cache.toJSON(true);
fs.writeFileSync('cache-with-meta.json', JSON.stringify(dataWithMeta));
```

#### `loadFromJSON(arr: PlainRecord[] | Array<{data: PlainRecord, expiresAt: number}>, hasMeta?: boolean): void`

Import cache from JSON array, optionally with expiration metadata.

```typescript
// Import simple data
const data = JSON.parse(fs.readFileSync('cache-backup.json', 'utf-8'));
cache.loadFromJSON(data);

// Import with metadata (preserves expiration times)
const dataWithMeta = JSON.parse(fs.readFileSync('cache-with-meta.json', 'utf-8'));
cache.loadFromJSON(dataWithMeta, true);
```

## 📡 Events

CacheManager extends `EventEmitter` and emits the following events:

| Event | Arguments | Description |
|-------|-----------|-------------|
| `synced` | - | Cache sync completed |
| `refreshed` | - | Auto-refresh completed |
| `cleared` | - | Cache cleared |
| `itemCreated` | `PlainRecord` | Item added via hook |
| `itemUpdated` | `PlainRecord` | Item updated via hook |
| `itemRemoved` | `PlainRecord` | Item removed via hook |
| `refreshedItem` | `PlainRecord` | Item lazy-loaded |
| `itemInvalidated` | `{ field, value }` | Item manually invalidated |
| `clearedField` | `string` | Specific field index cleared |
| `error` | `Error` | Error during sync/refresh/lazy-load |

**Note:** All events are fully type-safe with IntelliSense support!

```typescript
cache.on('synced', () => console.log('Cache synced'));
cache.on('itemCreated', (item) => console.log('Created:', item));
cache.on('itemInvalidated', ({ field, value }) => console.log(`Invalidated ${field}:${value}`));
cache.on('error', (err) => console.error('Cache error:', err));
```

## 💡 Usage Examples

### Example 1: Product Catalog with SKU Lookup

```typescript
const productCache = new CacheManager(Product, {
  keyFields: ['sku', 'barcode'], // Index by multiple fields
  ttlMs: 3600000, // 1 hour TTL
  refreshIntervalMs: 600000, // Refresh every 10 minutes
});

await productCache.autoLoad();

// Fast lookups
const product1 = await productCache.getByKey('sku', 'LAPTOP-123');
const product2 = await productCache.getByKey('barcode', '1234567890');
```

### Example 2: User Session Cache with Custom Logger

```typescript
import winston from 'winston';

const logger = winston.createLogger({ /* config */ });

const sessionCache = new CacheManager(Session, {
  ttlMs: 900000, // 15 minute sessions
  staleWhileRevalidate: false, // Force fresh data
  logger: {
    info: (msg) => logger.info(msg),
    warn: (msg) => logger.warn(msg),
    error: (msg) => logger.error(msg)
  }
});

await sessionCache.sync(false);
```

### Example 3: Read-Through Cache Pattern

```typescript
// Cache automatically loads missing data
const cache = new CacheManager(User, {
  lazyReload: true,
  ttlMs: 60000
});

await cache.sync(false);

// This will hit cache
const user1 = await cache.getById(1);

// This will fetch from DB if not in cache
const user999 = await cache.getById(999);
```

### Example 4: Bulk Operations

```typescript
const cache = new CacheManager(Product, {
  keyFields: ['sku'],
  ttlMs: 3600000
});

await cache.autoLoad();

// Efficient bulk fetch
const skus = ['SKU-1', 'SKU-2', 'SKU-3', 'SKU-4'];
const products = await cache.getManyByKey('sku', skus);

// Process results
skus.forEach(sku => {
  const product = products[sku];
  if (product) {
    console.log(`${sku}: ${product.name}`);
  } else {
    console.log(`${sku}: Not found`);
  }
});
```

### Example 5: Cache Warm-Up with Event Monitoring

```typescript
const cache = new CacheManager(Provider, {
  keyFields: ['name', 'host'],
  ttlMs: 300000
});

cache.on('synced', () => {
  console.log(`Loaded ${cache.getAll().length} providers`);
});

cache.on('itemCreated', (item) => {
  console.log(`New provider: ${item.name}`);
});

cache.on('error', (err) => {
  console.error('Cache error:', err);
  // Implement fallback or retry logic
});

await cache.autoLoad();
```

### Example 6: Manual Refresh Strategy

```typescript
const cache = new CacheManager(Config, {
  ttlMs: null, // No automatic expiration
  refreshIntervalMs: 0 // No auto-refresh
});

// Manual control
await cache.sync(false);
cache.attachHooks();

// Trigger refresh on-demand
async function refreshConfig() {
  await cache.sync(false);
  console.log('Config refreshed');
}

// Call when needed
await refreshConfig();
```

### Example 7: Monitoring and Statistics

```typescript
const cache = new CacheManager(Product, {
  keyFields: ['sku'],
  ttlMs: 300000
});

await cache.autoLoad();

// Monitor cache performance
setInterval(() => {
  const stats = cache.getStats();
  console.log('Cache Stats:', {
    totalItems: stats.total,
    skuIndex: stats.byKey.sku,
    lastSync: new Date(stats.lastSyncAt || 0),
    isSyncing: stats.syncing
  });
  
  // Alert if cache is too large
  if (stats.total > 10000) {
    console.warn('Cache size exceeds 10k items, consider reducing TTL');
  }
}, 60000);

// Handle errors
cache.on('error', (err) => {
  console.error('Cache error:', err);
  // Implement retry logic or fallback
});
```

### Example 8: Selective Cache Invalidation

```typescript
const cache = new CacheManager(User, {
  keyFields: ['email', 'username']
});

await cache.autoLoad();

// When user changes email outside of Sequelize (e.g., admin panel)
function updateUserEmail(oldEmail, newEmail) {
  // Update in external system...
  
  // Invalidate old cache entry
  cache.invalidate('email', oldEmail);
  
  // Listen for invalidation event
  cache.on('itemInvalidated', ({ field, value }) => {
    console.log(`Cache cleared for ${field}: ${value}`);
  });
}

// Trigger re-fetch on next access
const user = await cache.getByKey('email', newEmail); // Will fetch from DB
```

### Example 9: Wait for Cache Initialization

```typescript
// In an Express.js app
import express from 'express';

const app = express();
const userCache = new CacheManager(User, { keyFields: ['email'] });

// Start cache loading asynchronously
userCache.autoLoad();

// Middleware to ensure cache is ready
app.use(async (req, res, next) => {
  await userCache.waitUntilReady();
  next();
});

app.get('/user/:email', async (req, res) => {
  const user = await userCache.getByKey('email', req.params.email);
  res.json(user);
});

app.listen(3000);
```

### Example 10: Utility Methods and Process Signals

```typescript
const cache = new CacheManager(Product, {
  keyFields: ['sku'],
  ttlMs: 300000
});

await cache.autoLoad();

// Graceful shutdown on SIGTERM/SIGINT
cache.handleProcessSignals();

// Check if items exist before fetching
async function getProduct(sku: string) {
  if (cache.has('sku', sku)) {
    // Check if expired
    const product = await cache.getByKey('sku', sku);
    const productId = product?.id;
    
    if (productId && cache.isExpired(productId)) {
      console.log('Product data is stale, refreshing...');
      await cache.refresh();
    }
    
    return product;
  } else {
    // Not in cache, will be lazy-loaded
    return await cache.getByKey('sku', sku);
  }
}

// Periodic cache monitoring
setInterval(() => {
  const stats = cache.getStats();
  
  if (stats.total === 0) {
    console.warn('Cache is empty, forcing full refresh');
    cache.refresh(true); // Force full sync
  }
}, 60000);
```

### Example 11: Cache Persistence with Metadata

```typescript
const cache = new CacheManager(Settings, {
  ttlMs: 3600000 // 1 hour TTL
});

await cache.autoLoad();

// Persist cache to disk with expiration times
async function saveCache() {
  const dataWithMeta = cache.toJSON(true);
  await fs.promises.writeFile(
    'cache-snapshot.json',
    JSON.stringify(dataWithMeta, null, 2)
  );
  console.log('Cache saved with expiration metadata');
}

// Restore cache from disk (preserves TTLs)
async function loadCache() {
  try {
    const data = JSON.parse(
      await fs.promises.readFile('cache-snapshot.json', 'utf-8')
    );
    cache.loadFromJSON(data, true); // Restore with metadata
    console.log('Cache restored with original expiration times');
  } catch (err) {
    console.log('No cache file found, loading from DB');
    await cache.sync(false);
  }
}

// Save cache every 5 minutes
setInterval(saveCache, 5 * 60 * 1000);
```

## 🔄 Caching Strategies

### Stale-While-Revalidate (Default)

Returns cached data immediately, even if expired, then refreshes in background.

```typescript
const cache = new CacheManager(Model, {
  staleWhileRevalidate: true,
  ttlMs: 60000
});

// Returns immediately (possibly stale), refreshes in background
const data = await cache.getById(123);
```

### Fresh-Data-Only

Always waits for fresh data when TTL expires.

```typescript
const cache = new CacheManager(Model, {
  staleWhileRevalidate: false,
  ttlMs: 60000
});

// Waits for refresh if expired
const data = await cache.getById(123);
```

### Lazy Loading

Automatically fetches missing data from database.

```typescript
const cache = new CacheManager(Model, {
  lazyReload: true
});

// Fetches from DB if not in cache
const data = await cache.getById(999);
```

### No Lazy Loading

Returns undefined for missing data.

```typescript
const cache = new CacheManager(Model, {
  lazyReload: false
});

// Returns undefined if not in cache
const data = await cache.getById(999);
```

## 🧪 Testing

```bash
npm test
```

Run with coverage:

```bash
npm test -- --coverage
```

## 🏗️ Building

```bash
npm run build
```

Output is generated in the `dist/` directory.

## 📝 Migration Guide

### From Manual Cache Implementation

**Before:**
```javascript
const cache = {};

async function getUser(id) {
  if (cache[id]) return cache[id];
  const user = await User.findByPk(id);
  cache[id] = user;
  return user;
}
```

**After:**
```typescript
const userCache = new CacheManager(User, {
  ttlMs: 60000,
  lazyReload: true
});

await userCache.autoLoad();

// Now just use:
const user = await userCache.getById(id);
```

### From Custom Implementation

If you have a custom cache class, replace it with:

```typescript
// Old:
// const cache = new CustomCache(Model);

// New:
const cache = new CacheManager(Model, {
  keyFields: ['customKey'],
  ttlMs: 60000,
  refreshIntervalMs: 300000
});

await cache.autoLoad();
```

## ⚙️ Configuration Recommendations

### High-Traffic APIs
```typescript
{
  ttlMs: 30000,              // 30 second TTL
  refreshIntervalMs: 15000,  // Refresh every 15s
  staleWhileRevalidate: true,
  lazyReload: true
}
```

### Background Jobs
```typescript
{
  ttlMs: 3600000,            // 1 hour TTL
  refreshIntervalMs: 600000, // Refresh every 10 min
  staleWhileRevalidate: false,
  lazyReload: false
}
```

### Real-Time Systems
```typescript
{
  ttlMs: 5000,               // 5 second TTL
  refreshIntervalMs: 2000,   // Refresh every 2s
  staleWhileRevalidate: false,
  lazyReload: true
}
```

### Static Data
```typescript
{
  ttlMs: null,               // No expiration
  refreshIntervalMs: 0,      // No auto-refresh
  staleWhileRevalidate: true,
  lazyReload: true
}
```

## 🐛 Troubleshooting

### Cache not updating after model changes

Make sure hooks are attached:
```typescript
cache.attachHooks();
```

### High memory usage

Monitor with `getStats()` and configure aggressive TTL:
```typescript
const stats = cache.getStats();
console.log(`Cache size: ${stats.total} items`);

// Configure aggressive TTL and cleanup
const cache = new CacheManager(Model, {
  ttlMs: 60000,              // Short TTL
  refreshIntervalMs: 300000  // Less frequent refresh
});
```

### Incremental sync not working

Ensure your model has `updatedAt` field:
```typescript
Model.init({
  // fields...
}, {
  sequelize,
  timestamps: true // Required for incremental sync
});
```

The cache manager will automatically detect missing `updatedAt` and fall back to full sync with a warning.

### Lazy loading errors

The cache now handles DB errors gracefully in lazy loading:
```typescript
cache.on('error', (err) => {
  console.error('Lazy load failed:', err);
  // Implement retry or fallback logic
});
```

### Cache not ready on startup

Use `waitUntilReady()` to ensure cache is loaded:
```typescript
await cache.autoLoad();
// or
cache.autoLoad(); // Start loading
await cache.waitUntilReady(); // Wait for completion
```

## 📄 License

MIT © Artur Aleksanyan

## 🤝 Contributing

Contributions welcome! Please open an issue or PR.

## 🔗 Links

- [GitHub Repository](https://github.com/arturaleksanyan/sequelize-cache-manager)
- [NPM Package](https://www.npmjs.com/package/sequelize-cache-manager)
- [Issue Tracker](https://github.com/arturaleksanyan/sequelize-cache-manager/issues)

---

Made with ❤️ for the Sequelize community
