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
assert(app.includes("screenshot: (id) => `/api/feedback/admin/${encodeURIComponent(id)}/screenshot`"), 'Admin web must use backend screenshot proxy path.');
assert(app.includes('function renderFeedbackScreenshot(item)'), 'Admin web must render feedback screenshots through a controlled helper.');
assert(app.includes('apiRaw(API_PATHS.feedback.screenshot(id)'), 'Admin web must fetch screenshots with Firebase Authorization.');
assert(!app.includes("src: item.screenshotUrl"), 'Admin web must not load direct Supabase public screenshot URLs in <img>.');
assert(indexHtml.includes("img-src 'self' data: blob:"), 'CSP must allow local blob previews returned from the backend screenshot proxy.');
console.log('PASS admin feedback screenshot proxy audit');
