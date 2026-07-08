const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
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
assert(!/\bLIMITS\./.test(app.replace(/ADMIN_LIMITS\./g, '')), 'Feedback modal rendering must not reference undefined LIMITS; use ADMIN_LIMITS.');
assert(app.includes('ADMIN_LIMITS.announcementCtaLabelMax'), 'Feedback notification CTA fields must use the shared ADMIN_LIMITS constant.');
assert(indexHtml.includes("img-src 'self' data: blob:"), 'CSP should allow blob: for compatibility while screenshot previews use data: URLs.');
assert(app.includes('function blobToDataUrl(blob)'), 'Screenshot autoload must use data: URLs so it is not blocked by stale CSP.');
assert(indexHtml.includes('src/app.js?v=20260708-session-responsive-v1'), 'Admin app.js must be cache-busted so deployed pages do not keep the previous runtime.');
console.log('PASS admin feedback action autoload audit');
