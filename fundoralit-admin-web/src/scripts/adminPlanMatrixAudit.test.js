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

assert(!app.includes("{ id: 'featureLimits', label: 'Feature Limits'"), 'Feature Limits must be removed from Admin navigation.');
assert(app.includes("return tabId === 'featureLimits' ? 'planMatrix' : tabId"), 'Legacy featureLimits tab must redirect to Plan Matrix.');
assert(!app.includes("'planMatrix', 'featureLimits'"), 'Admin control tab list must not expose featureLimits.');
assert(app.includes('Feature Limits is deprecated in Admin UI'), 'Deprecated Feature Limits fallback notice is missing.');
assert(app.includes('goToPlanMatrixPolicy(policyKey)'), 'Legacy Feature Limits deep links should redirect to Plan Matrix policy search.');

assert(app.includes('planMatrixPlanPolicyValuePlan'), 'Plan Policy Values plan filter state is missing.');
assert(app.includes('function renderPlanPolicyValuePlanFilter'), 'Plan Policy Values plan filter UI is missing.');
assert(app.includes('function buildPlanPolicyValuePlanFilterKeys'), 'Plan Policy Values filter options builder is missing.');
assert(app.includes('subscriptionPlans || []).filter((plan) => plan.enabled !== false).map((plan) => plan.planKey'), 'Plan Policy Values filter must derive options from subscriptionPlans.');
assert(app.includes('Frontend-only filter. Uses loaded subscription plans and policy values without another backend call.'), 'Plan Policy Values filter must be frontend-only and documented.');
assert(app.includes('No policy values found for this plan.'), 'Plan Policy Values plan filter empty state is missing.');
assert(!app.includes('plan-policy-values?plan='), 'Plan Policy Values filter must not introduce backend filtering calls.');
assert(!app.includes("text: 'Feature Limits', onclick: () => goToFeatureLimitsForPolicy"), 'Plan Matrix rows should not route admins back to legacy Feature Limits.');

console.log('adminPlanMatrixAudit.test.js passed');
