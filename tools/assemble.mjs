// Builds the web model of REINS: the guitar unit (the pickguard with the guitar board, the ToF
// pod, the LED ring board and the knob) and the receiver (the main board, the jack board and the
// printed case), in one GLB.
//
//   node assemble.mjs <work dir> <out.glb> <parts.json>
//
// <work dir> holds what the private build script made:
//   kicad/guitar.glb, ring.glb, reins.glb, reins-jack.glb   kicad-cli pcb export glb, origin at KiCad (0, 0)
//   cad/frames.json                 where the boards go (export_cad.py)
//   cad/guitar/*.stl, parts.json    the pickguard parts, in the pickguard frame
//   cad/receiver/*.stl, parts.json  the case parts, in the case frame
//
// Frames. Each unit has its own frame in mm with Z up: the guitar unit is the pickguard frame
// (X to the neck, Y to the bass side, Z = 0 on the body top), the receiver is the case frame
// (X = KiCad X, Y = -KiCad Y, Z = 0 at the bottom of the main board). A unit point (X, Y, Z)
// is the GLB point (X, Z, -Y) / 1000, the same map H2H uses for its STEP parts. kicad-cli writes
// metres with y up and z = KiCad y, so a board point is (kx, -ky, h) in a unit frame before its
// placement.
//
// What it does:
//  1. Each board becomes one node: its parts lose their names, the placement is baked into the
//     vertices, and each material's triangles are welded and simplified. Normals go: the page
//     computes creased normals, which also keeps the simplifier free of normal seams.
//  2. The printed parts come in as named nodes, welded, without normals.
//  3. LED pucks: one thin emissive disc or square per pixel on the diffusers, which the page lights.
//  4. Each node's origin goes to the centre of its box. Node names start with G_ (guitar) or R_.
//  5. Quantize, meshopt.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, weldPrimitive, simplifyPrimitive, quantize, reorder, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const [WORK, OUT, PARTS] = process.argv.slice(2);
if (!WORK || !OUT || !PARTS) throw new Error('usage: assemble.mjs <work dir> <out.glb> <parts.json>');
const RECEIVER_DIR = process.env.RECEIVER_DIR || path.join(WORK, 'cad/receiver');
const GUITAR_DIR = process.env.GUITAR_DIR || path.join(WORK, 'cad/guitar');

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('scene');
const frames = JSON.parse(fs.readFileSync(path.join(WORK, 'cad/frames.json'), 'utf8'));
const parts = []; // name, unit, layer, colour

const rad = (d) => (d * Math.PI) / 180;
// rotate about Z by a degrees, then translate: a placement in a unit frame
const place = (a, t) => {
  const c = Math.cos(rad(a)), s = Math.sin(rad(a));
  return (p) => [c * p[0] - s * p[1] + t[0], s * p[0] + c * p[1] + t[1], p[2] + t[2]];
};
const toGlb = (p) => [p[0] / 1000, p[2] / 1000, -p[1] / 1000];

function accessor(type, arr) {
  return doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
}
function nodeWith(name, prims) {
  const mesh = doc.createMesh(name);
  for (const p of prims) mesh.addPrimitive(p);
  const node = doc.createNode(name).setMesh(mesh);
  scene.addChild(node);
  return node;
}
const matCache = new Map();
function material(rgba, metal = 0, rough = 0.6) {
  const key = rgba.map((x) => x.toFixed(3)).join(',') + `/${metal}/${rough}`;
  if (!matCache.has(key)) {
    const m = doc.createMaterial('').setBaseColorFactor(rgba).setMetallicFactor(metal).setRoughnessFactor(rough);
    if (rgba[3] < 1) m.setAlphaMode('BLEND');
    matCache.set(key, m);
  }
  return matCache.get(key);
}
const hex = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2)).concat(1);

