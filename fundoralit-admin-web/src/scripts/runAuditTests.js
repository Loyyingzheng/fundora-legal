'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ACTIVE_AUDITS = require('./auditRegistry');

const root = path.resolve(__dirname, '..', '..');
const scriptsDir = path.join(root, 'src', 'scripts');
const args = process.argv.slice(2);
const extended = args.includes('--extended');
const historical = args.includes('--historical') || args.includes('--all');
const domainArg = args.find((value) => value.startsWith('--domain='));
const domain = domainArg ? domainArg.split('=')[1] : null;

const allFiles = fs.readdirSync(scriptsDir)
  .filter((name) => /\.test\.(?:js|mjs)$/.test(name))
  .sort();

let selected;
if (historical) {
  selected = allFiles.map((file) => ({ file, domain: 'historical', tier: 'historical' }));
} else {
  selected = ACTIVE_AUDITS.filter((entry) => (
    (extended || entry.tier === 'core') &&
    (!domain || entry.domain === domain)
  ));
}

if (args.includes('--list')) {
  console.log(`Active admin audits: ${ACTIVE_AUDITS.length}`);
  for (const entry of ACTIVE_AUDITS) {
    console.log(`${entry.tier.padEnd(8)} ${entry.domain.padEnd(18)} ${entry.file}`);
  }
  const active = new Set(ACTIVE_AUDITS.map((entry) => entry.file));
  console.log(`Historical/manual admin audits: ${allFiles.filter((file) => !active.has(file)).length}`);
  process.exit(0);
}

for (const [index, entry] of selected.entries()) {
  console.log(`[${index + 1}/${selected.length}] ${entry.domain} :: ${entry.file}`);
  const result = spawnSync(process.execPath, [`src/scripts/${entry.file}`], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS admin audit run complete (${selected.length}).`);
