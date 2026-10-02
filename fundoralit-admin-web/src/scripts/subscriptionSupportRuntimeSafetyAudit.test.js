const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(app.includes("const actionsBlockedReason = 'Search this exact email to open the verified entitlement workspace before applying support actions.';"), 'Broad subscription rows must define a read-only actionsBlockedReason.');
assert(app.includes('renderSubscriptionSupportActions(normalizedSummary, permissions, { actionsBlockedReason })'), 'Subscription action renderer must always receive an explicit actionsBlockedReason in guarded contexts.');
assert(app.includes('renderProEntitlementSupportCard(proSummary, permissions, { actionsBlockedReason: blockedReason })'), 'Unified Pro card must receive consistency block reason.');
assert(app.includes("renderMemberEntitlementSupportCard(memberUser, { error: errors.memberError || '', searchedEmail, permissions, actionsBlockedReason: blockedReason })"), 'Unified Member card must receive consistency block reason.');
console.log('PASS subscription support runtime safety audit');
