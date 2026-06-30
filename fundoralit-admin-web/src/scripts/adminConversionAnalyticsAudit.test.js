const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

assert(app.includes("conversion: '/api/analytics/admin/conversion'"), 'conversion API path is missing');
assert(app.includes("['conversion', API_PATHS.analytics.conversion]"), 'loadAnalyticsData must request conversion metrics');
assert(app.includes('conversion: null'), 'analytics state must include conversion segment');
assert(app.includes('Free to Pro Conversion Funnel'), 'dashboard must render Free to Pro Conversion Funnel');
assert(app.includes('Limit Modal Performance'), 'dashboard must render Limit Modal Performance');
assert(app.includes('Source Screen Performance'), 'dashboard must render Source Screen Performance');
assert(app.includes('Upgrade CTR'), 'dashboard must render Upgrade CTR');
assert(app.includes('Dismiss Rate'), 'dashboard must render Dismiss Rate');
assert(app.includes('Trial extension CTR'), 'dashboard must render Trial extension CTR');
assert(app.includes('Feature Value Drivers'), 'dashboard must render Feature Value Drivers section');
assert(app.includes('toneForMinimum') && app.includes('toneForMaximum'), 'dashboard must include readable health tones');
assert(styles.includes('analytics-helper-text'), 'styles must include helper text class');
['merchant', 'payee', 'ocrText', 'notificationText', 'rawText', 'amount'].forEach((sensitive) => {
  assert(!app.includes(`'${sensitive}'`) && !app.includes(`"${sensitive}"`), `admin dashboard must not render sensitive raw field ${sensitive}`);
});

console.log('adminConversionAnalyticsAudit passed');
