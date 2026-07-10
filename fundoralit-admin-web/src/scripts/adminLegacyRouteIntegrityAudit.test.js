const fs = require('fs');
const path = require('path');
const assert = require('assert');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
for (const prefix of ['/api/feedback/admin', '/api/subscription/feedback-trial/admin', '/api/review-prompts/admin', '/api/analytics/admin']) {
  assert(app.includes(`normalizedPath.startsWith('${prefix}')`), `Admin web must send integrity headers for ${prefix} mutations.`);
}
assert(app.includes("const ADMIN_SECURITY_DB_NAME = 'fundoralit-admin-security-v1'"), 'Admin web must use dedicated IndexedDB secure storage.');
assert(app.includes("crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false"), 'Stored Firebase sessions must be encrypted with a non-extractable AES key.');
assert(app.includes('crypto.subtle.decrypt'), 'Admin web must restore the encrypted session instead of forcing login on every reopen.');
assert(app.includes('queueAdminAuthStorage'), 'Session writes and deletes must be serialized to prevent stale refresh-token resurrection.');
assert(!/sessionStorage\s*\.\s*setItem[\s\S]*refreshToken/i.test(app), 'Admin web must not persist refreshToken to sessionStorage.');
assert(!/localStorage\s*\.\s*setItem[\s\S]*refreshToken/i.test(app), 'Admin web must not persist refreshToken to localStorage.');
assert(!app.includes('innerHTML = String(value)'), 'Admin web must not render dynamic html with innerHTML helper.');
console.log('PASS admin legacy route integrity audit');
