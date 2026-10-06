const fs=require('fs');
const path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};

assert(app.includes("['Who can display', eligibility]") && app.includes('Who can display it'), 'Event frame mode must expose display access');
assert(app.includes("text: 'Ownership'") && app.includes("text: 'System grant only'"), 'Reward frame mode must expose backend-managed acquisition authority');
assert(app.includes("text: 'Display access'") && app.includes("Permanent for users who earn it"), 'Reward frame mode must explain permanent earned display access');
assert(app.includes("modal.eligibilityType = isRewardFrame ? 'ALL'"), 'Reward frame display eligibility must be locked to ALL in Admin payload');
console.log('PASS admin member frame display-access contract audit');
