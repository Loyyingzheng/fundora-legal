const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const fail = (message) => {
  console.error(`Admin collaboration policy status audit failed: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => { if (!condition) fail(message); };

assert(app.includes("status: '/api/admin/collaboration-policy/cache/status'"), 'Admin Web must know the collaboration policy cache status endpoint.');
assert(app.includes('async function loadCollaborationPolicyCacheStatus()'), 'Emergency Console must load collaboration policy cache status.');
assert(app.includes("loadCollaborationPolicyCacheStatus(),"), 'Emergency Console load must include collaboration status in its data bundle.');
assert(app.includes('collaborationPolicyStatus: normalizeAdminObjectResponse(read(7, {}))'), 'Loaded collaboration status must be stored in scoped data.');
assert(app.includes('function renderCollaborationPolicyStatusCard()'), 'Emergency Console must render a dedicated collaboration policy status card.');
assert(app.includes('renderCollaborationPolicyStatusCard(),'), 'Emergency Console must place the status card before emergency action cards.');
assert(app.includes('staleWriteStopSanitized'), 'Status UI must surface stale write-stop sanitization.');
assert(app.includes('failOpenDataPlane'), 'Status UI must surface fail-open data-plane mode.');
assert(app.includes('writeStopTrusted'), 'Status UI must show whether write-stop flags are trusted.');
assert(app.includes('Refresh status'), 'Status UI must support refresh without blindly clearing cache.');
assert(app.includes('Clear cache + reload status'), 'Status UI must still expose critical cache clear with reload.');
assert(app.includes('Manual emergency console cache clear from status panel.'), 'Status panel cache clear must have an auditable reason.');
assert(app.includes('await reauthenticateAdminForCriticalAction(password);\n            const result = await clearCollaborationPolicyCache'), 'Status panel cache clear must re-authenticate before clearing.');
assert(styles.includes('.collaboration-policy-status-card'), 'Status card must have a dedicated visual style.');

console.log('Admin collaboration policy status audit passed.');
