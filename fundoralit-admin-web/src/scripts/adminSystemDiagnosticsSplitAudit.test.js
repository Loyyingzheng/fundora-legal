const fs = require('fs');
const path = require('path');
const assert = require('assert');

const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

assert(app.includes("feedbackView: 'USER_FEEDBACK'"), 'App Feedback must default to User Feedback view.');
assert(app.includes("['USER_FEEDBACK', 'User Feedback']") && app.includes("['SYSTEM_DIAGNOSTICS', 'System Diagnostics']"), 'App Feedback must expose User Feedback and System Diagnostics tabs.');
assert(app.includes("diagnostics: '/api/feedback/admin/diagnostics'"), 'Admin web must use canonical diagnostics list endpoint.');
assert(app.includes("diagnosticQueueCounts: '/api/feedback/admin/diagnostics/queue-counts'"), 'Admin web must use canonical diagnostics counts endpoint.');
assert(app.includes('renderDiagnosticIssueItem'), 'Admin web must render canonical issues instead of feedback rows.');
assert(app.includes("stat('Affected users on page'"), 'System Diagnostics impact metric must be affected users.');
assert(!app.includes("stat('Occurrences on page'"), 'Occurrence count must not be an admin impact stat.');
assert(app.includes("['Issue Code', issueCode || 'Unknown failure · fingerprint fallback']"), 'Diagnostic card must show stable code or safe fallback.');
assert(app.includes("['Affected Users', affectedUsers]"), 'Diagnostic card must show distinct affected users.');
assert(app.includes("updateDiagnosticIssueStatus(issueId, 'INVESTIGATING')"), 'Admin must support Investigating lifecycle.');
assert(app.includes("updateDiagnosticIssueStatus(issueId, 'RESOLVED'"), 'Admin must support Resolve lifecycle.');
assert(app.includes("state.feedbackView === 'SYSTEM_DIAGNOSTICS' ? renderDiagnosticIssueItem : renderFeedbackItem"), 'Renderer must stay separated by feedback perspective.');

console.log('PASS admin System Diagnostics split audit');
