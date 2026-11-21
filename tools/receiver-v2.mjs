// Reads the web export of the second receiver case (heat/case/v2/web/) into the parts list
// that assemble.mjs reads.
//
//   node tools/receiver-v2.mjs <v2/web dir> <out dir>
//
// The folder holds one STL per part in place, and a parts.json with the frame, a colour, an
// assembly order and an explode vector per part, and the KiCad to frame transform of each
// board. Its frame is the case frame of build_case.py (X = KiCad X, Y = -KiCad Y, Z up from the
// main PCB bottom, mm), the frame assemble.mjs uses for the receiver; this script stops if
// parts.json names another one.
// Writes <out dir>/parts.json (name, file, colour, layer, order, explode) and
// <out dir>/frame.json (the board offsets, the lid top for the LED pucks).
import fs from 'node:fs';
import path from 'node:path';

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) throw new Error('usage: receiver-v2.mjs <v2/web dir> <out dir>');
const raw = JSON.parse(fs.readFileSync(path.join(SRC, 'parts.json'), 'utf8'));
if (!/X = KiCad X, Y = -KiCad Y, Z = up from the main PCB bottom/.test(raw.frame ?? ''))
  throw new Error(`receiver-v2.mjs: a frame assemble.mjs does not know: ${raw.frame}`);

const parts = raw.parts.map((p) => {
  const file = path.resolve(SRC, p.file);
  if (!fs.existsSync(file)) throw new Error(`receiver-v2.mjs: ${file} is missing`);
  return { name: p.name, file, colour: p.color.toLowerCase(), layer: `step${p.order}`, order: p.order, explode: p.explode };
});

// a board's transform, "X = x + 7.880, Y = -(y + -78.449), Z = z + -4.000 (mm)": as an offset in the frame
const board = (name) => {
  const b = raw.boards.find((x) => x.name === name);
  const m = b.glb_to_frame_matrix_rowmajor;
  return { t: [m[0][3], m[1][3], m[2][3]], order: b.order, explode: b.explode };
};
// the light bar's top face carries the LED pucks
function stlTop(file) {
  const b = fs.readFileSync(file);
  let top = -Infinity;
  for (let i = 0, n = b.readUInt32LE(80); i < n; i++) for (let k = 0; k < 3; k++) top = Math.max(top, b.readFloatLE(84 + i * 50 + 12 + k * 12 + 8));
  return top;
}
const bar = parts.find((p) => /light ?bar/i.test(p.name));
// the real boards are black, not KiCad's green (README.md)
const mask = raw.boards.find((x) => x.name === 'Board_Main')?.color_pcb ?? null;
const frame = { mask, board: board('Board_Main'), jack: board('Board_Jack'), lidTop: bar ? stlTop(bar.file) : raw.case_bbox.max[2] };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'parts.json'), JSON.stringify(parts, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify(frame, null, 1) + '\n');
console.log(`receiver v2: ${parts.length} parts, lid top ${frame.lidTop.toFixed(2)} mm, jack board at ${frame.jack.t.join(', ')}`);
for (const p of parts) console.log(`  ${String(p.order).padStart(3)} ${p.colour} ${p.name}  explode ${p.explode.join(' ')}`);
