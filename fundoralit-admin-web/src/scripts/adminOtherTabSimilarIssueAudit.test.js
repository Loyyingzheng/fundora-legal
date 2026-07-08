const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'app.js');
const htmlPath = path.resolve(__dirname, '..', '..', 'index.html');
const source = fs.readFileSync(appPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(source.includes("return el('div', { class: modalFieldClass(key) }, [el('label', { text: label }), input, renderFieldError(key)])"), 'Announcement text fields must use modalFieldClass/renderFieldError through helper.');

[
  'findExistingPolicyDefinitionRecord',
  'findExistingSubscriptionPlanRecord',
  'findExistingRateLimitOverrideRecord',
  'applyPolicyDefinitionRecordToModal',
  'applySubscriptionPlanRecordToModal',
  'applyRateLimitOverrideRecordToModal',
].forEach((symbol) => {
  assert(source.includes(`function ${symbol}`), `Missing ${symbol} for create-vs-update duplicate protection.`);
});

[
  "applyPolicyDefinitionRecordToModal(modal, existingRecord, { preserveUserValue: true })",
  "applySubscriptionPlanRecordToModal(modal, existingRecord, { preserveUserValue: true })",
  "applyRateLimitOverrideRecordToModal(modal, existingRecord, { preserveUserValue: true })",
].forEach((snippet) => {
  assert(source.includes(snippet), `Missing auto-switch from create to update: ${snippet}`);
});

[
  "policyDefinitionEdit')",
  "subscriptionPlanEdit')",
  "rateLimitOverrideEdit')",
  "inferred.policyKey",
  "inferred.planKey",
  "inferred.routeGroup",
].forEach((snippet) => {
  assert(source.includes(snippet), `Missing duplicate backend error field mapping snippet: ${snippet}`);
});

[
  "'data-field-key': key",
  "'data-field-key': 'priority'",
  "'data-field-key': 'startAt'",
  "'data-field-key': 'endAt'",
  "'data-field-key': 'mediaUrl'",
  "'data-field-key': 'ctaAction'",
  "modalFieldClass('type')",
  "modalFieldClass('displayMode')",
  "modalFieldClass('targetPlan')",
  "modalFieldClass('targetPlatform')",
  "modalFieldClass('priority')",
  "modalFieldClass('startAt')",
  "modalFieldClass('endAt')",
].forEach((snippet) => {
  assert(source.includes(snippet), `Announcement modal still lacks field-level error UI: ${snippet}`);
});

[
  "validationError(titleEn.message, 'titleEn')",
  "validationError(messageEn.message, 'messageEn')",
  "validationError(priority.message, 'priority')",
  "validationError(startAt.message, 'startAt')",
  "validationError(endAt.message, 'endAt')",
  "validationError('Start time cannot be later than end time.', 'startAt')",
  "validationError(ctaLabelEn.message, 'ctaLabelEn')",
].forEach((snippet) => {
  assert(source.includes(snippet), `Announcement client validation still uses global banner instead of field-level: ${snippet}`);
});

[
  "route_group: 'routeGroup'",
  "per_minute: 'perMinute'",
  "expires_at: 'expiresAt'",
  "title_en: 'titleEn'",
  "message_en: 'messageEn'",
  "display_mode: 'displayMode'",
  "target_plan: 'targetPlan'",
  "target_platform: 'targetPlatform'",
  "cta_action: 'ctaAction'",
].forEach((snippet) => {
  assert(source.includes(snippet), `Backend field alias not covered: ${snippet}`);
});

assert(html.includes('20260708-other-tab-field-error-v5'), 'index.html cache-bust version was not updated.');
console.log('adminOtherTabSimilarIssueAudit.test passed');
