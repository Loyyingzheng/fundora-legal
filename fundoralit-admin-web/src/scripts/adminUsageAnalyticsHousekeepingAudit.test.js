const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

assert(app.includes("usagePeriods: '/api/analytics/admin/usage-periods'"), 'Admin Web must call usage-period analytics endpoint');
assert(app.includes("['usagePeriods', API_PATHS.analytics.usagePeriods]"), 'Features analytics view must load usage-period analytics');
assert(app.includes("'Usage & quota trend'"), 'Growth Analytics must render usage/quota trend');
assert(app.includes('usageClosedPeriodRetentionMonths'), 'System Housekeeping must expose closed-period usage retention');
assert(app.includes('usageEventRetentionDays'), 'System Housekeeping must expose usage event retention');
assert(app.includes('usageAggregateRetentionDays'), 'System Housekeeping must expose usage aggregate retention');
assert(app.includes("unit: 'months'"), 'Usage hot-history retention must be edited in months');
assert(app.includes('Shared usage retention values are also delivered through Mobile Policy'), 'Housekeeping UI must explain mobile control propagation');
console.log('PASS admin usage analytics + housekeeping control close loop');
