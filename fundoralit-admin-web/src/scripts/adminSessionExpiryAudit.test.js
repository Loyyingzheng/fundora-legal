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
assert(app.includes('isAdminAuthFailure(error)'), 'Token refresh failures must be treated as auth failures.');
assert(app.includes("handleAdminSessionExpired('server'"), 'Confirmed backend auth expiry responses must force a safe sign-out.');
assert(app.includes('if (isAdminAuthFailure(error)) {'), 'API failures must use the centralized auth-failure classifier before signing out.');
assert(!/return\s+status\s*={3}\s*401/.test(app), 'Do not treat every backend 401 as a session expiry; backend may return 401 for critical-action validation.');
assert(app.includes('signedInAt: Number(existing.signedInAt'), 'Token refresh must preserve the original absolute session start time.');
assert(app.includes('ADMIN_ABSOLUTE_TIMEOUT_MS = Number(config.adminAbsoluteTimeoutMs || 7 * 24 * 60 * 60 * 1000)'), 'Trusted-browser sessions must have a bounded seven-day absolute lifetime by default.');

assert(html.includes('20260711-admin-mfa-stale-recovery-v2'), 'Admin assets must be cache-busted for the persistent-session/device fix.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*input,[\s\S]*font-size:\s*16px/.test(styles), 'Mobile form fields must use 16px font size to avoid browser zoom.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.modal-card,[\s\S]*min-height:\s*100dvh/.test(styles), 'Mobile modals must use the dynamic viewport height.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.modal-actions[\s\S]*position:\s*sticky/.test(styles), 'Mobile modal actions must remain reachable.');
assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.page-context-bar[\s\S]*grid-template-columns:\s*1fr\s*!important/.test(styles), 'Mobile context bar must collapse to one column.');

console.log('adminSessionExpiryAudit passed');
