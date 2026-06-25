const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes("id: 'planMatrix'"), 'Plan Matrix nav item is missing.');
assert(app.includes("planMatrix: {"), 'Plan Matrix API paths are missing.');
assert(app.includes('GET /api/config/plan-matrix') || app.includes("'/api/config/plan-matrix'"), 'Plan Matrix config endpoint is missing.');
assert(app.includes('policyDefinitions') && app.includes('subscriptionPlans') && app.includes('planPolicyValues'), 'Policy registry endpoints are missing.');
assert(app.includes('function renderPlanMatrixTable'), 'Dynamic Plan Matrix table renderer is missing.');
assert(app.includes('...plans.map'), 'Plan Matrix table must render dynamic plan columns.');
assert(!app.includes("el('th', { text: 'Free' })") && !app.includes("el('th', { text: 'Pro' })"), 'Plan Matrix table should not hardcode Free/Pro columns.');
assert(app.includes('function renderPolicyDefinitionModal'), 'Policy Definition editor modal is missing.');
assert(app.includes('function renderSubscriptionPlanModal'), 'Subscription Plan editor modal is missing.');
assert(app.includes('function renderPlanPolicyValueModal'), 'Plan Policy Value editor modal is missing.');
assert(app.includes('WEEKLY') && app.includes('MONTHLY') && app.includes('periodType'), 'Value editor must support weekly/monthly period changes.');


assert(app.includes('function loadDynamicSubscriptionPlanFilterKeys'), 'Old Feature Limits page must fetch dynamic subscription plans for its plan filter.');
assert(app.includes("API_PATHS.subscriptionPlans.list") && app.includes('PLAN_FILTER_FALLBACK_WARNING'), 'Feature Limits plan filter must be subscription-plans backed and fallback-safe.');
assert(app.includes('buildDynamicPlanFilterOptions(state.adminOptions.featureLimitPlanKeys'), 'Feature Limits toolbar must render dynamic plan filter options.');
assert(!app.includes("const plan = select(['', 'FREE', 'PRO'], state.adminFilters.plan"), 'Feature Limits plan filter must not hardcode only FREE/PRO.');
assert(app.includes('View in Plan Matrix'), 'Feature Limits rows should link to Plan Matrix for close-loop audit.');
assert(app.includes('Feature Limits') && app.includes('Product Policy') && app.includes('isPlanMatrixFeatureLimitRelated'), 'Plan Matrix rows should include safe cross-links back to old policy pages when related.');

console.log('adminPlanMatrixAudit.test.js passed');
