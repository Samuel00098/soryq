import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

// Check CHANGELOG.md has an entry for this version
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`[${version}]`)) {
  console.error(`\n  ✗ CHANGELOG.md has no entry for v${version}`);
  console.error(`  Add a [${version}] section to CHANGELOG.md before releasing.\n`);
  process.exit(1);
}

// tauri.conf.json
const tauriConf = resolve(root, 'src-tauri/tauri.conf.json');
const conf = JSON.parse(readFileSync(tauriConf, 'utf8'));
conf.version = version;
writeFileSync(tauriConf, JSON.stringify(conf, null, 2) + '\n');

// Cargo.toml — replace the version line in [package]
const cargoToml = resolve(root, 'src-tauri/Cargo.toml');
const cargo = readFileSync(cargoToml, 'utf8');
const updated = cargo.replace(/^version = ".*"/m, `version = "${version}"`);
writeFileSync(cargoToml, updated);

console.log(`synced version ${version} → tauri.conf.json, Cargo.toml`);
