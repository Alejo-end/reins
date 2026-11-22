// The parts of public/model/reins.glb as solids, for tools/explode.mjs.
//
// A part becomes columns: vertical rays on one grid of the unit (0.2 mm apart, in the page's axes,
// y up, mm). Along each ray the part is a list of intervals [y0, y1], found from the signed
// crossings of its triangles (winding number, so overlapping closed shells of a board come out
// as one solid). Two parts then overlap by a volume that is a piecewise linear function of how
// far one is lifted against the other: overlap(d). From it come both the assembly relation of a
// pair (which one comes off upwards) and the collision test of any vertical motion.
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const H = 0.2; // mm between rays
// the grid sits off any round number, so that rays miss the edges of the CAD triangles
const OX = 0.0731, OZ = 0.0417;

// the meshes of the GLB in the page's frame: each node's world matrix, metres to mm
export async function loadParts(site, glb) {
  const req = createRequire(path.join(site, 'tools/work/npm/package.json'));
  const imp = (m) => import(pathToFileURL(req.resolve(m)).href);
  const { NodeIO } = await imp('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
  const { MeshoptDecoder } = await imp('meshoptimizer');
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(glb);
  const out = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const tri = [];
    const v = [0, 0, 0];
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), idx = p.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i < n; i++) {
        pos.getElement(idx ? idx.getScalar(i) : i, v);
        for (let k = 0; k < 3; k++) tri.push((m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]) * 1000);
      }
    }
    out.set(node.getName(), Float64Array.from(tri));
  }
  return out;
}

// columns of one part: box in cells, and per column a sorted Float64Array of [y0, y1, y0, y1, ...]
export function solid(name, tri) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < tri.length; i += 3) {
    x0 = Math.min(x0, tri[i]); x1 = Math.max(x1, tri[i]);
    y0 = Math.min(y0, tri[i + 1]); y1 = Math.max(y1, tri[i + 1]);
    z0 = Math.min(z0, tri[i + 2]); z1 = Math.max(z1, tri[i + 2]);
  }
  const i0 = Math.ceil((x0 - OX) / H), i1 = Math.floor((x1 - OX) / H);
  const k0 = Math.ceil((z0 - OZ) / H), k1 = Math.floor((z1 - OZ) / H);
  const ni = Math.max(0, i1 - i0 + 1), nk = Math.max(0, k1 - k0 + 1);
  const hits = new Array(ni * nk);
  let flips = 0;
  for (let t = 0; t < tri.length; t += 9) {
    const ax = tri[t], ay = tri[t + 1], az = tri[t + 2];
    const bx = tri[t + 3], by = tri[t + 4], bz = tri[t + 5];
    const cx = tri[t + 6], cy = tri[t + 7], cz = tri[t + 8];
    // the normal's y: positive faces up
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (Math.abs(ny) < 1e-12) continue; // a vertical triangle crosses no vertical ray
    const ia = Math.max(i0, Math.ceil((Math.min(ax, bx, cx) - OX) / H)), ib = Math.min(i1, Math.floor((Math.max(ax, bx, cx) - OX) / H));
    const ka = Math.max(k0, Math.ceil((Math.min(az, bz, cz) - OZ) / H)), kb = Math.min(k1, Math.floor((Math.max(az, bz, cz) - OZ) / H));
    for (let i = ia; i <= ib; i++) {
      const x = i * H + OX;
      for (let k = ka; k <= kb; k++) {
        const z = k * H + OZ;
        // barycentric weights in the xz plane
        const w0 = ((bz - z) * (cx - x) - (bx - x) * (cz - z)) / ny;
        const w1 = ((cz - z) * (ax - x) - (cx - x) * (az - z)) / ny;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const y = w0 * ay + w1 * by + w2 * cy;
        const c = (i - i0) * nk + (k - k0);
        (hits[c] ??= []).push(y, ny > 0 ? -1 : 1); // a face looking down is the way in
      }
    }
  }
  const cols = new Array(ni * nk);
  let open = 0, used = 0;
  for (let c = 0; c < hits.length; c++) {
    const h = hits[c];
    if (!h) continue;
    const order = [];
    for (let j = 0; j < h.length; j += 2) order.push(j);
    order.sort((a, b) => h[a] - h[b]);
    const iv = [];
    let w = 0;
    for (const j of order) {
      const before = w;
      w += h[j + 1];
      if (before <= 0 && w > 0) iv.push(h[j]);
      else if (before > 0 && w <= 0) iv.push(h[j]);
    }
    if (w !== 0) {
      open++;
      if (w < 0) flips++;
      if (iv.length % 2) iv.pop();
    }
    if (iv.length) (cols[c] = Float64Array.from(iv)), used++;
  }
  return { name, i0, k0, ni, nk, cols, used, open, flips, y0, y1, x0, x1, z0, z1 };
}

