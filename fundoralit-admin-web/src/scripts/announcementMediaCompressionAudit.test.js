const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('compressAnnouncementImageFile'), 'Announcement media must use a shared browser-side image compressor.');
assert(app.includes('ANNOUNCEMENT_IMAGE_TARGET_BYTES'), 'Announcement media must define an optimized storage target.');
assert(app.includes("canvasToBlob(canvas, 'image/webp'"), 'Announcement compressor should prefer WebP output.');
assert(app.includes('const optimizedFile = await compressAnnouncementImageFile(file);'), 'Upload boundary must optimize announcement media.');
assert(!app.includes('Announcement image must be 3MB or smaller.'), 'Legacy 3MB source rejection must be removed.');
assert(app.includes('automatically optimized before upload'), 'Admin UI should explain automatic optimization instead of a low upload cap.');

console.log('PASS announcement media compression audit');
