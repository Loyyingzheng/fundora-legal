const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(!app.includes("{ id: 'memberSupport', label: 'Member Support'"), 'Member Support must not remain a separate navigation page');
assert(app.includes("if (tabId === 'memberSupport') return 'subscriptionSupport';"), 'Legacy Member Support deep links must redirect to Subscription Support');
assert(app.includes('renderUnifiedEntitlementSupportWorkspace'), 'Subscription Support must render the unified Pro + Member workspace');
assert(app.includes("api(API_PATHS.memberSupport.user"), 'Unified lookup must fetch standalone Member entitlement');
assert(app.includes('memberLookupError'), 'Member lookup failures must be isolated from Pro lookup failures');
assert(app.includes('renderProEntitlementSupportCard'), 'Unified support must keep a distinct Pro entitlement card');
assert(app.includes('renderMemberEntitlementSupportCard'), 'Unified support must keep a distinct Member entitlement card');
assert(app.includes("API_PATHS.memberSupport.override"), 'Member override must retain its dedicated backend authority');
assert(!app.includes("state.activeTab === 'memberSupport'"), 'Standalone Member Support active-tab rendering must be removed');
assert(!app.includes("renderMemberSupportPage()"), 'Standalone Member Support page renderer must be removed');
assert(styles.includes('.entitlement-support-grid'), 'Unified entitlement workspace must have responsive layout styles');
assert(styles.includes('@media (max-width: 980px)'), 'Unified entitlement workspace must collapse responsively');

console.log('PASS subscription + Member unified support audit');
