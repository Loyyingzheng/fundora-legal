const fs=require('fs');
const path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
assert(app.includes("['Who can display', eligibility]") && app.includes('Who can display it'), 'admin must label eligibility as display access');
assert(app.includes('Ownership method') && app.includes('System grant only'), 'admin must expose acquisition authority separately from display access');
assert(app.includes('Display eligibility remains a separate rule.'), 'admin guidance must explicitly separate ownership authority from display eligibility');
console.log('PASS admin member frame display-access contract audit');
