const fs=require('fs'); const path=require('path'); const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
if(!app.includes('memberAppearanceContractVersion')) throw new Error('Admin missing appearance contract version');
if(!app.includes('memberNameStyleIds')) throw new Error('Admin missing canonical name style list');
if(!app.includes("['Name styles'")) throw new Error('Admin Member support must display name styles');
console.log('PASS Admin Member appearance plan audit');
