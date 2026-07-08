const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('const code = normalizedTrim('), 'Auth failure classifier must inspect backend error code, not only HTTP status.');
assert(app.includes('const raw = normalizedTrim('), 'Auth failure classifier must inspect backend message text.');
assert(app.includes('authCodeLooksExpired'), 'Auth classifier must detect true token/session expiry codes.');
assert(app.includes('messageLooksExpired'), 'Auth classifier must detect true token/session expiry messages.');
assert(!/status\s*={3}\s*401\s*\|\|/.test(app), 'Auth classifier must not classify all 401 responses as expired sessions.');
assert(app.includes('Critical action reason') || app.includes('Audit reason must be ${ADMIN_LIMITS.auditReasonMin}-${ADMIN_LIMITS.auditReasonMax} characters.'), 'Frontend must align audit reason validation with backend min/max length.');
assert(app.includes('auditReasonMin: 10'), 'Audit reason min length must be centralized.');
assert(app.includes('status === 401) {') && app.includes('This admin action was rejected by the backend'), 'Non-auth 401 responses must stay in the modal/action flow instead of logging out.');
assert(app.includes('policyKey && planKey ? `${policyKey}:${planKey}` :'), 'Plan Policy Value synthetic ids must not collapse to colon-only ids.');
assert(app.includes('Plan policy value id is missing. Refresh Plan Matrix and try again.'), 'Plan Policy Value update must guard against missing ids instead of calling /%3A.');

console.log('adminSessionAuthClassifierAudit.test.js passed');
