const fs=require('fs'); const path=require('path'); const source=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
for(const token of ["assignFrame: (achievementType)","service: 'collaboration'","renderRewardFrameAssignment","expectedCurrentFrameCatalogKey","rewardAssignmentPending","Retry reward assignment","Reward frame saved, mapped, and readiness-verified."]) if(!source.includes(token)) throw new Error('missing '+token);
if(!source.includes('Frame saved in Core, but Reward assignment is incomplete')) throw new Error('partial failure is not explicit');
console.log('PASS adminRewardFrameAssignmentClosedLoopAudit');
