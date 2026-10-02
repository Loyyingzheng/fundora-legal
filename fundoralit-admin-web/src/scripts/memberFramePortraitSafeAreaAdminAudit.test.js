const fs=require('fs'); const path=require('path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
if(!app.includes('central 48% portrait safe zone')) throw new Error('Admin frame uploader must explain the same portrait safe-zone contract enforced by Core.');
if(!app.includes('validated by backend')) throw new Error('Admin must make backend asset validation explicit.');
console.log('PASS Admin member-frame portrait safe-area contract audit');
