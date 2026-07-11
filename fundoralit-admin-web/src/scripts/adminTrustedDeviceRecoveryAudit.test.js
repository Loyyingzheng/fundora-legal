const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(app.includes("trustedDevice: '/api/admin/account/security/trusted-device'"), 'Trusted-device status endpoint must be wired.');
assert(app.includes("enrollTrustedDevice: '/api/admin/account/security/trusted-device/enroll'"), 'Trusted-device enrollment endpoint must be wired.');
assert(app.includes("generateRecoveryCodes: '/api/admin/account/security/recovery-codes/generate'"), 'Recovery-code generation endpoint must be wired.');
assert(app.includes("consumeRecoveryCode: '/api/admin/account/security/recovery/consume'"), 'Signed-out emergency recovery endpoint must be wired.');
assert(app.includes("{ name: 'ECDSA', namedCurve: 'P-256' }"), 'Browser trust must use a P-256 device key pair.');
assert(app.includes("false,\n    ['sign', 'verify']"), 'The trusted-device private key must be generated non-extractable.');
assert(app.includes("'X-Fundora-Device-Signature'"), 'Protected Admin requests must carry a device signature.');
assert(app.includes('const canonical = `${String(method || \'GET\').toUpperCase()}\\n${String(path || \'/\')}'), 'Client and server must sign a canonical method/path/timestamp/nonce/body-hash payload.');
assert(app.includes('Only one browser device can hold active Admin access at a time.'), 'UI must explain the single-active-device rule.');
assert(app.includes('Another trusted Admin device is active. Replace it with this browser?'), 'Replacing the trusted browser must require explicit confirmation.');
assert(app.includes('Recover and reset security'), 'Signed-out recovery must have an explicit destructive action.');
assert(app.includes("confirmation: ownerMode ? 'RESET OWNER MFA' : 'RECOVER ADMIN'"), 'Recovery confirmation phrase must match the selected recovery method.');
assert(app.includes('all current Admin sessions, trusted browsers, and the old authenticator will be revoked'), 'Recovery UI must clearly explain its blast radius.');
assert(app.includes('System Owner emergency token') && app.includes('FUNDORA_ADMIN_OWNER_EMERGENCY_RECOVERY_TOKEN'), 'UI must expose the ENV-gated bootstrap recovery path when no recovery code exists.');
assert(app.includes('Cancelling a new setup does not remove that older factor'), 'UI must distinguish cancelling a pending setup from removing an already-enrolled Firebase factor.');
assert(app.includes('accounts/mfaEnrollment:withdraw'), 'Authenticator replacement must withdraw the old Firebase factor.');
assert(app.includes("indexedDB.open(ADMIN_SECURITY_DB_NAME") || app.includes("indexedDB.open(ADMIN_SECURITY_DB_NAME,"), 'Persistent login must use the encrypted IndexedDB store.');
assert(app.includes("name: 'AES-GCM'"), 'Persistent Firebase session material must remain AES-GCM encrypted.');
assert(css.includes('.trusted-device-onboarding'), 'Trusted-device onboarding needs dedicated responsive styling.');
assert(css.includes('.admin-recovery-login-form'), 'Emergency recovery needs dedicated styling.');
assert(html.includes('20260711-admin-mfa-stale-recovery-v2'), 'MFA stale-state recovery runtime must be cache-busted.');

console.log('PASS admin trusted-device and recovery audit');
