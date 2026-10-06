const fs=require('fs');
const path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};

assert(app.includes("text: 'Event frame'") && app.includes("text: 'Reward frame'"), 'Admin must expose separate Event and Reward frame modes');
assert(app.includes("modal.ownershipPolicy = isRewardFrame ? 'SYSTEM_GRANT_ONLY' : 'USER_CLAIM'"), 'Admin modes must map to Core ownership policy authority');
assert(app.includes("modal.eligibilityType = isRewardFrame ? 'ALL'"), 'Reward frame mode must use permanent display eligibility');
assert(app.includes("claimStartAt: claimStartIso") && app.includes("claimEndAt: claimEndIso"), 'Admin payload must keep claim-window fields explicit');
assert(app.includes("const claimStartIso = isRewardFrame ? null"), 'Reward frame mode must submit null claimStartAt');
assert(app.includes("const claimEndIso = isRewardFrame ? null"), 'Reward frame mode must submit null claimEndAt');
assert(app.includes('The public Claim API cannot grant this frame.'), 'Admin must explain Reward public-claim security boundary');
assert(app.includes("['Ownership', ownershipLabel]"), 'Admin catalog must show acquisition model');
assert(app.includes("['Owners', item.ownerCount"), 'Admin catalog must expose owner count');
assert(app.includes('Ownership log') && app.includes('Ownership provenance'), 'Admin must expose claim/grant provenance visibility');
assert(app.includes("['Source', item.source"), 'Ownership log must show provenance source');
assert(app.includes('Stable code'), 'Admin must preserve stable code semantics');
console.log('PASS member frame ownership policy admin audit');
