const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(app.includes("config.coreHealthPath || '/health'"), 'Core warm-up must use the Core health contract.');
assert(app.includes("config.collaborationHealthPath || '/api/health'"), 'Collaboration warm-up must use /api/health by default.');
assert(app.includes('config.warmCollaborationOnBoot === true'), 'Collaboration boot warm-up must be opt-in.');
assert(app.includes('Warm-up is deliberately best-effort'), 'Warm-up must remain non-blocking/best-effort.');
assert(!app.includes('warmAdminBackend(collaborationApiBaseUrl);'), 'Do not use the legacy hard-coded collaboration /health warm-up.');

console.log('PASS admin backend warm-up contract audit');
