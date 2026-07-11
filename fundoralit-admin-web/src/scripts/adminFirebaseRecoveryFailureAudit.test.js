const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

for (const code of [
  'AUTH_FIREBASE_CONFIGURATION_INVALID',
  'AUTH_FIREBASE_PERMISSION_DENIED',
  'AUTH_FIREBASE_PROJECT_MISMATCH',
  'AUTH_FIREBASE_REQUEST_REJECTED',
  'AUTH_FIREBASE_MFA_RESET_NOT_CONFIRMED',
  'AUTH_FIREBASE_UNAVAILABLE',
]) assert(app.includes(code), `Admin Web must explain ${code}.`);

assert(app.includes('Recovery is resumable.'), 'Recovery form must explain safe retry semantics.');
assert(app.includes('retry the same recovery'), 'Firebase failures must tell the owner to resume, not restart.');
assert(html.includes('20260711-admin-mfa-recovery-method-v3-firebase-recovery-saga-v4'), 'Static cache version must change for the recovery update.');

console.log('PASS Admin Firebase recovery failure UX audit');
