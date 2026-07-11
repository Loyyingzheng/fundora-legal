const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('function renderEmptyState('), 'Admin app must provide a shared renderEmptyState helper before pages call it.');
assert(app.includes("label: 'System Housekeeping'"), 'Learning-only housekeeping nav must be renamed to System Housekeeping.');
assert(app.includes("overview: '/api/admin/housekeeping/overview'"), 'System Housekeeping must load backend retention overview.');
assert(app.includes("run: '/api/admin/housekeeping/run'"), 'System Housekeeping must expose safe manual run endpoint.');
assert(app.includes('function renderSystemHousekeepingOverview()'), 'System Housekeeping page must render all retention settings and cleanup jobs.');
assert(app.includes('feedback status/notifications') || app.includes('feedback status, user notifications'), 'System Housekeeping copy must make feedback/user notification retention visible.');
assert(app.includes('RUN SYSTEM HOUSEKEEPING'), 'Manual housekeeping controls must require an explicit confirmation phrase.');
assert(app.includes('criticalActionFields(reason.trim(), confirmPhrase'), 'Manual housekeeping controls must send critical action fields.');
assert(indexHtml.includes('app.js?v=20260711-admin-mfa-recovery-method-v3'), 'Admin app runtime must be cache busted after System Housekeeping schedule fix.');
console.log('PASS admin system housekeeping audit');
