const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(indexHtml.includes("style-src 'self' 'unsafe-inline'"), 'CSP must allow the current JS-rendered inline positioning/progress styles or admin UI will spam style-src violations.');
assert(indexHtml.includes("img-src 'self' data: blob:"), 'CSP must allow safe screenshot previews.');
assert(!/frame-ancestors[^;]*;/.test(indexHtml), 'Do not ship frame-ancestors in meta CSP; browsers ignore it and print a confusing warning. Use an HTTP response header when hosting supports it.');
assert(indexHtml.includes('app.js?v=20260708-other-tab-field-error-v5'), 'app.js must be cache-busted after feedback runtime fixes.');
assert(indexHtml.includes('styles.css?v=20260708-other-tab-field-error-v5'), 'styles.css must be cache-busted after CSP/style fixes.');
assert(appJs.includes('async function refreshAfterAdminMutation'), 'Admin mutations must use a shared post-success refresh helper.');
assert(appJs.includes('await refreshAfterAdminMutation(successMessage ||'), 'PATCH/POST mutation success paths must refresh the current page.');
assert(appJs.includes('const LIMITS = ADMIN_LIMITS;'), 'Keep the LIMITS alias so legacy modal helpers cannot crash actions before API calls.');

console.log('adminFeedbackCspMutationRefreshAudit passed');
