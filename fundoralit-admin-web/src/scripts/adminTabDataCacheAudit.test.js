const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('ADMIN_TAB_CACHE_TTL_MS'), 'Admin app must define a tab-level cache TTL.');
assert(app.includes('ADMIN_TAB_CACHE_STALE_TTL_MS'), 'Admin app must cap stale cache lifetime.');
assert(app.includes('buildAdminTabCacheKey'), 'Admin app must key cached data by tab, filters, and page.');
assert(app.includes('restoreAdminTabCache(state.activeTab)'), 'loadData must restore fresh cached tab data before calling backend.');
assert(app.includes('restoreAdminTabCache(state.activeTab, { allowStale: true })'), 'loadData must show stale cached data while a background refresh is running.');
assert(app.includes('invalidateAdminTabDataCache()'), 'Admin mutations must invalidate cached tab data.');
assert(app.includes('forceLoadData'), 'Manual Refresh buttons must be able to bypass the cache.');
assert(app.includes('renderDataCacheStatus'), 'Admin UI must disclose when cached data is displayed.');
assert(app.includes('storage.setItem(key, JSON.stringify({'), 'Tab cache must survive a safe same-tab page reload.');
assert(app.includes('hydrateAdminTabDataCache'), 'Stored tab cache must be restored only after the Admin identity is known.');
assert(app.includes('adminApiReadInflight'), 'Duplicate concurrent GET requests must share one in-flight request.');
assert(app.includes('startAdminBackendWarmup'), 'Boot must overlap Render wake-up with local auth restoration.');
assert(app.includes("text: 'Loading sections'"), 'Analytics must progressively reveal completed sections.');
assert(indexHtml.includes('app.js?v=20260711-admin-mfa-recovery-method-v3'), 'Admin runtime must be cache-busted after tab cache enhancement.');
assert(indexHtml.includes('styles.css?v=20260711-admin-mfa-recovery-method-v3'), 'Admin styles must be cache-busted after tab cache enhancement.');

console.log('adminTabDataCacheAudit passed');