// a welded, indexed primitive from triangle soup positions (GLB metres)
function prim(positions, mat, simplifyError = 0) {
  const P = new Float32Array(positions);
  const p = doc.createPrimitive().setAttribute('POSITION', accessor('VEC3', P)).setMaterial(mat);
  const I = new Uint32Array(P.length / 3);
  for (let i = 0; i < I.length; i++) I[i] = i;
  p.setIndices(accessor('SCALAR', I));
  weldPrimitive(p, { tolerance: 0.0001 });
  if (simplifyError > 0) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: 0, error: simplifyError, lockBorder: false });
  return p;
}

// ---- 1. the boards ------------------------------------------------------------------------
// every triangle of a kicad-cli GLB, in a unit frame (mm), grouped by material colour
// lift: mm to raise the parts under a named top level node. The KiCad models of the plug-in
// modules on the receiver sit low: their sockets are 6.6 mm in the models, 8.5 mm on the board
// (heat/case/v2/web/parts.json, module_heights).
async function boardTriangles(file, map, lift = {}) {
  const src = await io.read(file);
  const groups = new Map();
  for (const n of src.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const m = n.getWorldMatrix();
    let up = 0;
    for (let a = n; a; a = a.getParentNode()) if (lift[a.getName()] != null) up = lift[a.getName()];
    for (const p of mesh.listPrimitives()) {
      const mat = p.getMaterial();
      const rgba = mat ? mat.getBaseColorFactor() : [0.5, 0.5, 0.5, 1];
      const metal = mat ? mat.getMetallicFactor() : 0, rough = mat ? mat.getRoughnessFactor() : 0.6;
      const key = rgba.map((x) => x.toFixed(2)).join(',') + `/${metal.toFixed(1)}/${rough.toFixed(1)}`;
      if (!groups.has(key)) groups.set(key, { rgba, metal, rough, pos: [] });
      const out = groups.get(key).pos;
      const pos = p.getAttribute('POSITION'), idx = p.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const v = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        pos.getElement(idx ? idx.getScalar(i) : i, v);
        const w = [0, 1, 2].map((k) => (m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]) * 1000);
        out.push(...toGlb(map([w[0], -w[2], w[1] + up])));
      }
    }
  }
  return groups;
}
// mask: a colour for the solder mask, which kicad-cli writes in KiCad's default green
async function board(name, file, map, unit, layer, error, lift, extra = {}, mask = null) {
  const groups = await boardTriangles(path.join(WORK, 'kicad', file), map, lift);
  const prims = [];
  let before = 0;
  for (const g of groups.values()) {
    const [r, gr, b] = g.rgba;
    if (mask && gr > r * 1.5 && gr > b && gr < 0.4) g.rgba = mask;
    before += g.pos.length / 9;
    // the silkscreen is small type: it keeps its shape (white, flat, thin)
    const silk = g.rgba[0] > 0.9 && g.rgba[1] > 0.9 && g.rgba[2] > 0.9;
    prims.push(prim(g.pos, material(g.rgba, g.metal, g.rough), silk ? error * 0.15 : error));
  }
  const node = nodeWith(name, prims);
  parts.push({ name, unit, layer, colour: null, ...extra });
  console.log(`${name}: ${before} triangles in, ${groups.size} materials`);
  return node;
}

