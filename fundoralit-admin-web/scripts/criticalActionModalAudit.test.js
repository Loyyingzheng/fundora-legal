const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`[criticalActionModalAudit] FAIL: ${message}`);
    process.exit(1);
  }
}

assert(source.includes('async function performCriticalModalMutation('), 'missing shared critical modal mutation helper');
assert(source.includes('reauthenticationAttempted = true'), 'critical mutation must retry at most once after re-authentication');
assert(source.includes('await promptCriticalActionReauthentication(context)'), 'critical mutation must invoke re-authentication');
assert(source.includes('const body = await buildBody();'), 'critical mutation must rebuild body/proof token per attempt');

for (const prefix of [
  'plan_policy_definition',
  'subscription_plan',
  'plan_policy_value',
  'update_feature_limit',
  'update_feature_flag',
  'update_product_policy',
]) {
  const expected = `() => ({ ...baseBody, ...criticalActionFields(`;
  assert(source.includes(prefix), `missing critical action prefix ${prefix}`);
  assert(source.includes(expected), 'critical fields must be created inside the retryable body factory');
}

const planValueSubmit = source.slice(
  source.indexOf('async function submitPlanPolicyValueModal()'),
  source.indexOf('function renderFeatureLimitToolbar()', source.indexOf('async function submitPlanPolicyValueModal()')),
);
assert(planValueSubmit.includes('performCriticalModalMutation('), 'plan policy value save must use critical modal close-loop');
assert(!/const body = \{[\s\S]*criticalActionFields\(/.test(planValueSubmit), 'plan policy value must not consume proof before entering retryable mutation');

console.log('[criticalActionModalAudit] PASS');
