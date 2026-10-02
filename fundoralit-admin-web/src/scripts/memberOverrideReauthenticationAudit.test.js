const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(app.includes("function isAdminRecentReauthenticationError"), "Missing Member recent re-authentication error classifier.");
assert(app.includes("promptCriticalActionReauthentication('MEMBER_OVERRIDE')"), "Member override must reuse critical Firebase re-authentication.");
assert(app.includes("requireAuditReason(m.reason, 'the Member override')"), "Member override must reuse canonical audit reason validation.");
assert(app.includes("clearModalFieldErrorLive(reason, 'reason')"), "Member reason field must clear stale validation while typing.");
assert(app.includes("Retry the exact Member override once"), "Member override must retry only after successful recent re-authentication.");
assert(!app.includes("if (m.mode !== 'NONE' && !reason) return validationError('Audit reason is required.'"), "Legacy Member-only validation must be removed.");

console.log('PASS member override re-authentication audit');
