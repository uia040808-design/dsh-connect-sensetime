// Minimal Electron app.asar reader: list entries / extract one file.
//
// Usage:
//   $env:ASAR_PATH = 'D:\app\raccoon-ai\resources\app.asar'
//   node tools/asar.mjs list [regex]
//   node tools/asar.mjs get <path/in/archive> [outFile]
//
// The same thing without the env var:
//   node tools/asar.mjs --asar <app.asar> list [regex]
//
// Layout (Chromium pickle):
//   u32 4 | u32 headerBufSize | u32 jsonLen (+padding) | json | file data
// File data starts at 8 + headerBufSize.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
let asar = process.env.ASAR_PATH || '';
const rest = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--asar') {
    asar = argv[i + 1] || '';
    i += 1;
  } else if (argv[i].startsWith('--asar=')) {
    asar = argv[i].slice('--asar='.length);
  } else {
    rest.push(argv[i]);
  }
}

if (!asar) {
  console.error('usage: ASAR_PATH=<app.asar> node tools/asar.mjs list [regex] | get <path> [outFile]');
  process.exit(2);
}

const buf = fs.readFileSync(asar);
if (buf.readUInt32LE(0) !== 4) {
  console.error('not an asar archive (unexpected header)');
  process.exit(2);
}
const headerBufSize = buf.readUInt32LE(4);
const jsonLen = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString('utf8'));
const dataStart = 8 + headerBufSize;

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) walk(entry, p, out);
    else out.push({ path: p, size: entry.size, offset: entry.offset, unpacked: Boolean(entry.unpacked) });
  }
  return out;
}

const entries = walk(header, '', []);
const cmd = rest[0];

if (cmd === 'list') {
  const re = rest[1] ? new RegExp(rest[1], 'i') : null;
  for (const file of entries) if (!re || re.test(file.path)) console.log(`${file.size}\t${file.path}`);
} else if (cmd === 'get') {
  const target = rest[1];
  if (!target) {
    console.error('usage: node tools/asar.mjs get <path> [outFile]');
    process.exit(2);
  }
  const hit =
    entries.find((file) => file.path === target) ||
    entries.find((file) => file.path.toLowerCase() === target.toLowerCase());
  if (!hit) {
    console.error(`not found: ${target}`);
    process.exit(2);
  }
  const data = hit.unpacked
    ? fs.readFileSync(path.join(`${asar}.unpacked`, hit.path))
    : buf.subarray(dataStart + Number(hit.offset), dataStart + Number(hit.offset) + hit.size);
  const out = rest[2];
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
    console.error(`wrote ${out} (${hit.size} bytes)`);
  } else {
    process.stdout.write(data);
  }
} else {
  console.error('usage: node tools/asar.mjs list [regex] | get <path> [outFile]');
  process.exit(2);
}
