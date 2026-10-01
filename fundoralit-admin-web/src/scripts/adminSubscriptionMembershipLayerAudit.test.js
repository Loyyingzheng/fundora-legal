const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert(app.includes('membershipActive: asBoolean') && app.includes('membershipBenefitVersion'),
  'Admin must normalize the derived membership projection.');
assert(app.includes("['Member Layer'") && app.includes("['Member Benefits'"),
  'Subscription Support must expose Member-layer state for production diagnosis.');
assert(app.includes('derived Member identity benefits'),
  'Admin copy must explain that Membership is part of Subscription Support rather than a separate billing workflow.');

console.log('PASS admin subscription membership layer audit');
