// Reads the web export of the second pickguard (midiguitar/reins-guitar/pickguard/v2/web/) into
// the parts list that assemble.mjs reads, and the guitar outline the page draws.
//
//   node tools/pickguard-v2.mjs <v2/web dir> <out dir> <mustang.json> <src/guitar.json>
//
// The folder holds one STL per part in place, a parts.json with names, colours, the assembly
// order and an explode vector per part, the GLB to frame transform of the guitar board and the
// ring board, and maybe a body outline of the Mustang in the same frame. The frame must be the
// pickguard frame of build_pickguard.py (X to the neck, Y to the bass side, Z = 0 on the body
// top, mm): the page puts the hand and the guitar in it.
// Writes <out dir>/parts.json, <out dir>/frame.json, and src/guitar.json (tools/mustang.json
// with the body outline of the export when it has one).
import fs from 'node:fs';
import path from 'node:path';

const [SRC, OUT, MUSTANG, GUITAR] = process.argv.slice(2);
if (!SRC || !OUT || !MUSTANG || !GUITAR) throw new Error('usage: pickguard-v2.mjs <v2/web dir> <out dir> <mustang.json> <src/guitar.json>');
const raw = JSON.parse(fs.readFileSync(path.join(SRC, 'parts.json'), 'utf8'));
const frameText = String(raw.frame ?? '');
if (!/neck/i.test(frameText) || !/bass/i.test(frameText))
  throw new Error(`pickguard-v2.mjs: check the frame against the pickguard frame (X to the neck, Y to the bass side): "${frameText}"`);

const colour = (c) => (typeof c === 'string' ? c.toLowerCase() : '#33363a');
const list = raw.parts ?? [];
const parts = list.map((p) => {
  const file = path.resolve(SRC, p.file ?? p.stl ?? `${p.name}.stl`);
  if (!fs.existsSync(file)) throw new Error(`pickguard-v2.mjs: ${file} is missing`);
  // the page names the guitar's parts by what they are: keep the export's names, the page
  // has words for them or shows them as they are
  return { name: p.name, file, colour: colour(p.color ?? p.colour), layer: `step${p.order}`, order: p.order, explode: p.explode ?? [0, 0, 0] };
});

// a board's GLB to frame matrix (row major, metres in, mm out), found by name
const boards = raw.boards ?? [];
const board = (re) => {
  const b = boards.find((x) => re.test(`${x.name} ${x.kicad ?? ''}`));
  if (!b?.glb_to_frame_matrix_rowmajor) return undefined;
  return { m: b.glb_to_frame_matrix_rowmajor, order: b.order, explode: b.explode ?? [0, 0, 0] };
};
const diffuser = list.find((p) => /diffuser/i.test(p.name));
function stlTop(file) {
  const b = fs.readFileSync(file);
  let top = -Infinity;
  for (let i = 0, n = b.readUInt32LE(80); i < n; i++) for (let k = 0; k < 3; k++) top = Math.max(top, b.readFloatLE(84 + i * 50 + 12 + k * 12 + 8));
  return top;
}
const frame = {
  guitar: board(/reins-guitar|guitar/i),
  ring: board(/reins-ring|ring/i),
  diffuserTop: diffuser ? stlTop(path.resolve(SRC, diffuser.file)) : undefined,
  diffuserLayer: diffuser ? `step${diffuser.order}` : undefined,
};
if (!frame.guitar || !frame.ring) throw new Error('pickguard-v2.mjs: parts.json has no GLB to frame matrix for the guitar board or the ring');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'parts.json'), JSON.stringify(parts, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify(frame, null, 1) + '\n');

// the body outline: a key of parts.json, or a JSON file in the folder, a list of [x, y] in mm
const guitar = JSON.parse(fs.readFileSync(MUSTANG, 'utf8'));
const asList = (v) => (Array.isArray(v) && v.length > 8 && Array.isArray(v[0]) ? v : Array.isArray(v?.points) ? v.points : Array.isArray(v?.outline) ? v.outline : null);
let outline = null, from = '';
for (const [k, v] of Object.entries(raw)) if (/outline|body/i.test(k) && asList(v)) (outline = asList(v)), (from = `parts.json ${k}`);
if (!outline)
  for (const f of fs.readdirSync(SRC).filter((f) => /outline|body|mustang/i.test(f) && f.endsWith('.json'))) {
    const v = asList(JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8')));
    if (v) (outline = v), (from = f);
  }
if (outline) {
  guitar.body = outline.map((p) => [+p[0], +p[1]]);
  guitar.source = `Body outline from the pickguard export (${from}). ${guitar.source}`;
}
fs.writeFileSync(GUITAR, JSON.stringify(guitar) + '\n');
console.log(`pickguard v2: ${parts.length} parts, body outline ${outline ? `from ${from}, ${outline.length} points` : 'from tools/mustang.json'}`);
for (const p of parts) console.log(`  ${String(p.order).padStart(3)} ${p.colour} ${p.name}  explode ${p.explode.join(' ')}`);
