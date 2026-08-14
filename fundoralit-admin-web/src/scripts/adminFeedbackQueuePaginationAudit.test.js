const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');
function assert(condition, message) { if (!condition) throw new Error(message); }

assert(app.includes("feedbackQueue: 'ACTION_REQUIRED'"), 'Feedback must default to the action-needed queue.');
assert(app.includes('feedbackPageSize: 15'), 'Feedback pagination must use its own page-size state without changing other admin modules.');
assert(app.includes("['ACTION_REQUIRED', 'Action needed'"), 'Action-needed queue tab missing.');
assert(app.includes("['CRITICAL', 'Critical'"), 'Critical queue tab missing.');
assert(app.includes("['CLOSED', 'Closed'"), 'Closed queue tab missing.');
assert(app.includes('queue: state.feedbackQueue'), 'Feedback queue must be sent to the backend list endpoint.');
assert(app.includes("clearScopedData('feedback');") && app.includes('loadData();'), 'Switching feedback queues must clear the previous queue before loading the next one.');
assert(app.includes("select(['10', '15', '30']"), 'Feedback page-size selector missing.');
assert(app.includes('Feedback closed. The server confirmed the committed result'), 'Close response reconciliation missing.');
assert(app.includes('API_PATHS.feedback.detail(feedbackId)'), 'Close reconciliation must verify the authoritative feedback state.');
assert(css.includes('.feedback-queue-tabs') && css.includes('.feedback-queue-tab.active'), 'Feedback queue tab styles missing.');
console.log('PASS admin feedback queue pagination audit');
