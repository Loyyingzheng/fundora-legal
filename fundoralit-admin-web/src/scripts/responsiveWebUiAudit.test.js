const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const stylesPath = path.join(root, 'src', 'styles.css');
const htmlPath = path.join(root, 'index.html');
const styles = fs.readFileSync(stylesPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(/<meta\s+name=["']viewport["'][^>]+width=device-width/i.test(html), 'index.html must keep the mobile viewport meta tag.');
assert(/--admin-safe-gutter/.test(styles), 'Responsive safe gutter token is required.');
assert(/env\(safe-area-inset-left\)/.test(styles), 'Safe-area inset support is required for mobile/foldable devices.');
assert(/overflow-x:\s*hidden/.test(styles), 'Global horizontal overflow guard is required.');
assert(/table-wrap[\s\S]*overflow-x:\s*auto/.test(styles), 'Table wrappers must scroll horizontally instead of overflowing the page.');
assert(/-webkit-overflow-scrolling:\s*touch/.test(styles), 'Table wrappers must support smooth touch scrolling.');
assert(/toolbar,[\s\S]*analytics-toolbar,[\s\S]*control-toolbar[\s\S]*grid-template-columns:\s*repeat\(auto-fit/.test(styles), 'Toolbars must use auto-fit responsive columns.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*grid-template-columns:\s*1fr\s*!important/.test(styles), 'Small-screen grid collapse guard is required.');
assert(/modal-card,[\s\S]*modal-card-wide[\s\S]*max-height:\s*100dvh/.test(styles), 'Mobile modals must fit dynamic viewport height.');
assert(/\.actions\s+\.btn,[\s\S]*width:\s*100%/.test(styles), 'Mobile action buttons must be able to stack full width.');
assert(/white-space:\s*normal/.test(styles), 'Buttons/badges must allow wrapping for long text.');
assert(/\.info-popover[\s\S]*max-width:\s*min\(340px,\s*calc\(100vw/.test(styles), 'Info popovers must be viewport bounded.');

assert(/function\s+createAdminLoginForm/.test(fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8')), 'Login form must be reusable outside the header.');
assert(/signed-out-login-panel/.test(styles), 'Mobile signed-out card must expose a login panel, not only a header login form.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.app-header \.auth-box:has\(\.login-grid\)[\s\S]*display:\s*none/.test(styles), 'Phone layout must hide cramped header login and show the main-card login.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.signed-out-login-panel[\s\S]*display:\s*block/.test(styles), 'Phone layout must show signed-out login panel.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*#mainContent[\s\S]*padding:/.test(styles), 'Main content needs mobile safe padding.');

console.log('responsiveWebUiAudit passed');
