const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(app.includes('Existing authenticator detected'), 'UI must not call a stale enrolled factor a newly completed setup.');
assert(app.includes('Cancelling a new setup does not remove that older factor'), 'UI must explain pending-cancel versus factor removal.');
assert(app.includes('I no longer have access to this authenticator'), 'Locked owners need a direct recovery path.');
assert(app.includes("value: 'OWNER_EMERGENCY'"), 'Recovery method must support System Owner emergency reset.');
assert(app.includes("ownerEmergencyToken: ownerMode ? ownerEmergencyToken.value : ''"), 'Emergency token must be sent only in owner recovery mode.');
assert(app.includes("confirmation: ownerMode ? 'RESET OWNER MFA' : 'RECOVER ADMIN'"), 'Destructive confirmation must be method-specific.');
assert(html.includes('20260711-admin-mfa-stale-recovery-v2'), 'Deployment must bypass the old cached runtime.');

console.log('PASS admin stale MFA recovery UX audit');
