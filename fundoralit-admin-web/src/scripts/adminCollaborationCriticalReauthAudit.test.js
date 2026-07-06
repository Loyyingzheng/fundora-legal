const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const fail = (message) => {
  console.error(`Admin collaboration critical reauth audit failed: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => { if (!condition) fail(message); };

assert(app.includes("async function clearCollaborationPolicyCache(reason = '', options = {})"), 'clearCollaborationPolicyCache must accept explicit options.');
assert(app.includes("forceTokenRefresh: options.forceTokenRefresh === true"), 'Collaboration cache clear must be able to force a fresh Firebase ID token after reauth.');
assert(app.includes("await clearCollaborationPolicyCache(reason.value, { forceTokenRefresh: true })"), 'Emergency action cache clear must use freshly reauthenticated token.');
assert(app.includes("Enter admin password to re-authenticate before clearing collaboration cache."), 'Manual cache clear must require admin password before critical backend call.');
assert(app.includes("await reauthenticateAdminForCriticalAction(password);\n            const result = await clearCollaborationPolicyCache('Manual emergency console cache clear.', { forceTokenRefresh: true })"), 'Manual cache clear must reauth before sending critical action payload.');

console.log('Admin collaboration critical reauth audit passed.');
