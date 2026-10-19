// The verification loop in README.md copies a production bundle into the APK
// instead of serving it from Metro. Images need the same treatment: on Android an
// embedded bundle resolves a `require('…jpg')` by *resource name*
// (`res/drawable-<dpi>/<identifier>.<ext>`), which is what `react-native bundle
// --assets-dest` normally writes and `expo export` does not. This script does the
// missing half, with the naming rules taken from
// @react-native/assets-registry/path-support so the two agree.
//
// Usage: node scripts/copy-assets.mjs [--export <expoExportDir>]

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { getAndroidResourceFolderName, getAndroidResourceIdentifier } = require('@react-native/assets-registry/path-support');

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const exportDir = resolve(arg('export', join(homedir(), 'expoexport')));
const bundleDir = join(exportDir, '_expo', 'static', 'js', 'android');
const bundle = readdirSync(bundleDir).find((f) => f.endsWith('.js'));
if (!bundle) throw new Error(`No android bundle in ${bundleDir}. Run \`npx expo export -p android\` first.`);

// Metro emits one `registerAsset({...})` per required file. The URL hash and the
// `fileHashes` entries are the names `expo export` wrote under `assets/`, with no
// extension and one entry per scale.
const ASSET = /registerAsset\(\{([^}]*)\}\)/g;
const field = (body, key) => {
  const m = body.match(new RegExp(`${key}:\\s*(?:"([^"]*)"|\\[([^\\]]*)\\]|([^,}]+))`));
  return m ? (m[1] ?? m[2] ?? m[3]).trim() : undefined;
};
const list = (raw) => (raw ?? '').split(',').map((v) => v.trim().replace(/^"|"$/g, '')).filter(Boolean);

const source = readFileSync(join(bundleDir, bundle), 'utf8');
const copied = new Map();
for (const [, body] of source.matchAll(ASSET)) {
  const hash = field(body, 'hash');
  const type = field(body, 'type');
  const name = field(body, 'name');
  const location = field(body, 'httpServerLocation');
  if (!hash || !type || !name || !location) continue;
  const scales = list(field(body, 'scales')).map(Number);
  const fileHashes = list(field(body, 'fileHashes'));
  const asset = { httpServerLocation: location, name, type, scales };
  scales.forEach((scale, i) => {
    const from = join(exportDir, 'assets', fileHashes[i] ?? hash);
    const folder = getAndroidResourceFolderName(asset, scale);
    const to = join(appDir, 'android', 'app', 'src', 'main', 'res', folder, `${getAndroidResourceIdentifier(asset)}.${type}`);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied.set(to, from);
  });
}

for (const to of copied.keys()) console.log(to.replace(`${appDir}${process.platform === 'win32' ? '\\' : '/'}`, ''));
console.log(`${copied.size} asset files copied into android/app/src/main/res`);
