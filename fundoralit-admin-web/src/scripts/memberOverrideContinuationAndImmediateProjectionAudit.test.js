const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(app.includes('function mergeMemberSupportResultIntoSubscriptionUserList'), 'Member override must immediately merge the authoritative response into the visible user row.');
assert(app.includes("membershipActive: Boolean(member.active)"), 'Immediate projection must update Member active state.');
assert(app.includes('memberAdminOverrideMode:'), 'Immediate projection must update Member override mode.');
assert(app.includes("state.modal.message = 'Administrator verification completed. Applying the Member override…'"), 'Post-TOTP continuation should expose progress instead of appearing to do nothing.');
assert(app.includes('result = await applyWithProof(reauthToken);'), 'Member override must continue to the API after proof acquisition.');
assert(app.includes('mergeMemberSupportResultIntoSubscriptionUserList(result, m.user);'), 'Successful Member override must update the visible support row before background refresh.');
assert(app.includes("path: API_PATHS.memberSupport.override(m.user.userId)"), 'Mutation refresh must retain the Member override path/result context.');
assert(app.includes('memberStatus: firstPresent(item.memberStatus, item.member_status)'), 'Subscription user normalization must preserve Member status fields.');
assert(app.includes('memberProvider: firstPresent(item.memberProvider, item.member_provider)'), 'Subscription user normalization must preserve Member provider fields.');

console.log('PASS Member override continuation + immediate projection audit');
