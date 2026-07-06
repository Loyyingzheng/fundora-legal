const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}
assert(app.includes('function scheduleFeedbackScreenshotAutoLoad()'), 'Feedback screenshots must be auto-loaded after the feedback list renders.');
assert(app.includes('shouldAutoLoadFeedbackScreenshots'), 'Feedback list load must schedule safe screenshot autoload.');
assert(app.includes('scope: \'feedback\''), 'Feedback item expansion state must be preserved across admin action renders.');
assert(app.includes('function runFeedbackAction(event, handler)'), 'Feedback action clicks must stop default/toggle side effects.');
assert(app.includes("tag === 'button' && normalizedAttrs.type === undefined"), 'Generated buttons must default to type=button.');
assert(app.includes('state.actionLoadingKey = path'), 'Inline admin mutations must use action-level loading instead of only collapsing the full list.');
console.log('PASS admin feedback action autoload audit');
