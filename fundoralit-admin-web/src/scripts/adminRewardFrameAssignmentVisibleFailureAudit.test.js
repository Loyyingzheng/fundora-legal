const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

for (const token of [
  "class: 'member-frame-reward-assignment'",
  "text: 'Reward assignment unavailable'",
  "text: modal.rewardAssignmentError",
  "text: 'Retry assignment'",
  "onclick: () => loadRewardFrameAssignmentContext(modal.code || '')",
]) {
  if (!source.includes(token)) throw new Error(`missing visible reward-assignment failure contract: ${token}`);
}

if (source.includes("return renderPolicySafetyNote('Reward assignment unavailable', modal.rewardAssignmentError)")) {
  throw new Error('Reward assignment failure must not collapse the entire assignment UI into a generic Safety note.');
}

console.log('PASS adminRewardFrameAssignmentVisibleFailureAudit');
