const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(app.includes('function resolveMemberOverridePrimaryAction'), 'Missing status-driven Member override action resolver.');
assert(app.includes("? { mode: 'FORCE_NON_MEMBER', label: 'Force non-Member'"), 'Active Member must expose Force non-Member.');
assert(app.includes(": { mode: 'FORCE_MEMBER', label: 'Force Member'"), 'Non-member must expose Force Member.');
assert(app.includes('renderMemberOverrideActions(memberUser, member)'), 'Member support surfaces must reuse centralized override actions.');
assert(!app.includes("text: 'Force Member', disabled: member.adminOverrideMode"), 'Legacy dual Member buttons must be removed.');
assert(!app.includes("text: 'Force non-Member', disabled: member.adminOverrideMode"), 'Legacy dual Member buttons must be removed.');
assert(app.includes('isAdminRecentReauthenticationError(error) || isCriticalActionProofError(error)'), 'Member override must classify security failures for a fresh proof retry.');
assert(app.includes('Retry the exact Member override once with a fresh one-time critical proof.'), 'Member override must retry once after fresh critical proof.');
assert(app.includes("idempotencyKey: createAdminIdempotencyKey('member_override')"), 'Member override retry must retain one idempotency key per action.');
console.log('PASS Member status-driven override + critical proof retry audit');
