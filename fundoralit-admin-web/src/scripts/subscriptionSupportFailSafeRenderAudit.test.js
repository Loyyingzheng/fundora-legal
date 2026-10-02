const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(app.includes('const nextRoot = document.createDocumentFragment()'), 'Admin render must build the next DOM before clearing the live UI.');
assert(app.indexOf('const nextRoot = document.createDocumentFragment()') < app.indexOf('clear(mainContent);', app.indexOf('function render()')), 'Atomic render must build before clear(mainContent).');
assert(app.includes("showAdminRenderFailureOverlay(error)"), 'Render failures must preserve last-known-good UI and surface an error.');
assert(app.includes('renderSubscriptionUserRenderFailure(summary, error)'), 'Subscription user rows must have item-level render isolation.');
assert(app.includes('Your previous Admin view is still preserved.'), 'Render fallback must explain last-known-good preservation.');
assert(styles.includes('.admin-render-failure-banner'), 'Render failure banner styling is missing.');
console.log('PASS Subscription Support fail-safe atomic render audit');
