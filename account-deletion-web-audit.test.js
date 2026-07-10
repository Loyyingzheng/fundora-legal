const fs = require('fs');
const path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'delete-account.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'account-deletion.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'account-deletion-config.js'), 'utf8');
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

assert(html.includes('id="auth-panel"'), 'Web flow must have an authentication step.');
assert(html.includes('id="confirmation-panel"'), 'Web flow must have a separate confirmation step.');
assert(html.includes('id="final-confirmation-dialog"'), 'Web flow must have a final destructive confirmation.');
assert(html.indexOf('account-deletion-config.js') < html.indexOf('account-deletion.js'), 'Runtime config must load before the module.');
assert(js.includes('inMemoryPersistence'), 'Firebase authentication must not persist in browser storage.');
assert(js.includes('signInWithEmailAndPassword'), 'Web flow must support current password authentication.');
assert(js.includes("'X-Account-Deletion-Source': 'WEB'"), 'Web requests must be auditable as WEB source.');
assert(js.includes("/api/account/me"), 'Web and app must call the same Core deletion API.');
assert(js.includes("/api/account/deletion/status"), 'Web must recover response-loss through the same durable status API.');
assert(js.includes("'X-Account-Delete-Confirmed-At'"), 'Final confirmation evidence must be sent to Core.');
assert(js.includes("'X-Fundora-Nonce'"), 'Destructive web requests must include anti-replay integrity headers.');
assert(js.includes('sessionStorage') && !js.includes('localStorage'), 'Only the recovery token may be kept in browser session storage.');
assert(config.includes("enabledAuthProviders: Object.freeze(['password'])"), 'Google auth must remain opt-in until the app/provider policy enables it.');
assert(!config.toLowerCase().includes('serviceaccount'), 'Web config must not contain Admin SDK credentials.');

console.log('PASS account deletion web audit');
