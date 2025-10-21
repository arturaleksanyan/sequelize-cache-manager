# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/yourusername/sequelize-cache-manager/releases/tag/v0.1.0

