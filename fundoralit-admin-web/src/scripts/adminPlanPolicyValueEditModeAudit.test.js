const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('function findExistingPlanPolicyValueRecord('), 'Plan policy modal must detect an existing policy+plan value before saving.');
assert(app.includes('function syncPlanPolicyValueExistingRecord('), 'Plan policy modal must switch create/edit mode when policy or plan changes.');
assert(app.includes("onPlanPolicyValueSelectionChange(modal, 'policyKey', value)"), 'Policy key dropdown must resync existing value mode.');
assert(app.includes("onPlanPolicyValueSelectionChange(modal, 'planKey', value)"), 'Plan key dropdown must resync existing value mode.');
assert(app.includes('if (modal.isCreate && existingRecord)'), 'Create flow must fall back to update when the selected policy+plan already exists.');
assert(app.includes('This policy and plan already has a value.'), 'Duplicate backend errors must be mapped to field-level guidance.');
assert(app.includes('state.modal.error = Object.keys(fieldErrors).length ?'), 'Field-level validation must not show a large modal error banner.');
assert(app.includes('canonicalModalFieldKey('), 'Backend field error keys must be normalized to frontend modal field keys.');

console.log('adminPlanPolicyValueEditModeAudit.test.js passed');
