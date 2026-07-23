const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('const hadVisibleData = Boolean(getScopedData())'), 'Manual refresh must preserve visible data instead of blanking the page.');
assert(app.includes('if (!hadStaleCache && !hadVisibleData) clearScopedData'), 'Loading should only clear content when no usable data exists.');
assert(app.includes('buildAdminApiInflightKey'), 'GET requests need a stable single-flight key.');
assert(app.includes('executeApiRequest(path, options)'), 'API transport must remain centralized behind single-flight dedupe.');
assert(app.includes('analyticsData: state.analyticsData'), 'Analytics results must participate in tab caching.');
assert(app.includes('scheduleProgressRender'), 'Analytics sections must render progressively instead of waiting for the slowest endpoint.');
assert(app.includes("fetch(`${baseUrl}/health`"), 'Render health warm-up must start before the first protected module request.');

assert(app.includes('if (!getScopedData()) clearScopedData(loadRequest.tab);'), 'A failed refresh must retain already visible cached data.');

console.log('adminLoadingPerformanceAudit passed');
