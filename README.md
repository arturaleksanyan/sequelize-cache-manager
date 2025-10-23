# sequelize-cache-manager

[![CI](https://github.com/arturaleksanyan/sequelize-cache-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/arturaleksanyan/sequelize-cache-manager/actions)
[![npm version](https://badge.fury.io/js/sequelize-cache-manager.svg)](https://www.npmjs.com/package/sequelize-cache-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, production-ready cache manager for Sequelize models with advanced caching strategies and multi-model orchestration. Built for applications that need fast, reliable data access without complex infrastructure.

## ✨ Features

- 🚀 **High Performance** - In-memory caching with multiple key lookups
- 🎯 **Multi-Model Management** - Orchestrate caching across multiple models with `MultiModelCacheManager`
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
- 🔴 **Redis Backend (Optional)** - Persist cache to Redis for distributed systems
- 🌐 **Cluster Sync** - Redis Pub/Sub for cross-instance cache invalidation

## 📦 Installation

```bash
npm install sequelize-cache-manager
```

**Peer Dependencies:**
- `sequelize` >= 6.0.0

**Optional Dependencies:**
- `redis` >= 4.0.0 (for Redis backend support)

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

## 📚 Complete Examples

The [examples](./examples) directory contains working examples for different use cases:

### Single-Model Cache Examples

| Example | Description | File |
|---------|-------------|------|
| **Basic Usage** | Quick start guide with core features: initialization, CRUD operations, hooks, events | [basic-usage.ts](./examples/basic-usage.ts) |
| **Redis Backend** | Redis persistence, connection pooling, graceful degradation, TTL management | [redis-usage.ts](./examples/redis-usage.ts) |
| **Cluster Sync** | Multi-instance cache coherence using Redis Pub/Sub for cross-instance invalidation | [cluster-sync.ts](./examples/cluster-sync.ts) |

### Multi-Model Cache Examples

| Example | Description | File |
|---------|-------------|------|
| **Basic Multi-Model** | CRUD operations, statistics, clearing, refreshing across multiple models | [multi-model-basic.ts](./examples/multi-model-basic.ts) |
| **Multi-Model Redis** | Shared Redis connection, cluster sync, event monitoring, graceful shutdown | [multi-model-redis.ts](./examples/multi-model-redis.ts) |
| **Advanced Patterns** | Custom logger, health checks, metrics, preloading, error recovery, cache warming | [multi-model-advanced.ts](./examples/multi-model-advanced.ts) |

All examples include:
- ✅ Complete working code
- ✅ Inline comments and documentation
- ✅ Error handling patterns
- ✅ Best practices

## 🔴 Redis Backend (Optional)

The cache manager supports optional Redis persistence for distributed caching scenarios. When enabled, the cache automatically syncs data to Redis while maintaining fast in-memory access.

### Installation

```bash
npm install redis
```

### Basic Usage

```typescript
import { CacheManager } from 'sequelize-cache-manager';

const cache = new CacheManager(User, {
  redis: {
    url: 'redis://localhost:6379',
    keyPrefix: 'myapp:users:',
  },
});
```

### Redis Options

```typescript
interface RedisOptions {
  url?: string;              // Redis connection URL
  host?: string;             // Redis host (alternative to url)
  port?: number;             // Redis port (default: 6379)
  password?: string;         // Redis authentication
  db?: number;               // Redis database number (default: 0)
  keyPrefix?: string;        // Prefix for cache keys (default: 'cache:ModelName:')
  client?: any;              // External Redis client (reuse existing connection)
  enableClusterSync?: boolean; // Enable Pub/Sub for multi-instance cache sync (default: false)
  reconnectStrategy?: {      // Auto-reconnect configuration
    retries?: number;        // Max reconnection attempts (default: 10)
    factor?: number;         // Exponential backoff factor (default: 2)
    minTimeout?: number;     // Min delay in ms (default: 1000)
    maxTimeout?: number;     // Max delay in ms (default: 30000)
  };
}
```

### Features

- **Automatic Persistence**: All cache writes are automatically persisted to Redis
- **Graceful Degradation**: If Redis is unavailable, cache falls back to memory-only mode
- **TTL Support**: Redis TTL is automatically set based on `ttlMs` option
- **Connection Pooling**: Reuse existing Redis clients for efficiency
- **Fire-and-Forget Writes**: Non-blocking Redis operations for optimal performance
- **Auto-Reconnect**: Exponential backoff reconnection with configurable retry limits
- **Batch Operations**: Full sync uses Redis pipelines for optimal performance
- **Scalable Clear**: Uses SCAN iterator instead of KEYS for large datasets
- **Cluster Sync (Optional)**: Multi-instance cache coherence via Redis Pub/Sub

### Auto-Reconnect Behavior

The cache manager automatically handles Redis connection failures with **exponential backoff**:

**Default Strategy:**
- **Max Retries**: 10 attempts
- **Backoff Factor**: 2x (1s, 2s, 4s, 8s, 16s, 32s → capped at 30s)
- **Min Delay**: 1000ms (1 second)
- **Max Delay**: 30000ms (30 seconds)

**Events:**
- `redisReconnecting` - Emitted on each reconnection attempt
- `redisReconnected` - Emitted when connection is restored
- `redisDisconnected` - Emitted when connection is lost

**Custom Reconnect Strategy:**

```typescript
const cache = new CacheManager(User, {
  redis: {
    url: 'redis://localhost:6379',
    reconnectStrategy: {
      retries: 20,        // Try 20 times before giving up
      factor: 1.5,        // Slower backoff (1.5x instead of 2x)
      minTimeout: 500,    // Start with 500ms delay
      maxTimeout: 60000,  // Max 60 seconds between retries
    },
  },
});

// Monitor reconnection attempts
cache.on('redisReconnecting', ({ attempt, delay }) => {
  console.log(`Reconnect attempt ${attempt}, waiting ${delay}ms...`);
});

cache.on('redisReconnected', () => {
  console.log('✅ Redis connection restored');
});

cache.on('redisDisconnected', () => {
  console.warn('⚠️ Redis connection lost');
});
```

**Production Notes:**
- The cache continues to work in **memory-only mode** if Redis is unavailable
- Both the main client and Pub/Sub subscriber auto-reconnect independently
- Cache operations are **non-blocking** - Redis failures don't stop your app
- After max retries exceeded, you'll need to restart the cache manager

### Examples

#### Basic Redis Configuration

```typescript
const cache = new CacheManager(User, {
  ttlMs: 60_000, // 1 minute
  redis: {
    url: 'redis://localhost:6379',
  },
});

await cache.autoLoad();
const user = await cache.getById(1); // Served from memory, backed by Redis
```

#### Using Existing Redis Client

```typescript
import { createClient } from 'redis';

const redisClient = createClient({ url: 'redis://localhost:6379' });
await redisClient.connect();

const cache = new CacheManager(User, {
  redis: {
    client: redisClient,
    keyPrefix: 'myapp:users:',
  },
});
```

#### Cache Persistence Across Restarts

```typescript
// First instance
const cache1 = new CacheManager(User, {
  redis: { url: 'redis://localhost:6379' },
  ttlMs: null, // No expiry
});
await cache1.autoLoad();
await cache1.destroy();

// Second instance - data recovered from Redis
const cache2 = new CacheManager(User, {
  redis: { url: 'redis://localhost:6379' },
});
const user = await cache2.getById(1); // Retrieved from Redis
```

#### Cluster-Wide Cache Sync (Multi-Instance)

```typescript
// Enable Pub/Sub for multi-instance cache coherence
const cache = new CacheManager(User, {
  redis: {
    url: 'redis://localhost:6379',
    enableClusterSync: true, // 🔥 Sync invalidations across all instances
  },
});

// When one instance invalidates, all instances are notified
cache.invalidate('email', 'john@example.com');
// ↓ Redis Pub/Sub broadcasts to all instances
// ↓ All other instances also remove this item from cache
```

**Use Cases:**
- Multiple app instances behind a load balancer
- Microservices sharing the same models
- Horizontal scaling with consistent caching

See the [Complete Examples](#-complete-examples) section for detailed code samples.

## 🎯 Multi-Model Cache Management

For applications managing multiple Sequelize models, the `MultiModelCacheManager` provides a unified interface to orchestrate caching across all models with shared Redis connections and centralized configuration.

### Why Use MultiModelCacheManager?

- **Single Redis Connection**: Share one Redis client across all models instead of creating one per model
- **Unified API**: Manage all model caches through a single interface
- **Automatic Namespacing**: Redis keys are automatically prefixed per model (`cache:User:`, `cache:Product:`, etc.)
- **Event Forwarding**: All cache events include the model name for easy debugging and monitoring
- **Error Isolation**: Failures in one model don't affect others
- **Parallel Initialization**: All models are initialized concurrently for faster startup

### Basic Usage

```typescript
import { MultiModelCacheManager } from 'sequelize-cache-manager';
import { User, Product, Order } from './models';

// Initialize with multiple models
const multiCache = new MultiModelCacheManager(
  { User, Product, Order },  // Models as a record
  {
    ttlMs: 300000,            // 5 minutes TTL for all models
    refreshIntervalMs: 60000, // Refresh every minute
    keyFields: ['email', 'sku', 'orderNumber'],  // Fields to index across all models
    redis: {
      host: 'localhost',
      port: 6379,
      enableClusterSync: true,  // Enable cross-instance invalidation
    },
  }
);

// Initialize all caches
await multiCache.init();
await multiCache.waitUntilReady(10000); // Wait up to 10 seconds

// Access data from any model
const user = await multiCache.getById('User', 123);
const product = await multiCache.getByKey('Product', 'sku', 'ABC-123');
const orders = await multiCache.getManyByKey('Order', 'userId', [1, 2, 3]);

// Get all cached records from a model
const allProducts = multiCache.getAll('Product');

// Refresh specific model or all models
await multiCache.refresh('Product', true);  // Force full refresh
await multiCache.refresh();                 // Refresh all models

// Clear specific model or all models
await multiCache.clear('User');
await multiCache.clear();  // Clear all

// Invalidate specific records
await multiCache.invalidate('User', 'email', 'john@example.com');

// Get statistics
const stats = multiCache.getStats();
console.log(stats.User.total);     // Number of cached users
console.log(stats.Product.total);  // Number of cached products

// Check sizes
const sizes = multiCache.size();  // { User: 150, Product: 85, Order: 320 }
const userCount = multiCache.size('User');  // 150

// Graceful shutdown
await multiCache.destroy();
```

### Direct Manager Access

You can access individual `CacheManager` instances for advanced operations:

```typescript
// Get specific manager
const userManager = multiCache.getManager('User');
userManager.has('email', 'john@example.com');
userManager.isExpired('email', 'john@example.com');

// Get all managers for custom operations
const managers = multiCache.getManagers();
for (const [modelName, manager] of managers) {
  console.log(`${modelName}: ${manager.size()} items`);
}
```

### Event Monitoring

All events from individual cache managers are forwarded with model context:

```typescript
multiCache.on('ready', (data) => {
  console.log(`Cache ready for model: ${data.model}`);
});

multiCache.on('synced', (data) => {
  console.log(`Synced ${data.model}`);
});

multiCache.on('error', (data) => {
  console.error(`Error in ${data.model}:`, data.error);
});

multiCache.on('redisReconnected', (data) => {
  console.log(`Redis reconnected for ${data.model || 'shared'}`);
});

multiCache.on('itemInvalidated', (data) => {
  console.log(`Invalidated ${data.field}=${data.value} in ${data.model}`);
});
```

### Cache Export/Import

```typescript
// Export cache data for backup
const backup = {};
for (const modelName of multiCache.getModelNames()) {
  backup[modelName] = multiCache.toJSON(modelName, true);  // With metadata
}

// Restore from backup
for (const [modelName, data] of Object.entries(backup)) {
  multiCache.loadFromJSON(modelName, data, true);
}
```

### Preloading from External Sources

```typescript
// Preload data from an external API
await multiCache.preload('User', async () => {
  const response = await fetch('https://api.example.com/users');
  return await response.json();
});
```

### Health Checks

```typescript
function performHealthCheck(multiCache: MultiModelCacheManager) {
  const health = {
    status: 'healthy',
    models: {} as Record<string, any>,
  };

  if (!multiCache.isInitialized()) {
    health.status = 'unhealthy';
    return health;
  }

  const managers = multiCache.getManagers();
  const stats = multiCache.getStats() as Record<string, any>;

  for (const [modelName, manager] of managers) {
    health.models[modelName] = {
      cached: stats[modelName].total,
      ready: manager.isReady(),
      lastSync: stats[modelName].lastSyncAt,
      hitRate: stats[modelName].metrics?.hitRate || 0,
    };
  }

  return health;
}
```

### Configuration Options

All `CacheManagerOptions` are supported and applied to all models:

```typescript
const multiCache = new MultiModelCacheManager(
  { User, Product, Order },
  {
    ttlMs: 300000,               // TTL for all models
    refreshIntervalMs: 60000,    // Auto-refresh interval
    maxSize: 10000,              // LRU eviction limit per model
    keyFields: ['email', 'sku'], // Index fields across all models
    lazyReload: true,            // Lazy load missing data
    staleWhileRevalidate: true,  // Serve stale while refreshing
    redis: {
      url: 'redis://localhost:6379',
      keyPrefix: 'myapp:',       // Global prefix (model names auto-added)
      enableClusterSync: true,    // Cross-instance sync
      reconnectStrategy: {
        retries: 10,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 30000,
      },
    },
    logger: customLogger,         // Custom logger for all models
  }
);
```

### API Reference

#### Constructor

```typescript
new MultiModelCacheManager(
  models: Record<string, typeof Model>,
  options?: CacheManagerOptions
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `init()` | Initialize all cache managers in parallel |
| `waitUntilReady(timeoutMs?)` | Wait for all models to be ready (default: 30s timeout) |
| `getManager(modelName)` | Get the CacheManager instance for a specific model |
| `getManagers()` | Get all cache managers as a Map |
| `getById(modelName, id)` | Retrieve a record by ID |
| `getByKey(modelName, field, value)` | Retrieve a record by custom key |
| `getManyByKey(modelName, field, values)` | Bulk retrieve by key |
| `getAll(modelName)` | Get all cached records for a model |
| `refresh(modelName?, forceFull?)` | Refresh specific or all models |
| `clear(modelName?)` | Clear specific or all model caches |
| `invalidate(modelName, field, value)` | Invalidate specific record |
| `preload(modelName, source)` | Preload from external async source |
| `toJSON(modelName, includeMeta?)` | Export cache data |
| `loadFromJSON(modelName, data, hasMeta?)` | Import cache data |
| `getStats(modelName?)` | Get statistics for one or all models |
| `size(modelName?)` | Get cache size for one or all models |
| `getModelNames()` | Get array of managed model names |
| `hasModel(modelName)` | Check if a model is managed |
| `isInitialized()` | Check if initialized |
| `destroy()` | Gracefully shutdown all managers |

### Production Best Practices

1. **Timeout Configuration**: Set reasonable timeouts based on your data size
   ```typescript
   await multiCache.waitUntilReady(15000); // 15 seconds for large datasets
   ```

2. **Error Monitoring**: Listen to error events to track per-model issues
   ```typescript
   multiCache.on('error', (data) => {
     logger.error(`Cache error in ${data.model}:`, data.error);
     metrics.increment(`cache.error.${data.model}`);
   });
   ```

3. **Graceful Shutdown**: Always destroy on application shutdown
   ```typescript
   process.on('SIGTERM', async () => {
     await multiCache.destroy();
     process.exit(0);
   });
   ```

4. **Health Checks**: Implement health endpoints
   ```typescript
   app.get('/health/cache', (req, res) => {
     const health = performHealthCheck(multiCache);
     res.json(health);
   });
   ```

5. **Metrics Collection**: Track cache performance
   ```typescript
   const stats = multiCache.getStats() as Record<string, any>;
   for (const [model, modelStats] of Object.entries(stats)) {
     metrics.gauge(`cache.${model}.size`, modelStats.total);
     metrics.gauge(`cache.${model}.hit_rate`, modelStats.metrics?.hitRate || 0);
   }
   ```

### Examples

For complete working examples, see the [Complete Examples](#-complete-examples) section at the top of this document, which includes:
- Multi-model basic usage patterns
- Redis integration with shared connections
- Advanced monitoring and health checks

## ⚠️ Limitations & Important Considerations

### Caching Scope

**✅ What IS cached:**
- Individual records accessed by `id` or `keyFields` (e.g., `getById`, `getByKey`)
- Full model syncs via `sync()` or `autoLoad()`

**❌ What is NOT cached:**
- Arbitrary query results (e.g., `findAll({ where: { status: 'active' } })`)
- Complex joins, aggregations, or custom SQL queries
- Association data (unless explicitly configured)

**Why:** This library focuses on **entity-level caching** (caching individual records by unique identifiers). For query result caching, consider a separate query cache layer or Redis-based query caching.

### Hook-Based Invalidation Limitations

**How hooks work:**
- `afterCreate`, `afterUpdate`, `afterDestroy` hooks invalidate cache entries when models change
- Works great for single-instance apps or with Redis cluster sync enabled

**Edge cases to be aware of:**
1. **Bulk updates without hooks**: `Model.update()` bypasses instance hooks. Use `{individualHooks: true}` or manually call `cache.invalidate()`.
2. **Direct SQL updates**: Any raw SQL or database changes outside Sequelize won't trigger cache invalidation.
3. **KeyField mutations**: If a record's `keyField` value changes (e.g., email update), the old key may remain cached until TTL expires. Consider invalidating manually.

```typescript
// ❌ Bypasses cache invalidation
await User.update({ status: 'inactive' }, { where: { age: { [Op.gt]: 65 } } });

// ✅ Triggers cache invalidation
await User.update({ status: 'inactive' }, { 
  where: { age: { [Op.gt]: 65 } },
  individualHooks: true  // Forces hook execution
});

// ✅ Manual invalidation
await User.update({ email: 'newemail@example.com' }, { where: { id: 123 } });
cache.invalidate('email', 'oldemail@example.com'); // Clean up old key
```

### Memory Management

**Without `maxSize`:**
- Cache grows unbounded until TTL cleanup or manual `clear()`
- Suitable for small-medium datasets (< 10k records)
- Monitor with `getStats()` - warning logged at 50k+ entries

**With `maxSize` (Recommended for large datasets):**
- LRU (Least Recently Used) eviction when limit reached
- Protects against memory exhaustion
- Track evictions via `evicted` event

```typescript
const cache = new CacheManager(Product, {
  maxSize: 10000, // Keep max 10k products in memory
  ttlMs: 300000,  // 5 minutes
});

cache.on('evicted', ({ id, reason }) => {
  console.log(`Evicted product ${id} due to ${reason}`);
});
```

### Stale-While-Revalidate Behavior

When `staleWhileRevalidate: true` (default) and TTL expires:
- **First request after expiry**: Returns stale data immediately + triggers background refresh
- **Subsequent requests**: Get fresh data once refresh completes

**Trade-off:** Users might see slightly stale data briefly after TTL expiration. If strict freshness is required, set `staleWhileRevalidate: false` (but expect occasional latency on cache misses).

### Large Dataset Syncing

**Full sync performance:**
- `sync(false)` loads entire table into memory via `Model.findAll()`
- For tables with 100k+ rows, this may cause:
  - High memory usage
  - Long startup time
  - Heavy database load

**Recommendations:**
1. Use **incremental sync** with `updatedAt` field (automatic if field exists)
2. Set `maxSize` to limit memory footprint
3. Consider **lazy-only mode** (no preload):
   ```typescript
   const cache = new CacheManager(Model, {
     refreshIntervalMs: 0, // Disable auto-refresh
     lazyReload: true,     // Load on-demand only
   });
   await cache.attachHooks(); // Only use hooks, skip initial sync
   ```
4. For very large datasets, use Redis as primary cache and memory as L1 cache

### Redis Considerations

**Fire-and-Forget Writes:**
- Redis operations are non-blocking for performance
- Cache continues working if Redis is down (memory-only fallback)
- Redis failures are logged but don't stop your app

**Cluster Sync Requirements:**
- Requires `enableClusterSync: true` for multi-instance invalidation
- Uses Redis Pub/Sub (requires separate subscriber connection)
- Instance-to-instance invalidation may have 10-100ms delay

**When Redis is unavailable:**
- Cache falls back to memory-only mode
- Auto-reconnect attempts with exponential backoff
- After max retries, manual restart may be needed

### TypeScript & Sequelize Version Compatibility

- **Sequelize**: Tested with v6.x (should work with v7 with minor adjustments)
- **TypeScript**: Requires TypeScript 4.5+ for proper type inference
- **Model typing**: Uses `Model<any, any>` cast for hook compatibility - may need adjustments for strict custom types

### Testing & Concurrency

**Handled safely:**
- Multiple simultaneous `getById()` calls for same ID (deduplicated)
- Concurrent reads during sync/refresh

**Not thread-safe:**
- Concurrent writes to same key from multiple processes (use Redis cluster sync)
- Race conditions in `keyField` updates (manual invalidation recommended)

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
| `maxSize` | `number \| null` | `null` | Max cache entries (LRU eviction when exceeded, null = unlimited) |
| `refreshIntervalMs` | `number` | `300000` | Auto-refresh interval (5 minutes) |
| `cleanupIntervalMs` | `number` | `60000` | TTL cleanup interval (1 minute) |
| `lazyReload` | `boolean` | `true` | Load missing items on-demand |
| `staleWhileRevalidate` | `boolean` | `true` | Return stale data while refreshing |
| `redis` | `RedisOptions` | `undefined` | Optional Redis backend configuration (see Redis section) |
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

#### `isReady(): boolean`

Check if cache has finished initializing (synchronous).

```typescript
const cache = new CacheManager(User);
cache.autoLoad();

if (cache.isReady()) {
  console.log('Cache is ready!');
}

// Or use with event
cache.on('ready', () => {
  console.log('Cache ready:', cache.isReady()); // true
});
```

#### `invalidate(field: string, value: string | number): void`

Manually invalidate (remove) a specific item from cache by field and value.

```typescript
cache.invalidate('email', 'john@example.com');
cache.invalidate('id', 123);
```

#### `getStats(): CacheStats`

Get detailed cache statistics including size, configuration, performance metrics, and status.

```typescript
const stats = cache.getStats();
console.log(stats);
// {
//   total: 1500,
//   maxSize: 10000,
//   byKey: { email: 1500, username: 1500 },
//   metrics: {
//     hits: 8542,
//     misses: 158,
//     evictions: 23,
//     totalRequests: 8700,
//     hitRate: 98.18  // Percentage
//   },
//   lastSyncAt: 1634567890000,
//   ttlMs: 60000,
//   syncing: false,
//   refreshIntervalMs: 300000,
//   lazyReload: true,
//   staleWhileRevalidate: true,
//   redisEnabled: true,
//   clusterSyncEnabled: false
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
| `evicted` | `{ id, reason }` | Item evicted from cache (LRU or size limit) |
| `error` | `Error` | Error during sync/refresh/lazy-load |
| `ready` | - | Cache initialization completed (after `autoLoad()`) |
| `redisReconnecting` | `{ attempt, delay }` | Redis reconnection attempt started |
| `redisReconnected` | - | Redis connection restored |
| `redisDisconnected` | - | Redis connection lost |

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

## 🔴 Redis Troubleshooting

### Redis connection fails but cache still works?

The cache gracefully degrades to memory-only mode if Redis is unavailable. Check your Redis connection settings and ensure the Redis server is running.

### How do I monitor Redis operations?

Enable debug logging and listen to the `error` event:
```typescript
const cache = new CacheManager(User, {
  redis: { url: 'redis://localhost:6379' },
  logger: {
    info: console.log,
    error: console.error,
    debug: console.debug,
  },
});

cache.on('error', (err) => {
  console.error('Redis error:', err);
});
```

### Can I share a Redis connection pool?

Yes! Pass an existing Redis client:
```typescript
import { createClient } from 'redis';

const redisClient = createClient();
await redisClient.connect();

const cache1 = new CacheManager(User, {
  redis: { client: redisClient },
});

const cache2 = new CacheManager(Product, {
  redis: { client: redisClient },
});
```

### What happens to Redis keys when cache is cleared?

Calling `clear()` removes all keys with the configured prefix from Redis. Calling `clear(field)` only clears the in-memory index for that field.

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
