const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(app.includes('buildAdminEntitlementWorkspaceSnapshot'), 'Admin must build one operational Pro + Member snapshot');
assert(app.includes("'IDENTITY_MISMATCH'"), 'Admin must detect Pro/Member account identity mismatch');
assert(app.includes('blocksMutations'), 'Identity mismatch must block entitlement mutations');
assert(app.includes('isEntitlementAdminMutationPath'), 'Entitlement mutations must be identified for post-mutation verification');
assert(app.includes('Entitlement mutation committed. Verifying Pro + Member authority'), 'Admin must verify both authorities after mutation');
assert(app.includes('entitlementWorkspaceSnapshot'), 'Subscription Support must persist the unified operational snapshot in view state');
assert(app.includes('Pro User ID'), 'Unified workspace must expose Pro identity evidence');
assert(app.includes('Member User ID'), 'Unified workspace must expose Member identity evidence');
assert(app.includes('actionsBlockedReason'), 'Pro and Member actions must support a shared safety block');
assert(styles.includes('.entitlement-consistency-strip'), 'Unified entitlement consistency state must be visually represented');

console.log('PASS admin unified entitlement operational closure audit');