export function volume(s) {
  let v = 0;
  for (const c of s.cols) if (c) for (let j = 0; j < c.length; j += 2) v += c[j + 1] - c[j];
  return v * H * H;
}

// overlap(d): the volume both parts fill when A is lifted by d against B (and moved by di, dk
// cells across). Returns the breakpoints of the piecewise linear function: d[], v[].
export function overlapFn(A, B, di = 0, dk = 0) {
  // A's column (i, k) meets B's column (i - di, k - dk)
  const ia = Math.max(A.i0, B.i0 + di), ib = Math.min(A.i0 + A.ni, B.i0 + B.ni + di);
  const ka = Math.max(A.k0, B.k0 + dk), kb = Math.min(A.k0 + A.nk, B.k0 + B.nk + dk);
  const ev = [];
  for (let i = ia; i < ib; i++)
    for (let k = ka; k < kb; k++) {
      const a = A.cols[(i - A.i0) * A.nk + (k - A.k0)];
      if (!a) continue;
      const b = B.cols[(i - di - B.i0) * B.nk + (k - dk - B.k0)];
      if (!b) continue;
      for (let p = 0; p < a.length; p += 2)
        for (let q = 0; q < b.length; q += 2) {
          const a0 = a[p], a1 = a[p + 1], b0 = b[q], b1 = b[q + 1];
          // [a0 + d, a1 + d] against [b0, b1]: a trapezoid in d
          const s = b0 - a1, e = b1 - a0, m1 = Math.min(b1 - a1, b0 - a0), m2 = Math.max(b1 - a1, b0 - a0);
          ev.push(s, 1, m1, -1, m2, -1, e, 1);
        }
    }
  const n = ev.length / 2;
  if (!n) return { d: new Float64Array(0), v: new Float64Array(0), cols: 0 };
  const idx = new Uint32Array(n);
  for (let j = 0; j < n; j++) idx[j] = j;
  idx.sort((x, y) => ev[2 * x] - ev[2 * y]);
  const d = [], v = [];
  let slope = 0, val = 0, last = ev[2 * idx[0]];
  for (let j = 0; j < n; j++) {
    const at = ev[2 * idx[j]];
    val += slope * (at - last);
    last = at;
    slope += ev[2 * idx[j] + 1];
    if (d.length && d[d.length - 1] === at) v[v.length - 1] = val;
    else d.push(at), v.push(val);
  }
  const a2 = H * H;
  return { d: Float64Array.from(d), v: Float64Array.from(v, (x) => Math.max(0, x * a2)) };
}

// the value at d, and the largest value on [lo, hi]
export function valueAt(f, x) {
  const { d, v } = f;
  if (!d.length || x <= d[0] || x >= d[d.length - 1]) return 0;
  let lo = 0, hi = d.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (d[m] <= x) lo = m;
    else hi = m;
  }
  return v[lo] + ((v[hi] - v[lo]) * (x - d[lo])) / (d[hi] - d[lo]);
}
export function maxOn(f, lo, hi) {
  if (lo > hi) [lo, hi] = [hi, lo];
  let m = Math.max(valueAt(f, lo), valueAt(f, hi));
  const { d, v } = f;
  for (let j = 0; j < d.length; j++) if (d[j] > lo && d[j] < hi) m = Math.max(m, v[j]);
  return m;
}

// the footprint of a part seen from above, grown by r cells: a set of column keys
export function footprint(s, r = 0, di = 0, dk = 0) {
  const set = new Set();
  for (let i = 0; i < s.ni; i++)
    for (let k = 0; k < s.nk; k++) {
      if (!s.cols[i * s.nk + k]) continue;
      for (let a = -r; a <= r; a++)
        for (let b = -r; b <= r; b++) if (a * a + b * b <= r * r) set.add((s.i0 + i + a + di) * 65536 + (s.k0 + k + b + dk));
    }
  return set;
}
