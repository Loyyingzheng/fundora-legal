const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(app.includes('extractFeedbackTechnicalDiagnostics'), 'Admin feedback must parse attached technical diagnostics.');
assert(app.includes("text: 'Technical diagnostics'"), 'Admin feedback detail must expose a developer-only technical diagnostics section.');
assert(app.includes('technicalSummary') && app.includes('componentStack') && app.includes('breadcrumbs'), 'Admin diagnostics must include the technical summary, component stack, and breadcrumbs.');
assert(app.includes('renderFeedbackTechnicalDiagnostics(item)'), 'Feedback records must render the developer diagnostics section.');
assert(app.includes("text: 'Raw debug JSON'"), 'Raw debug JSON must remain available for deep developer inspection.');

console.log('adminFeedbackTechnicalDiagnosticsAudit passed');
