const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('ADMIN_SESSION_MONITOR_INTERVAL_MS'), 'Admin session monitor interval must be defined.');
assert(app.includes('startAdminSessionMonitor()'), 'Admin session monitor must start after successful login/session apply.');
assert(app.includes('stopAdminSessionMonitor()'), 'Admin session monitor must stop on logout/session clear.');
assert(app.includes('handleAdminSessionExpired'), 'Session expiry must use a centralized handler.');
assert(app.includes('isAdminPageVisible'), 'Expiry handler must distinguish visible vs hidden/inactive tabs.');
assert(app.includes('buildAdminSessionExpiredNotice'), 'Visible session expiry must show a user-facing prompt/notice.');
assert(app.includes('recordAdminActivity'), 'User interaction must refresh the idle activity clock.');
assert(app.includes("'pointerdown', 'input', 'change'"), 'Pointer and form activity must count as admin activity.');
assert(app.includes("document.addEventListener('visibilitychange'"), 'Visibility changes must trigger proactive session checks.');
assert(app.includes("window.addEventListener('focus'"), 'Window focus must trigger proactive session checks.');
assert(/state\.modal\s*=\s*null/.test(app), 'Logout/session expiry must close any open modal.');
assert(/state\.navOpen\s*=\s*false/.test(app), 'Logout/session expiry must close the mobile/admin drawer.');
assert(app.includes('isAdminAuthFailure(error)'), '401/token refresh failures must be treated as auth failures.');
assert(app.includes("handleAdminSessionExpired('server'"), 'Backend 401 responses must force a safe sign-out.');
assert(app.includes('signedInAt: Number(existing.signedInAt'), 'Token refresh must preserve the original absolute session start time.');

assert(html.includes('20260708-session-responsive-v1'), 'Admin assets must be cache-busted for the session/responsive fix.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*input,[\s\S]*font-size:\s*16px/.test(styles), 'Mobile form fields must use 16px font size to avoid browser zoom.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.modal-card,[\s\S]*min-height:\s*100dvh/.test(styles), 'Mobile modals must use the dynamic viewport height.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.modal-actions[\s\S]*position:\s*sticky/.test(styles), 'Mobile modal actions must remain reachable.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.page-context-bar[\s\S]*grid-template-columns:\s*1fr\s*!important/.test(styles), 'Mobile context bar must collapse to one column.');

console.log('adminSessionExpiryAudit passed');
