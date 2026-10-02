const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(app.includes('const modalBusy = Boolean(state.modal?.loading);'), 'Control modal must use modal-local busy state.');
assert(!app.includes("text: (state.modal?.loading || state.loading) ? (state.modal?.loadingLabel || 'Saving...')"), 'Control modal must not couple submit state to global page loading.');
assert(app.includes("loadingLabel: ''"), 'Member override modal must initialize an idle loading label.');
assert(app.includes("state.modal.loadingLabel = 'Verifying…';"), 'Member override must expose verification phase.');
assert(app.includes("state.modal.loadingLabel = 'Applying…';"), 'Member override must expose apply phase.');
assert(app.includes("disabled: modalBusy"), 'Modal actions must be disabled only for modal-local work.');

console.log('PASS member override modal busy-state audit');
