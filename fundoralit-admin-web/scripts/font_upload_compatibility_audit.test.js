const fs=require('fs'); const s=fs.readFileSync(__dirname+'/src/app.js','utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
assert(s.includes('validateMemberNameStyleFontFile'),'Admin must preflight font bytes before upload');
assert(s.includes('TTC/WOFF/WOFF2 files are not supported'),'Admin must explain unsupported container formats');
assert(s.includes('&supportedScripts=${encodeURIComponent'),'Admin must bind glyph declarations to the uploaded bytes');
assert(s.includes('assetVersion: null'),'Admin must not allocate Member name-style asset versions');
assert(!s.includes('modal.assetVersion = Math.max(1, Number(modal.assetVersion || 1) + (modal.id ? 1 : 0))'),'legacy client-side version increment must be removed');
console.log('PASS Admin Member name-style font upload compatibility audit');
