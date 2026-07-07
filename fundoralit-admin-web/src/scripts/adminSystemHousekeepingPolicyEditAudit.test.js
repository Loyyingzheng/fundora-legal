const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

assert(app.includes('api(API_PATHS.productPolicies.list)'), 'System Housekeeping must load product policies so housekeeping_policy is editable from the page.');
assert(app.includes('systemHousekeepingPolicy'), 'System Housekeeping scoped data must store housekeeping_policy row.');
assert(app.includes('HOUSEKEEPING_POLICY_FIELD_RANGES'), 'Admin Web must validate editable housekeeping retention ranges before PATCH.');
[
  'personalDeletedDays',
  'auditLogDays',
  'smartCaptureDays',
  'cloudBackupDays',
  'subscriptionSupportClosedRequestDays',
  'subscriptionSupportApplyFailedRequestDays',
  'learningEventRetentionDays',
  'learningRejectedCandidateRetentionDays',
  'learningInactiveRuleRetentionDays',
  'learningAggregateRetentionDays',
  'learningProtectedLatestRuleVersions',
].forEach((field) => assert(app.includes(field), `Admin Web must expose ${field} in housekeeping retention edit flow.`));
assert(app.includes('updateHousekeepingRetentionSetting'), 'System Housekeeping retention cards must support direct retention edit.');
assert(app.includes('API_PATHS.productPolicies.update(getItemId(policy))'), 'Retention edit must PATCH Product Policy, not only local UI state.');
assert(app.includes('forceTokenRefresh: true'), 'Housekeeping policy mutations must request a fresh token.');
assert(app.includes("confirmPhrase !== 'UPDATE PRODUCT POLICY'"), 'Housekeeping policy edit must require critical confirmation phrase.');
assert(app.includes('Edit housekeeping policy'), 'System Housekeeping must provide full JSON policy edit entry point.');
assert(app.includes('Open Product Policy'), 'System Housekeeping must provide fallback navigation to Product Policy.');
assert(app.includes('Product Policy housekeeping_policy with env fallback'), 'System Housekeeping copy must explain runtime policy source.');
const cleanupJobGridCount = (app.match(/jobs\.map\(renderSystemHousekeepingJobCard\)/g) || []).length;
assert(cleanupJobGridCount === 1, 'Cleanup jobs must render once, not duplicate the same cards.');
console.log('PASS admin system housekeeping policy edit audit');
