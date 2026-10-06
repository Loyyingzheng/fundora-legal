const fs=require('fs');
const path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
const styles=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};

assert(app.includes("frameMode: (item?.ownershipPolicy"), 'Edit mode must derive Event/Reward tab from persisted ownership policy');
assert(app.includes("text: 'Event frame'") && app.includes("text: 'Reward frame'"), 'Create/Edit modal must expose Event and Reward tabs');
assert(app.includes("modal.ownershipPolicy = isRewardFrame ? 'SYSTEM_GRANT_ONLY' : 'USER_CLAIM'"), 'Tabs must map to existing Core ownership authority');
assert(app.includes("modal.eligibilityType = isRewardFrame ? 'ALL'"), 'Reward tab must enforce permanent display eligibility');
assert(app.includes("const claimStartIso = isRewardFrame ? null"), 'Reward tab must never submit claim start');
assert(app.includes("const claimEndIso = isRewardFrame ? null"), 'Reward tab must never submit claim end');
assert(app.includes("Reward frame active"), 'Reward tab must expose active/disabled semantics rather than claim-window semantics');
assert(app.includes("Each user receives it when the Reward backend confirms their achievement; there is no global claim window."), 'Reward tab must explain per-user backend grant behavior');
assert(app.includes("Claim opens") && app.includes("Claim closes"), 'Event tab must retain scheduled claim-window controls');
assert(styles.includes('.member-frame-mode-tabs') && styles.includes('.member-frame-mode-tab.active'), 'Frame type tabs must have dedicated responsive styling');
console.log('PASS member frame create-mode admin audit');