const gf = frames.guitar, rf = frames.receiver;
// a second case may move the boards in its frame (receiver-v2.mjs, frame.json)
const over = fs.existsSync(path.join(RECEIVER_DIR, 'frame.json')) ? JSON.parse(fs.readFileSync(path.join(RECEIVER_DIR, 'frame.json'), 'utf8')) : {};
const rb = over.board?.t ?? [0, 0, 0];
if (over.jack) rf.jack.t = over.jack.t;
if (over.lidTop != null) rf.lidTop = over.lidTop;
const steps = (b) => (b ? { order: b.order, explode: b.explode } : {});
// The guitar boards: placed by build_pickguard.py's parameters, or, for a second pickguard
// (pickguard-v2.mjs, frame.json), by its GLB to frame matrices. A board point p is (kx, -ky, h) mm.
const gOver = fs.existsSync(path.join(GUITAR_DIR, 'frame.json')) ? JSON.parse(fs.readFileSync(path.join(GUITAR_DIR, 'frame.json'), 'utf8')) : {};
const byMatrix = (o) => (p) => {
  const M = o.m;
  // back to GLB metres, or to the KiCad sheet (mm, y down; the GLBs are exported at origin 0, 0)
  const g = o.kind === 'kicad' ? [p[0], -p[1], p[2]] : [p[0] / 1000, p[2] / 1000, -p[1] / 1000];
  return [0, 1, 2].map((r) => M[r][0] * g[0] + M[r][1] * g[1] + M[r][2] * g[2] + M[r][3]);
};
const podPlace = place(gf.pod.rot, [gf.pod.c[0], gf.pod.c[1], 0]);
const ringV1 = (p) => podPlace(place(gf.pod.ringTurn, [0, 0, gf.pod.zRing])([p[0] - gf.pod.ringCentre[0], p[1] + gf.pod.ringCentre[1], p[2]]));
const guitarMap = gOver.guitar ? byMatrix(gOver.guitar) : place(gf.board.theta, gf.board.t);
const ringMap = gOver.ring ? byMatrix(gOver.ring) : ringV1;
await board('G_Board', 'guitar.glb', guitarMap, 'guitar', 'board', 0.0016, gOver.guitar?.lift ?? {}, steps(gOver.guitar));
await board('G_Ring', 'ring.glb', ringMap, 'guitar', 'ring', 0.002, {}, steps(gOver.ring));
await board('R_Board', 'reins.glb', (p) => [p[0] + rb[0], p[1] + rb[1], p[2] + rb[2]], 'receiver', 'board', 0.0016,
  { J2: 1.905, J4: 1.905, M1: 1.955 }, steps(over.board), over.mask ? hex(over.mask) : null);
await board('R_Jack', 'reins-jack.glb', (p) => [p[0] + rf.jack.t[0], p[1] + rf.jack.t[1], p[2] + rf.jack.t[2]], 'receiver', 'jack', 0.002, {}, steps(over.jack), over.mask ? hex(over.mask) : null);

// ---- 2. the printed parts -------------------------------------------------------------------
function readStl(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(80);
  if (84 + n * 50 !== b.length) throw new Error(`${file}: not a binary STL`);
  const pos = new Array(n * 9);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      const o = 84 + i * 50 + 12 + k * 12;
      const g = toGlb([b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)]);
      pos[i * 9 + k * 3] = g[0];
      pos[i * 9 + k * 3 + 1] = g[1];
      pos[i * 9 + k * 3 + 2] = g[2];
    }
  return pos;
}
function printed(dir, prefix, unit) {
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'parts.json'), 'utf8'));
  for (const p of list) {
    const name = `${prefix}${p.name}`;
    const file = path.resolve(dir, p.file ?? `${p.name}.stl`);
    nodeWith(name, [prim(readStl(file), material(hex(p.colour), 0, 0.7))]);
    parts.push({ name, unit, layer: p.layer, colour: p.colour, ...(p.order != null ? { order: p.order, explode: p.explode } : {}) });
  }
}
printed(GUITAR_DIR, 'G_', 'guitar');
printed(RECEIVER_DIR, 'R_', 'receiver');

