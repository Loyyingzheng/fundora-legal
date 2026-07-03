const fs = require('fs');
const path = require('path');
const assert = require('assert');
const app = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
['Learning Console','Recommended action','Impact level','Risk level','Privacy status','Regression status','Confidence level'].forEach((term) => assert(app.includes(term), `${term} must render in Learning Console recommendation dashboard`));
['approve_review_only','keep_pending','reject','Not available'].forEach((term) => assert(app.includes(term), `${term} recommendation state must be represented without fake numbers`));
assert(app.includes('auto-save disabled') && app.includes('quick-save disabled'), 'Rules tab must clearly preserve no auto/quick save');
assert(app.includes('Not run yet') && app.includes('fakeNumbers: false'), 'Evaluation must show not-run placeholder without fake numbers');
console.log('PASS adminLearningRecommendationAudit');
