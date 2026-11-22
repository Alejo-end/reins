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
// Writes <out dir>/parts.json, <out dir>/frame.json, and src/guitar.json (tools/mustang.json; its
// body is replaced by the body outline of the export only when mustang.json has no "bodyFit").
import fs from 'node:fs';
import path from 'node:path';

const [SRC, OUT, MUSTANG, GUITAR] = process.argv.slice(2);
if (!SRC || !OUT || !MUSTANG || !GUITAR) throw new Error('usage: pickguard-v2.mjs <v2/web dir> <out dir> <mustang.json> <src/guitar.json>');
const raw = JSON.parse(fs.readFileSync(path.join(SRC, 'parts.json'), 'utf8'));
const frameText = String(raw.frame ?? '');
if (!/neck/i.test(frameText) || !/bass/i.test(frameText))
  throw new Error(`pickguard-v2.mjs: check the frame against the pickguard frame (X to the neck, Y to the bass side): "${frameText}"`);

const colour = (c) => (typeof c === 'string' ? c.toLowerCase() : '#33363a');
// the plate as its three colour plies, so the orange line shows in the bevel
const plate = (raw.parts ?? []).find((p) => p.name === 'Plate');
const plies = (raw.plate_plies ?? []).filter((q) => fs.existsSync(path.resolve(SRC, q.file)));
const list = (raw.parts ?? []).flatMap((p) =>
  p === plate && plies.length ? plies.map((q) => ({ ...p, name: q.file.replace(/\.stl$/, ''), file: q.file, color: q.color })) : [p]);
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
  // either a GLB (metres) to frame matrix, or a KiCad sheet (mm, y down) to frame matrix
  const m = b?.glb_to_frame_matrix_rowmajor ?? b?.matrix_kicad_mm_to_frame_rowmajor;
  if (!m) return undefined;
  // module lifts ("M1 (XIAO)": 1.97) by reference, for the plug-in modules on sockets
  const lift = Object.fromEntries(Object.entries(b.module_lift_mm ?? {}).map(([k, v]) => [k.split(' ')[0], v]));
  // a plug-in module named in module_lift_mm ("J4 (OLED)") comes off the board on its own: the
  // OLED module rests on the plate top, its pins through the plate into the board's socket, so it
  // is unplugged before the board goes down (checks.txt, assembly paths). assemble.mjs makes it a
  // part of its own.
  const split = Object.fromEntries(Object.keys(b.module_lift_mm ?? {}).filter((k) => /OLED/i.test(k)).map((k) => [k.split(' ')[0], 'OLED']));
  return { m, kind: b.glb_to_frame_matrix_rowmajor ? 'glb' : 'kicad', lift, split, order: b.order, explode: b.explode ?? [0, 0, 0] };
};
const diffuser = list.find((p) => /diffuser/i.test(p.name));
function stlTop(file) {
  const b = fs.readFileSync(file);
  let top = -Infinity;
  for (let i = 0, n = b.readUInt32LE(80); i < n; i++) for (let k = 0; k < 3; k++) top = Math.max(top, b.readFloatLE(84 + i * 50 + 12 + k * 12 + 8));
  return top;
}
// The board's own KiCad models of parts that the export also has as STLs, at their real size: the
// encoder (S1, README.md says to hide it) and the mute switch (SW1: the KiCad model is a taller
// switch than the B3SN and its plunger reaches 1.3 mm into the button cap). Both would show twice.
const has = (n) => parts.some((p) => p.name === n);
const hide = [...(has('Encoder_PEC12R') ? ['S1'] : []), ...(has('Button_B3SN') ? ['SW1'] : [])];
const guitarBoard = board(/reins-guitar|guitar/i);
const frame = {
  guitar: guitarBoard && { ...guitarBoard, hide },
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
const asList = (v) => (Array.isArray(v) && v.length > 8 && Array.isArray(v[0]) ? v : Array.isArray(v?.closed_polyline) ? v.closed_polyline : Array.isArray(v?.points) ? v.points : Array.isArray(v?.outline) ? v.outline : null);
let outline = null, from = '';
for (const [k, v] of Object.entries(raw)) if (/outline|body/i.test(k) && asList(v)) (outline = asList(v)), (from = `parts.json ${k}`);
if (!outline)
  for (const f of fs.readdirSync(SRC).filter((f) => /outline|body|mustang/i.test(f) && f.endsWith('.json'))) {
    const v = asList(JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8')));
    if (v) (outline = v), (from = f);
  }
// tools/mustang.json wins when its body is a full Mustang outline fitted to the photo traces
// ("bodyFit"): the export traces only the treble edge and guesses the bass side and the butt end.
// Then the export outline is only a check: how far its points are from the fitted body.
const keep = Boolean(guitar.bodyFit) && Array.isArray(guitar.body) && guitar.body.length > 8;
let check = '';
if (outline && keep) {
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const b = guitar.body;
  const d = outline.map((p) => Math.min(...b.map((a, i) => segDist(p, a, b[(i + 1) % b.length]))));
  const med = [...d].sort((x, y) => x - y)[Math.floor(d.length / 2)];
  check = `, the export outline (${from}) is a median ${med.toFixed(1)} mm from it`;
} else if (outline) {
  guitar.body = outline.map((p) => [+p[0], +p[1]]);
  guitar.source = `Body outline from the pickguard export (${from}). ${guitar.source}`;
}
fs.writeFileSync(GUITAR, JSON.stringify(guitar) + '\n');
console.log(`pickguard v2: ${parts.length} parts, body outline ${outline && !keep ? `from ${from}, ${outline.length} points` : `from tools/mustang.json${check}`}`);
for (const p of parts) console.log(`  ${String(p.order).padStart(3)} ${p.colour} ${p.name}  explode ${p.explode.join(' ')}`);
