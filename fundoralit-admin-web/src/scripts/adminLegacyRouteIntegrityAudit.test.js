const fs = require('fs');
const path = require('path');
const assert = require('assert');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
for (const prefix of ['/api/feedback/admin', '/api/subscription/feedback-trial/admin', '/api/review-prompts/admin', '/api/analytics/admin']) {
  assert(app.includes(`normalizedPath.startsWith('${prefix}')`), `Admin web must send integrity headers for ${prefix} mutations.`);
}
assert(app.includes('function getStoredAuthSession() {\n  return null;\n}'), 'Admin web must not restore refreshToken from browser storage.');
assert(!/sessionStorage\s*\.\s*setItem[\s\S]*refreshToken/i.test(app), 'Admin web must not persist refreshToken to sessionStorage.');
assert(!/localStorage\s*\.\s*setItem[\s\S]*refreshToken/i.test(app), 'Admin web must not persist refreshToken to localStorage.');
assert(!app.includes('innerHTML = String(value)'), 'Admin web must not render dynamic html with innerHTML helper.');
console.log('PASS admin legacy route integrity audit');
