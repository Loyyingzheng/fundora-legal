const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('const hadVisibleData = Boolean(getScopedData())'), 'Manual refresh must preserve visible data instead of blanking the page.');
assert(app.includes('if (!background && !hadStaleCache && !hadVisibleData) clearScopedData'), 'Foreground loading should only clear content when no usable data exists; background refresh must preserve the current view.');
assert(app.includes('buildAdminApiInflightKey'), 'GET requests need a stable single-flight key.');
assert(app.includes('executeApiRequest(path, options)'), 'API transport must remain centralized behind single-flight dedupe.');
assert(app.includes('analyticsData: state.analyticsData'), 'Analytics results must participate in tab caching.');
assert(app.includes('currentAnalyticsView().sections.map'), 'Growth Analytics must request only the active domain.');
assert(app.includes('await Promise.all(sectionRequests)'), 'The active analytics domain must resolve as one render unit.');
assert(!app.includes('scheduleProgressRender'), 'Analytics must not rebuild the full page after every endpoint response.');
assert(app.includes("fetch(`${baseUrl}/health`"), 'Render health warm-up must start before the first protected module request.');

assert(app.includes('if (!getScopedData()) clearScopedData(loadRequest.tab);'), 'A failed refresh must retain already visible cached data.');

console.log('adminLoadingPerformanceAudit passed');
