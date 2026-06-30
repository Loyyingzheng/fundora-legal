const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!app.includes("{ id: 'featureLimits', label: 'Feature Limits'"), 'Feature Limits should not appear in the Admin sidebar navigation.');
assert(app.includes("function normalizeAdminTab(tabId)"), 'Legacy tab normalizer is missing.');
assert(app.includes("return tabId === 'featureLimits' ? 'planMatrix' : tabId"), 'featureLimits direct tab must redirect to Plan Matrix.');
assert(app.includes('Plan Matrix is the source of truth'), 'Feature Limits deprecation copy must make Plan Matrix the source of truth.');
assert(app.includes('feature_limits') || app.includes('featureLimits'), 'Legacy Feature Limits backend compatibility should remain present; do not delete fallback API/table usage yet.');
assert(app.includes('PolicyService.bridgePlanMatrixLimits') || app.includes('Plan Matrix as the source of truth') || app.includes('plan_policy_values'), 'Audit should preserve the Plan Matrix source-of-truth explanation.');

console.log('adminFeatureLimitsDeprecatedAudit.test.js passed');
