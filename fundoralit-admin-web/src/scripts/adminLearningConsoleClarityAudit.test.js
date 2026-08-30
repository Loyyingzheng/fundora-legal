const fs = require('fs');
const app = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(require('path').join(__dirname, '..', 'styles.css'), 'utf8');
function assert(condition, message) { if (!condition) throw new Error(message); }
[
  'Learning area',
  'Smart Capture',
  'OCR',
  'What this means',
  'How strong is this pattern?',
  'Correction rate',
  'Conflict rate',
  'Unique users',
  'If approved',
  'Technical details',
  'Global learning is review-first',
].forEach((term) => assert(app.includes(term), `Learning Console clarity copy missing: ${term}`));
assert(app.includes('learningConsoleFocusMatches'), 'Learning Console must support high-level Smart Capture/OCR filtering.');
assert(app.includes('renderLearningCandidateEvidence'), 'Candidate cards must explain evidence before technical fields.');
assert(app.includes('renderLearningDecisionSummary'), 'Candidate cards must explain meaning and approval impact.');
assert(css.includes('.learning-domain-grid') && css.includes('.learning-evidence-grid'), 'Learning Console clarity styles missing.');
console.log('PASS adminLearningConsoleClarityAudit');
