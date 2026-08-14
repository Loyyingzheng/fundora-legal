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
assert(app.includes('async function loadFeedbackDetail'), 'Feedback details must load lazily after a record is expanded.');
assert(app.includes("detail: (id) => `/api/feedback/admin/${encodeURIComponent(id)}`"), 'Feedback detail endpoint path is missing.');
assert(!app.includes('shouldAutoLoadFeedbackScreenshots'), 'Initial feedback loading must not auto-fetch screenshot binaries.');
assert(app.includes("onToggle: (expanded) =>"), 'Feedback expansion must trigger progressive detail loading.');
assert(app.includes("scope: 'feedback'"), 'Feedback item expansion state must be preserved across admin action renders.');
assert(app.includes('function runFeedbackAction(event, handler)'), 'Feedback action clicks must stop default/toggle side effects.');
assert(app.includes("tag === 'button' && normalizedAttrs.type === undefined"), 'Generated buttons must default to type=button.');
assert(app.includes('state.actionLoadingKey = path'), 'Inline admin mutations must use action-level loading instead of only collapsing the full list.');
assert(!/\bLIMITS\./.test(app.replace(/ADMIN_LIMITS\./g, '')), 'Feedback modal rendering must not reference undefined LIMITS; use ADMIN_LIMITS.');
assert(app.includes('ADMIN_LIMITS.announcementCtaLabelMax'), 'Feedback notification CTA fields must use the shared ADMIN_LIMITS constant.');
assert(indexHtml.includes("img-src 'self' data: blob:"), 'CSP should allow safe screenshot previews.');
assert(app.includes('function blobToDataUrl(blob)'), 'On-demand screenshot previews must remain CSP-safe.');
assert(indexHtml.includes('feedback-queue-v2'), 'Admin assets must be cache-busted after feedback queue changes.');
console.log('PASS admin feedback lazy detail audit');
