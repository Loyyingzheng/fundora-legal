const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function must(re, message) { if (!re.test(app)) throw new Error(message); }
must(/function memberFrameHasPersistedAsset\(/, 'edit mode must recognize persisted frame artwork without exposing private storage path');
must(/function memberFrameModalHasArtwork\(/, 'member-frame artwork validation must use one shared create\/edit predicate');
must(/persistedAssetPresent:\s*memberFrameHasPersistedAsset\(item\)/, 'edit modal must initialize persisted asset state from canonical metadata');
must(/if \(!memberFrameModalHasArtwork\(modal\)\) return setMemberFrameModalError\('Choose a transparent PNG frame\.'\)/, 'save validation must not require re-upload for an existing frame');
must(/\.\.\.\(modal\.assetFile \? \{[\s\S]*assetPath:[\s\S]*\} : \{\}\)/, 'asset mutation fields must only be sent when a replacement PNG is selected');
if (/assetPath:\s*modal\.assetPath \|\| null,[\s\S]{0,300}reason:/.test(app)) throw new Error('edit save must not send null asset fields that can clear an existing private asset');
console.log('PASS member frame edit asset preservation audit');
