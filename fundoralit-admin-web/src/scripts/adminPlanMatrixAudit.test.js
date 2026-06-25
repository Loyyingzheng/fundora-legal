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

console.log('adminPlanMatrixAudit.test.js passed');