// ---- 3. LED pucks ----------------------------------------------------------------------------
// The page colours them from the firmware model. A little height: a flat part has an empty box,
// which quantizing cannot scale.
const ledMat = doc.createMaterial('LED').setBaseColorFactor([0, 0, 0, 1]).setEmissiveFactor([1, 1, 1]);
function puck(name, centre, shape, size, z, unit, layer) {
  const pos = [], seg = shape === 'disc' ? 32 : 4, z1 = z, z0 = z - 0.3;
  const ring = [];
  for (let i = 0; i < seg; i++) {
    const a = shape === 'disc' ? (i / seg) * Math.PI * 2 : Math.PI / 4 + (i / seg) * Math.PI * 2;
    const r = shape === 'disc' ? size / 2 : (size / 2) * Math.SQRT2;
    ring.push([centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r]);
  }
  for (let i = 0; i < seg; i++) {
    const a = ring[i], b = ring[(i + 1) % seg];
    pos.push(...toGlb([centre[0], centre[1], z1]), ...toGlb([a[0], a[1], z1]), ...toGlb([b[0], b[1], z1]));
    pos.push(...toGlb([a[0], a[1], z1]), ...toGlb([a[0], a[1], z0]), ...toGlb([b[0], b[1], z0]));
    pos.push(...toGlb([a[0], a[1], z1]), ...toGlb([b[0], b[1], z0]), ...toGlb([b[0], b[1], z1]));
  }
  nodeWith(name, [prim(pos, ledMat)]);
  parts.push({ name, unit, layer, colour: null });
}
// the guitar ring: LED i at 11.25 + 22.5 i degrees from the pad row, radius 18.9 (make_ring.py),
// counter clockwise seen from the top; on the diffuser's top face
const ringTop = gOver.diffuserTop ?? gf.plateT;
for (let i = 0; i < 16; i++) {
  const a = rad(11.25 + 22.5 * i);
  // the LED on the ring board, in KiCad mm (y down), placed like the board
  const c = ringMap([100 + 18.9 * Math.cos(a), -(100 - 18.9 * Math.sin(a)), 0]);
  puck(`G_LED_${i}`, c, 'disc', 4.2, ringTop + 0.05, 'guitar', gOver.diffuserLayer ?? 'diffuser');
}
// where the sensor looks from, for the page (the ghost hand, the field): the ring's centre
const pod = ringMap([100, -100, 0]);
fs.writeFileSync(path.join(path.dirname(PARTS), 'pod.json'), JSON.stringify({ x: +pod[0].toFixed(2), y: +pod[1].toFixed(2) }) + '\n');
// the receiver stick: 8 pixels from neo_y0 at neo_pitch (build_case.py), under 5 mm windows
for (let i = 0; i < 8; i++) {
  puck(`R_LED_${i}`, [rf.neo.x, -(rf.neo.y0 + i * rf.neo.pitch)], 'square', 4.4, rf.lidTop + 0.05, 'receiver', 'top');
}

// ---- 4. centre each node ------------------------------------------------------------------------
await doc.transform(dedup(), prune());
const info = new Map(parts.map((p) => [p.name, p]));
for (const node of scene.listChildren()) {
  const mesh = node.getMesh();
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], tris = 0;
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'), v = [0, 0, 0];
    tris += p.getIndices().getCount() / 3;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    }
  }
  const c = lo.map((l, k) => (l + hi[k]) / 2);
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'), v = [0, 0, 0];
    const arr = new Float32Array(pos.getCount() * 3);
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      arr.set([v[0] - c[0], v[1] - c[1], v[2] - c[2]], i * 3);
    }
    p.setAttribute('POSITION', accessor('VEC3', arr));
  }
  node.setTranslation(c);
  Object.assign(info.get(node.getName()), { tris: Math.round(tris), min: lo.map((x) => +(x * 1000).toFixed(2)), max: hi.map((x) => +(x * 1000).toFixed(2)) });
}

// ---- 5. compress --------------------------------------------------------------------------------
await doc.transform(prune(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
fs.writeFileSync(PARTS, JSON.stringify(parts, null, 1) + '\n');
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`${OUT}: ${kb} KB, ${parts.length} parts, ${parts.reduce((a, p) => a + p.tris, 0)} triangles`);
for (const p of parts) if (!/_LED_|Screw_|Insert_/.test(p.name)) console.log(`  ${p.name.padEnd(20)} ${String(p.tris).padStart(6)}  [${p.min.join(', ')}] .. [${p.max.join(', ')}]`);
