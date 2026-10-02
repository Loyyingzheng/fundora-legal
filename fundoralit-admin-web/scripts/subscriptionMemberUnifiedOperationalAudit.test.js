const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

assert(app.includes("renderMemberEntitlementSupportCard(memberUser, { error = '', searchedEmail = '', permissions = {} } = {})"), 'Member card must own its lookup/error state');
assert(app.includes("text: 'LOOKUP ERROR'"), 'Member lookup failure must render inside Member card');
assert(app.includes("text: 'Retry Member lookup'"), 'Member card needs isolated retry');
assert(app.includes("text: hasSearch ? 'NO MEMBER RECORD' : 'READY'"), 'Member card must distinguish ready vs no record');
assert(app.includes('...(exactMemberPayload.permissions || {})'), 'Member permissions must merge into unified support context');
assert(app.includes('...(exactMemberUserBase?.permissions || {})'), 'Nested Member permissions must merge into unified support context');
assert(app.includes("renderMemberEntitlementSupportCard(memberUser, { error: errors.memberError || '', searchedEmail, permissions })"), 'Unified workspace must pass Member error/context into Member card');
assert(!app.includes("if (state.data?.memberLookupError) children.push(el('div'"), 'Member lookup error must not be detached above the unified cards');
console.log('PASS subscription + Member unified operational support audit');
