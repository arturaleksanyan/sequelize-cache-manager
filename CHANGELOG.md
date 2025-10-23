# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2025-10-23

### Added

- **LRU Eviction**: Configurable `maxSize` option with Least Recently Used eviction
  - Prevents unbounded memory growth for large datasets
  - Automatic eviction when cache exceeds configured limit
  - `evicted` event emitted when items are removed
  - LRU tracking for all cache access operations
- **Cache Metrics**: Performance monitoring with hit/miss tracking
  - `metrics.hits` - Count of cache hits
  - `metrics.misses` - Count of cache misses
  - `metrics.evictions` - Count of LRU evictions
  - `metrics.totalRequests` - Total cache requests
  - `metrics.hitRate` - Percentage hit rate
- **Comprehensive Limitations Documentation**: New "⚠️ Limitations & Important Considerations" section
  - Caching scope (what is/isn't cached)
  - Hook-based invalidation edge cases
  - Memory management strategies
  - Stale-while-revalidate behavior
  - Large dataset syncing recommendations
  - Redis considerations
  - TypeScript & Sequelize compatibility notes
  - Testing & concurrency guidance

### Improved

- **getStats()**: Enhanced to include performance metrics, maxSize, redisEnabled, and clusterSyncEnabled
- **Memory Warnings**: Replaced generic 50k warning with `maxSize` proximity alerts (warns at 90% capacity)
- **LRU Updates**: All cache access methods (`getById`, `getByKey`) now update LRU order
- **Clear Operation**: Resets metrics on full cache clear

### Documentation

- Added detailed limitations and considerations section
- Updated API documentation with new `maxSize` option
- Updated events table with `evicted` event
- Enhanced `getStats()` documentation with metrics examples
- Added examples for memory management best practices

## [0.6.1] - 2025-10-23

### Added

- **Enhanced Redis Auto-Reconnect**: Exponential backoff reconnection strategy
  - Configurable via `redis.reconnectStrategy` option
  - Default: 10 retries with 2x exponential backoff (1s → 30s max)
  - Customizable `retries`, `factor`, `minTimeout`, `maxTimeout`
  - Both main client and Pub/Sub subscriber auto-reconnect independently
- **Reconnection Events**: New typed events for monitoring Redis connection state
  - `redisReconnecting` - Emitted on each reconnection attempt with `{ attempt, delay }`
  - `redisReconnected` - Emitted when connection is restored
  - `redisDisconnected` - Emitted when connection is lost

### Improved

- **Built-in Reconnect Strategy**: Uses Redis client's native reconnection instead of manual implementation
- **Better Connection Monitoring**: Enhanced event handlers for all Redis connection states
- **Subscriber Resilience**: Added event handlers for Pub/Sub subscriber reconnection

### Documentation

- Added comprehensive "Auto-Reconnect Behavior" section to README
- Updated `RedisOptions` interface with `reconnectStrategy` field
- Added example for monitoring and customizing reconnection behavior
- Updated events table with new Redis connection events

## [0.6.0] - 2025-10-22

### Added

- **Redis Cluster Sync**: Multi-instance cache coherence via Pub/Sub
  - Enable with `redis: { enableClusterSync: true }`
  - Automatic invalidation broadcasting across all app instances
  - Unique instance IDs prevent self-invalidation loops
  - Separate subscriber client for Redis Pub/Sub
- **isReady() Method**: Check if cache initialization is complete
  - Returns boolean flag
  - Complements existing `waitUntilReady()` and `ready` event
- **Better Logging**: Changed "no updatedAt" from warn → info level

### Improved

- **Connection Reuse Pattern**: Enhanced documentation for sharing Redis clients
- **Graceful Subscriber Cleanup**: Properly unsubscribe and quit Pub/Sub client on destroy

### Documentation

- Added cluster sync examples and use cases
- Updated Redis options with `enableClusterSync`
- Added `isReady()` method documentation

## [0.5.0] - 2025-10-22

### Added

- **Redis Backend Support**: Optional Redis persistence layer for distributed caching
  - Automatic persistence of all cache writes to Redis
  - Graceful fallback to memory-only mode if Redis unavailable
  - Support for connection URL, host/port, or external client
  - Configurable key prefixes for multi-tenant scenarios
  - Fire-and-forget writes for optimal performance
  - TTL synchronization between memory and Redis
  - Auto-reconnect on connection loss (5s retry interval)
  - Batch Redis writes using pipelines for full sync operations
- **New Events**: `ready` event emitted after `autoLoad()` completes
- **Memory Safeguards**: Warn when cache exceeds 50k entries
- **TTL Consistency**: `loadFromJSON()` now skips expired entries
- **New Example**: `examples/redis-usage.ts` demonstrating Redis integration patterns
- **Enhanced Documentation**: Comprehensive Redis configuration and troubleshooting guides

### Improved

- **Redis Performance**: Full sync now uses Redis pipelines (multi/exec) for batch writes
- **Scalable Clear**: `clear()` uses `scanIterator` instead of `KEYS` for better performance on large datasets
- **Redis TTL Fix**: Avoid passing `undefined` to Redis SET command (compatibility fix)
- **Graceful Shutdown**: Check `isOpen` before calling `quit()` on Redis client
- **Better Logging**: `loadFromJSON()` reports expired entries count
- `getById()` checks Redis when item not in memory (lazy restore)
- Dynamic Redis module loading (no compile-time dependency)

### Dependencies

- Added `redis` as optional peer dependency (>= 4.0.0)
- Added `@types/redis` to devDependencies for type safety

## [0.4.0] - 2025-10-14

### Added

- **Fully Generic Model Typing**: Constructor now accepts `SequelizeModel<T>` directly (no casting needed)
- **Configurable Cleanup Interval**: New `cleanupIntervalMs` option for TTL cleanup frequency
- **Partial Cache Clear**: `clear(field)` method to clear specific field indexes
- **Type-Safe Events**: Module augmentation provides full IntelliSense for event listeners
- **Clone Protection**: `toJSON()` now returns deep clones to prevent external mutations
- **JSDoc Comments**: Added documentation for `getManyByKey` method

### Improved

- **Robust Hook Removal**: Individual try-catch per hook type in `detachHooks()`
- **Better Sync Guards**: Warning log when sync is already in progress
- **Renamed Internal Methods**: `_expiryTime()` → `_getExpiryTime()` (clearer intent)
- **Error Type Safety**: All error emissions properly cast to `Error` type

### Breaking Changes

- Constructor signature changed from `typeof Model` to `SequelizeModel<T>` (better type inference, but requires proper Sequelize types)

### Tests

- Added 2 new tests (18 total)
- Test for partial field clearing
- Test for mutation protection in `toJSON()`

## [0.3.0] - 2025-10-14

### Added

- **Generic Model Typing**: Enhanced `SequelizeModel` interface with generic type parameter for better IntelliSense
- **Utility Methods**: New convenience methods for cache state inspection
  - `has(field, value)` - Check if item exists in cache
  - `hasById(id)` - Check if item exists by ID
  - `isExpired(id)` - Check if cached item has expired
- **Graceful Shutdown**: `handleProcessSignals()` method for automatic cleanup on SIGTERM/SIGINT
- **Manual Refresh**: `refresh(forceFull)` method to trigger cache updates externally
- **Enhanced Serialization**: `toJSON()` and `loadFromJSON()` now support metadata (expiration times)
- **Debug Logging**: Added debug-level logging when incremental sync finds no updates

### Improved

- Better logging granularity (no noise when incremental sync finds no changes)
- Metadata preservation when persisting cache to disk
- More comprehensive test coverage (16 tests)

## [0.2.0] - 2025-10-14

### Added

- **Better Type Safety**: Improved model typing with proper `SequelizeModel` interface
- **Error Handling**: Enhanced lazy loading with graceful error recovery
- **Cache Statistics**: New `getStats()` method for monitoring cache performance
- **Selective Invalidation**: New `invalidate(field, value)` method for manual cache clearing
- **Ready State Management**: New `waitUntilReady()` method to wait for cache initialization
- **Memory Tracking**: Automatic logging of cache size at 1000-item intervals
- **Incremental Sync Safety**: Automatic detection of `updatedAt` field with fallback to full sync
- **New Event**: `itemInvalidated` event emitted when items are manually removed

### Improved

- Lazy loading now catches and logs database errors instead of throwing
- Key normalization consistency with `String(value)` in all methods
- Better incremental sync robustness with `updatedAt` field validation

### Fixed

- Error handling in `_lazyLoadById` and `_lazyLoadByKey` methods

## [0.1.0] - 2025-10-14

### Added

- Initial release of `sequelize-cache-manager`
- Core `CacheManager` class with full TypeScript support
- Multi-key indexing support via `keyFields` option
- TTL-based cache expiration with automatic cleanup
- Stale-while-revalidate caching strategy
- Lazy loading for missing cache entries
- Auto-refresh with full and incremental sync modes
- Sequelize hook integration for automatic cache updates
- Event emitter interface for cache lifecycle monitoring
- Bulk fetch operations via `getManyByKey`
- JSON serialization and deserialization
- Comprehensive test suite
- Full API documentation
- Usage examples and migration guide
- CI/CD workflow with GitHub Actions

### Features

- `getById()` - Retrieve by primary key
- `getByKey()` - Retrieve by custom indexed field
- `getAll()` - Get all cached items
- `getManyByKey()` - Bulk fetch with single query
- `sync()` - Manual cache synchronization
- `autoLoad()` - One-shot initialization
- `attachHooks()` / `detachHooks()` - Hook management
- `startAutoRefresh()` / `stopAutoRefresh()` - Auto-refresh control
- `startCleanup()` / `stopCleanup()` - TTL cleanup control
- `clear()` - Cache invalidation
- `destroy()` - Complete cleanup
- `toJSON()` / `loadFromJSON()` - Serialization

### Events

- `synced` - Cache sync completed
- `refreshed` - Auto-refresh completed
- `cleared` - Cache cleared
- `itemCreated` - Item added
- `itemUpdated` - Item updated
- `itemRemoved` - Item removed
- `refreshedItem` - Item lazy-loaded
- `error` - Error occurred

[0.1.0]: https://github.com/arturaleksanyan/sequelize-cache-manager/releases/tag/v0.1.0

