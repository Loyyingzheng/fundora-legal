const fs=require('fs');
const path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
assert(app.includes("['Who can display', eligibility]") && app.includes("Who can display it"), 'admin must label eligibility as display access');
assert(app.includes('Claim ownership is available to all users'), 'admin guidance must distinguish claim from display access');
console.log('PASS admin member frame display-access contract audit');
