const fs=require('fs'); const path=require('path'); const app=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8'); const assert=(c,m)=>{if(!c)throw new Error(m)};
assert(app.includes("id: 'memberNameStyles'"),'Admin navigation missing Member Name Styles');
assert(app.includes('/api/admin/member-name-styles'),'Admin API must target Core name-style catalog');
assert(app.includes("accept: '.ttf,.otf,font/ttf,font/otf'"),'Admin must restrict upload picker to TTF/OTF');
assert(app.includes('Commercial use allowed')&&app.includes('Redistribution allowed'),'Admin must capture font licensing gates');
assert(app.includes('Core generates the lightweight picker preview'),'Admin must follow backend-generated preview flow');
assert(app.includes('previewText=${encodeURIComponent(previewText)}'),'font upload must ask Core to pre-render the lightweight title preview');
console.log('PASS Admin dynamic Member name-style catalog audit');
