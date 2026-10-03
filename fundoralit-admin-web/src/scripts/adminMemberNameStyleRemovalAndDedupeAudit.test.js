const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const checks = [
  ["delete route", "delete: (id) => `/api/admin/member-name-styles/${encodeURIComponent(id)}`"],
  ["style delete action", "async function deleteMemberNameStyle(item)"],
  ["clear local file", "Clear selected file"],
  ["remove saved font", "Remove saved font"],
  ["undo remove", "Undo remove"],
  ["removed script payload", "removedScripts: Array.from(new Set(snapshot.removedScripts || []))"],
];
for (const [name, token] of checks) {
  if (!src.includes(token)) throw new Error(`Missing ${name}`);
}
console.log('PASS admin Member name-style removal + dedupe UX audit');
