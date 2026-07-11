const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(app.includes('isRetryableFirebaseTokenFailure'), 'API retry must classify the first backend response before retrying.');
assert(app.includes("code === 'AUTH_TOKEN_INVALID'"), 'Only a concrete Firebase token failure may trigger refresh.');
assert(app.includes("if (code) return false;"), 'Business 401 codes such as ADMIN_MFA_REQUIRED must never be replayed.');
assert(app.includes('headers = await createAuthenticatedApiHeaders(`${url.pathname}${url.search}`, options, body, true)'), 'A permitted retry must rebuild headers with a fresh nonce.');
assert(!app.includes("if (response.status === 401 && options.forceTokenRefresh !== true)"), 'The old retry-all-401 implementation must be removed.');
assert(app.includes("backendCode === 'ADMIN_MFA_REQUIRED'"), 'MFA bootstrap errors need a direct user-facing explanation.');
assert(app.includes("backendCode === 'AUTH_NONCE_REPLAYED'"), 'Nonce replay needs a specific recovery message.');
assert(app.includes('mfaRequired && !mfaSatisfied'), 'Sensitive-action verification must be gated until MFA is satisfied.');
assert(app.includes('Generate authenticator setup key'), 'TOTP enrollment must explain that setup generates the key before a code exists.');
assert(html.includes('20260711-admin-mfa-recovery-method-v3'), 'Nonce retry fix must remain cache-busted.');
console.log('PASS admin nonce retry close-loop audit');
