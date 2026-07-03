const fs = require('fs'); const path = require('path'); const assert = require('assert');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
['Learning Console centralizes all five Template Family domains','Global rules are review-only by default','No auto-save / quick-save','Category pattern global rules are high risk','No raw notification/OCR/transaction text','recommendedAction','impactLevel','riskLevel','privacyStatus','regressionStatus','confidenceLevel'].forEach((n)=>assert(app.includes(n), `Learning Console cross-domain contract missing ${n}`));
console.log('PASS adminLearningConsoleCrossDomainAudit');
