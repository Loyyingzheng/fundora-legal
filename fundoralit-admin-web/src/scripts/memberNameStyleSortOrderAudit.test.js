const fs=require('fs');
const path=require('path');
const app=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
assert(app.includes('function sortMemberNameStyleItems(items)'), 'Member name style list must have centralized sorting');
assert(app.includes('memberNameStyleSortOrder(a) - memberNameStyleSortOrder(b)'), 'Member name style list must sort by configured sortOrder ascending');
assert(app.includes('sortMemberNameStyleItems(normalizeAdminListResponse(response))'), 'Loaded Member name styles must use configured sort order');
assert(app.includes('The catalog list follows Sort order from lowest to highest.'), 'Admin must explain actual list ordering');
console.log('PASS Member name style configured sort-order audit');
