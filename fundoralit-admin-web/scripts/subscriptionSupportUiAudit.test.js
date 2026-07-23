'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes("activeView: 'users'"), 'Subscription Support should default to the user entitlement view.');
assert(app.includes("tab('users', 'User subscriptions'"), 'User subscriptions tab is missing.');
assert(app.includes("tab('requests', 'Approval requests'"), 'Approval requests tab is missing.');
assert(app.includes("if (effectivePro) {\n    addAction('GRANT_COMPENSATION_DAYS'"), 'Effective Pro action branch is missing.');
assert(app.includes("if (!cancellationScheduled) addAction('CORRECT_TO_FREE'"), 'End-Pro action must be gated by cancellation state.');
assert(app.includes("} else {\n    addAction('CORRECT_TO_PRO'"), 'Free/inactive action branch must expose Pro entitlement correction.');
assert(!app.includes("text: 'Request cancel / Free'"), 'Legacy ambiguous cancel/Free button must not return.');
assert(!app.includes('select(ADMIN_ENUMS.subscriptionRequestTypes, modal.requestType'), 'Request type must be locked after choosing a state-valid action.');
assert(app.includes("status: 'PENDING'"), 'Pending request fetch is required for duplicate/conflict prevention.');
assert(app.includes('pendingSubscriptionRequestsForUser'), 'Per-user conflicting pending request guard is missing.');
assert(app.includes('Free users never receive an end-Pro or cancellation button.'), 'Free-state UX guard copy is missing.');
assert(css.includes('.subscription-support-view-tabs'), 'Subscription Support tab styles are missing.');
assert(css.includes('.subscription-action-panel'), 'State-driven subscription action styles are missing.');

const start = app.indexOf('function normalizeSubscriptionUserSummary');
const end = app.indexOf('function renderSubscriptionSupportActions');
assert(start >= 0 && end > start, 'Could not isolate subscription action policy for behavioral tests.');

const context = {
  state: { data: { pendingRequests: [] } },
  firstPresent: (...values) => values.find((value) => value !== undefined && value !== null && value !== '') ?? '',
  asBoolean: (value, fallback = false) => value === undefined || value === null || value === '' ? fallback : (typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true'),
  normalizedEmail: (value) => String(value || '').trim().toLowerCase(),
  formatDate: (value) => String(value || '-'),
  normalizeSubscriptionRequestItem: (item = {}) => ({
    targetUserId: item.targetUserId || item.target_user_id || '',
    targetUserEmail: item.targetUserEmail || item.target_user_email || '',
    requestType: item.requestType || item.request_type || '',
    status: item.status || 'PENDING',
  }),
  console,
};

vm.runInNewContext(`${app.slice(start, end)}\nglobalThis.__getActionState = getSubscriptionSupportActionState;`, context);
const getActionState = context.__getActionState;
const types = (summary) => getActionState(summary, { supportAdmin: true }).actions.map((item) => item.type);

assert(JSON.stringify(types({ userId: 'free-1', email: 'free@example.com', tier: 'FREE', status: 'ACTIVE' })) === JSON.stringify(['CORRECT_TO_PRO', 'GRANT_TRIAL']), 'Free user should only expose Pro correction and eligible trial.');
assert(JSON.stringify(types({ userId: 'free-2', email: 'used@example.com', tier: 'FREE', status: 'ACTIVE', trialUsed: true })) === JSON.stringify(['CORRECT_TO_PRO']), 'Trial-used Free user should not receive another trial action.');
assert(JSON.stringify(types({ userId: 'pro-1', email: 'pro@example.com', tier: 'PRO', status: 'ACTIVE' })) === JSON.stringify(['GRANT_COMPENSATION_DAYS', 'CORRECT_TO_FREE']), 'Active Pro should expose compensation and end-Pro actions only.');
assert(JSON.stringify(types({ userId: 'pro-2', email: 'scheduled@example.com', tier: 'PRO', status: 'ACTIVE', cancellationEffectiveAt: '2999-01-01T00:00:00Z' })) === JSON.stringify(['GRANT_COMPENSATION_DAYS']), 'Scheduled cancellation must hide duplicate end-Pro action.');
assert(types({ userId: 'pro-3', email: 'reactivated@example.com', tier: 'PRO', status: 'ACTIVE', cancelledAt: '2025-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }).includes('CORRECT_TO_FREE'), 'Historical cancellation metadata must not block a reactivated Pro entitlement.');
assert(!types({ userId: 'pro-4', email: 'expired@example.com', tier: 'PRO', status: 'EXPIRED' }).includes('CORRECT_TO_FREE'), 'Expired Pro must not show end-Pro/cancel action.');

context.state.data.pendingRequests = [{ targetUserId: 'free-5', targetUserEmail: 'pending@example.com', requestType: 'CORRECT_TO_PRO', status: 'PENDING' }];
const pendingState = getActionState({ userId: 'free-5', email: 'pending@example.com', tier: 'FREE', status: 'ACTIVE' }, { supportAdmin: true });
assert(pendingState.blockingPending, 'Existing pending request should lock new entitlement actions.');
assert(pendingState.actions.every((item) => item.enabled === false), 'All conflicting actions should be disabled while a request is pending.');

console.log('[subscriptionSupportUiAudit] PASS');
