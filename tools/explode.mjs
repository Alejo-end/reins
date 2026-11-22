// How the two units of public/model/reins.glb come apart: works out the plan from the parts' own
// shapes and the order of the real build, writes it into src/parts.json, and then checks every
// moment of every animation of the page for parts that pass through each other.
//
//   node tools/explode.mjs            plan, write src/parts.json, check (exit 1 on a collision)
//   node tools/explode.mjs --check    only check the plan already in src/parts.json
//
// Needs glTF-Transform and meshoptimizer from tools/work/npm (the private build installs them),
// and TypeScript from node_modules: the motion is src/motion.ts, the same code the page runs.
//
// The plan (src/motion.ts says how the page uses it):
//  1. Each part is a solid of vertical columns (tools/solids.mjs). For each pair the tool knows the
//     overlap volume as a function of lifting one against the other, and from that the relation:
//     A comes off B upwards (A over B), downwards (A under B), or neither (locked).
//  2. The base stays: the receiver's lid (the case goes together upside down in the lid), the
//     pickguard plate with the stock pickups under it. Every other part comes in along the way
//     the shapes allow against the parts already in, in the order of the export (parts.json
//     "order", the real build). Up or down follows from the relations, not from the export's
//     explode vectors: those send the light bar and the button caps up through the lid.
//  3. A part that locks or overlaps (more than 1 mm3) a part of the same order is one piece with it
//     (the encoder and the switch soldered on the guitar board). A part locked against an earlier or later one
//     slides in across (a jack nut on its thread, the cell into its sleeve) or turns in (the
//     bayonet bezel): the tool tries every direction across, then a quarter turn each way, and
//     takes the one that is free. The part with the smaller footprint moves and rides on the other.
//  4. Apart, the parts stand in layers: each clears every part before it whose footprint it
//     shares (grown by 1 mm) by GAP mm, over its whole height. Like a sandwich.
//  5. LED pucks ride on the part under them. A part without an order (the guitar's OLED module,
//     split off the board by assemble.mjs) goes in just before the first part that covers it.
//
// The check moves the parts with src/motion.ts through the stage (both units), the receiver's
// explode, the pickguard's explode and random mixes of stage and explode, and measures the overlap
// of every pair along the way: exactly over each vertical stretch between two samples, and at
// samples no more than 0.2 mm or 1 degree apart where a part moves across or turns. A pair may
// overlap only as much as it does at rest (press fits, crush ribs, coincident faces of the mesh),
// plus TOL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadParts, solid, overlapFn, valueAt, maxOn, footprint, H, volume } from './solids.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = path.join(SITE, 'src/parts.json');
const GLB = path.join(SITE, 'public/model/reins.glb');
const CHECK_ONLY = process.argv.includes('--check');
const TOL = 0.1; // mm3 an overlap may grow by before it counts
const GAP = { receiver: 7, guitar: 7 }; // mm between layers, apart
const GROW = 5; // cells (1 mm): parts this close side by side still stack
const UNITS = {
  // the case goes together upside down in the lid (heat/case/v2/web/README.md); the page keeps the
  // main board still, so the box opens around it
  receiver: { base: /^R_Lid/, ref: 'R_Board' },
  // the plate stays, the pickups are stock and stay in the body (pickguard/v2/web/README.md)
  guitar: { base: /^G_(Pickups|Plate_Ply)/ },
};
// the press fits of the CAD checks (heat/case/v2/checks.txt, pickguard/v2/checks.txt)
const INTENDED = [
  ['R_Tray', 'R_Lid', 'lid lip crush ribs'], ['R_Lid', 'R_LightBar', 'collar crush ribs'], ['R_Lid', 'R_LightBaffle', 'collar crush ribs'],
  ['R_Knob', 'R_Board', 'knob hub on the encoder shaft'], ['G_Knob', 'G_Encoder_PEC12R', 'knob crush ribs on the shaft'],
];

// ---- the motion, from src/motion.ts -----------------------------------------------------------------
const ts = createRequire(path.join(SITE, 'package.json'))('typescript');
const js = ts.transpileModule(fs.readFileSync(path.join(SITE, 'src/motion.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

// ---- solids --------------------------------------------------------------------------------------------
let info = JSON.parse(fs.readFileSync(PARTS, 'utf8'));
const t0 = Date.now();
const meshes = await loadParts(SITE, GLB);
const solids = new Map();
for (const p of info) {
  if (!meshes.has(p.name)) throw new Error(`explode.mjs: ${p.name} is not in ${GLB}`);
  solids.set(p.name, solid(p.name, meshes.get(p.name)));
}
const vol = new Map([...solids].map(([n, s]) => [n, volume(s)]));
// a part turned about the vertical through its centre (the page's pivot), whole degrees
const turned = new Map();
function solidAt(name, deg) {
  if (!deg) return solids.get(name);
  const key = `${name}@${deg}`;
  if (!turned.has(key)) {
    const s = solids.get(name), t = meshes.get(name), out = new Float64Array(t.length);
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, c = Math.cos((deg * Math.PI) / 180), sn = Math.sin((deg * Math.PI) / 180);
    for (let i = 0; i < t.length; i += 3) {
      const x = t[i] - cx, z = t[i + 2] - cz;
      // three.js rotation.y: x' = x cos + z sin, z' = -x sin + z cos
      out[i] = cx + x * c + z * sn;
      out[i + 1] = t[i + 1];
      out[i + 2] = cz - x * sn + z * c;
    }
    turned.set(key, solid(key, out));
  }
  return turned.get(key);
}
// overlap(d) of A lifted by d against B, A moved across by (mx, mz) cells, both turned
const fns = new Map();
function fn(a, ta, b, tb, mx = 0, mz = 0) {
  const key = `${a}|${ta}|${b}|${tb}|${mx}|${mz}`;
  if (!fns.has(key)) fns.set(key, overlapFn(solidAt(a, ta), solidAt(b, tb), -mx, -mz));
  return fns.get(key);
}
const rest = (a, b) => valueAt(fn(a, 0, b, 0), 0);
// how A can leave B: 'over' (up), 'under' (down), 'free' (no shared column), 'locked'
function relation(a, b, ta = 0, tb = 0) {
  const f = fn(a, ta, b, tb);
  if (!f.d.length) return 'free';
  const v0 = valueAt(f, 0);
  const up = maxOn(f, 0.02, 1e4) <= v0 + TOL, down = maxOn(f, -1e4, -0.02) <= v0 + TOL;
  return up && down ? 'free' : up ? 'over' : down ? 'under' : 'locked';
}

// ---- the plan --------------------------------------------------------------------------------------------
function planUnit(unit) {
  const U = UNITS[unit], gap = GAP[unit];
  const names = info.filter((p) => p.unit === unit).map((p) => p.name);
  const order = new Map(info.filter((p) => p.unit === unit && p.order != null).map((p) => [p.name, p.order]));
  const isBase = (n) => U.base.test(n);
  const puck = (n) => /_LED_/.test(n);
  const ride = new Map(); // name -> { parent, own: [x, z] mm, why }
  const turn = new Map(); // name -> degrees
  const dir = new Map(); // root name -> +1 up, -1 down
  const notes = [];

  // pucks ride on the part right under their centre
  for (const n of names.filter(puck)) {
    const s = solids.get(n), i = Math.round((s.i0 + s.ni / 2)), k = Math.round((s.k0 + s.nk / 2));
    let best = null, top = -Infinity;
    for (const m of names) {
      if (puck(m)) continue;
      const t = solids.get(m), c = t.cols[(i - t.i0) * t.nk + (k - t.k0)];
      if (i < t.i0 || k < t.k0 || i >= t.i0 + t.ni || k >= t.k0 + t.nk || !c) continue;
      const y = c[c.length - 1];
      if (y <= s.y0 + 0.5 && y > top) (top = y), (best = m);
    }
    if (!best) throw new Error(`explode.mjs: nothing under ${n}`);
    ride.set(n, { parent: best, own: [0, 0], why: 'sits on it' });
  }
  // a part without an order goes in just before the first part that covers it (up) or that it
  // covers (down), against the base
  for (const n of names.filter((n) => !puck(n) && !order.has(n))) {
    const rels = names.filter(isBase).map((b) => relation(n, b));
    const up = rels.includes('over');
    const after = names.filter((m) => order.has(m) && !isBase(m) && relation(m, n) === (up ? 'over' : 'under')).map((m) => order.get(m));
    if (!after.length) throw new Error(`explode.mjs: no order for ${n}`);
    order.set(n, Math.min(...after) - 0.5);
    notes.push(`${n}: no order in the export; goes in ${up ? 'from above' : 'from below'} at ${order.get(n)}, before the parts that cover it`);
  }
  // glue: locked against a part of the same order, it is one piece with it
  const movers = names.filter((n) => !puck(n) && !isBase(n));
  for (const a of movers)
    for (const b of movers) {
      if (a >= b || order.get(a) !== order.get(b) || ride.has(a) || ride.has(b)) continue;
      // soldered on (the encoder's pins in the board): more than a touch at rest, or locked
      if (relation(a, b) !== 'locked' && rest(a, b) <= 1) continue;
      const [small, big] = vol.get(a) < vol.get(b) ? [a, b] : [b, a];
      ride.set(small, { parent: big, own: [0, 0], why: 'one piece with it' });
    }
  // locked against an earlier or later part: slide across, or turn a quarter and go up or down
  const roots = () => movers.filter((n) => !ride.has(n));
  for (const a of roots())
    for (const b of [...roots(), ...names.filter(isBase)]) {
      if (a === b || ride.has(a) || ride.has(b) || (isBase(a) && isBase(b))) continue;
      if (relation(a, b) !== 'locked') continue;
      // the part with the smaller footprint moves (the nut on its socket, the cell in its sleeve)
      const [mover, other] = isBase(b) || solids.get(a).used < solids.get(b).used ? [a, b] : [b, a];
      const slide = findSlide(mover, other, gap);
      if (slide) {
        ride.set(mover, { parent: other, own: slide.own, why: `slides ${slide.len.toFixed(1)} mm across, ${slide.deg} deg` });
        continue;
      }
      const t = findTurn(mover, other);
      if (!t) throw new Error(`explode.mjs: ${mover} is locked in ${other} and no slide or quarter turn frees it`);
      turn.set(mover, t);
      notes.push(`${mover}: locked in ${other}; turns ${t} deg, then leaves along the vertical`);
    }
  // up or down: from the relations against the parts already in
  for (const n of roots()) {
    const tn = turn.get(n) ?? 0;
    const before = names.filter((m) => !puck(m) && m !== n && (isBase(m) || (order.get(m) ?? -1) < order.get(n)));
    const rels = before.map((m) => [m, relation(n, m, tn, turn.get(m) ?? 0)]).filter(([, r]) => r === 'over' || r === 'under');
    const ups = rels.filter(([, r]) => r === 'over').map(([m]) => m), downs = rels.filter(([, r]) => r === 'under').map(([m]) => m);
    if (ups.length && downs.length) notes.push(`CONFLICT ${n}: over ${ups.join(', ')} but under ${downs.join(', ')}`);
    const hint = info.find((p) => p.name === n).explode?.[2] ?? 0;
    dir.set(n, ups.length > downs.length ? 1 : downs.length ? -1 : hint >= 0 ? 1 : -1);
  }
  // within one order, the part that leaves first in its direction goes first
  const rootsIn = roots();
  const seq = [];
  const orders = [...new Set(rootsIn.map((n) => order.get(n)))].sort((a, b) => a - b);
  for (const o of orders) {
    let left = rootsIn.filter((n) => order.get(n) === o);
    while (left.length) {
      const next = left.find((n) => !left.some((m) => m !== n && dir.get(n) === dir.get(m) && relation(m, n) === (dir.get(n) > 0 ? 'under' : 'over'))) ?? left[0];
      seq.push(next);
      left = left.filter((m) => m !== next);
    }
  }
  // the groups apart: a root with its riders, their footprints where they are apart
  const group = (n) => {
    const members = [n, ...names.filter((m) => rootOf(m) === n && m !== n)];
    let fp = new Set(), y0 = Infinity, y1 = -Infinity;
    for (const m of members) {
      const s = solidAt(m, turn.get(m) ?? 0), own = ownCells(m);
      for (const c of footprint(s, GROW, own[0], own[1])) fp.add(c);
      y0 = Math.min(y0, s.y0);
      y1 = Math.max(y1, s.y1);
    }
    return { fp, y0, y1 };
  };
  const rootOf = (m) => (ride.has(m) ? rootOf(ride.get(m).parent) : m);
  const ownCells = (m) => {
    let x = 0, z = 0;
    for (let a = m; ride.has(a); a = ride.get(a).parent) (x += ride.get(a).own[0]), (z += ride.get(a).own[1]);
    return [Math.round(x / H), Math.round(z / H)];
  };
  const placed = [];
  const baseG = { names: names.filter(isBase), r: 0 };
  {
    let fp = new Set(), y0 = Infinity, y1 = -Infinity;
    for (const b of baseG.names) {
      const s = solids.get(b);
      for (const c of footprint(s, 0)) fp.add(c);
      y0 = Math.min(y0, s.y0);
      y1 = Math.max(y1, s.y1);
    }
    placed.push({ name: 'base', fp, y0, y1, r: 0 });
  }
  const r = new Map();
  const meets = (A, B) => {
    const [s, l] = A.size < B.size ? [A, B] : [B, A];
    for (const c of s) if (l.has(c)) return true;
    return false;
  };
  for (const n of seq) {
    const G = group(n), d = dir.get(n);
    let v = 0;
    for (const J of placed) {
      if (!meets(G.fp, J.fp)) continue;
      v = d > 0 ? Math.max(v, J.r + Math.max(0, J.y1 - G.y0 + gap)) : Math.min(v, J.r + Math.min(0, J.y0 - G.y1 - gap));
    }
    r.set(n, v);
    placed.push({ name: n, ...G, r: v });
  }
  // ranks: the order of the build, among the parts that move on their own
  const own = (n) => r.has(n) || (ride.has(n) && (ride.get(n).own[0] || ride.get(n).own[1]));
  const rankOrders = [...new Set(names.filter((n) => !isBase(n) && own(n)).map((n) => order.get(n)))].sort((a, b) => a - b);
  const C = U.ref ? -(r.get(U.ref) ?? 0) : 0;
  const steps = [];
  const awayOf = (n) => {
    if (isBase(n)) return [0, C, 0];
    if (ride.has(n)) {
      const { parent, own: o } = ride.get(n), a = awayOf(parent);
      return [a[0] + o[0], a[1], a[2] + o[1]];
    }
    return [0, r.get(n) + C, 0];
  };
  const rankOf = (n) => (isBase(n) ? 0 : own(n) ? rankOrders.indexOf(order.get(n)) : rankOf(ride.get(n).parent));
  for (const n of names) {
    const s = { name: n, away: awayOf(n).map((x) => +x.toFixed(3)), rank: rankOf(n) };
    if (ride.has(n)) s.ride = ride.get(n).parent;
    if (turn.has(n)) s.turn = +((turn.get(n) * Math.PI) / 180).toFixed(6);
    if (isBase(n)) s.base = true;
    if (n === U.ref) s.ref = true;
    steps.push(s);
  }
  return { steps, order, notes, ride, dir, seq, r };
}

// a way across out of `other`: the overlap may not grow on the way, checked one cell at a time.
// Every degree first, then a tenth of a degree around the directions that got furthest: a sleeve
// (the cell in its cradle) leaves only a fraction of a degree.
function findSlide(mover, other, gap) {
  const A = solids.get(mover), B = solids.get(other);
  const v0 = rest(mover, other);
  const hint = info.find((p) => p.name === mover).explode ?? [0, 0, 0];
  // the export's vector is in its frame (z up): page x = frame x, page z = -frame y
  const hx = hint[0], hz = -hint[1], hl = Math.hypot(hx, hz);
  const fpB = footprint(B, 0), fpA = [...footprint(A, 0)];
  const path = (deg) => {
    const ux = Math.cos((deg * Math.PI) / 180), uz = Math.sin((deg * Math.PI) / 180);
    for (let s = 1; s < 600; s++) {
      const mx = Math.round(s * ux), mz = Math.round(s * uz);
      if (valueAt(overlapFn(A, B, -mx, -mz), 0) > v0 + TOL) return { deg, ok: false, s };
      let hit = false;
      for (const c of fpA)
        if (fpB.has(c + mx * 65536 + mz)) {
          hit = true;
          break;
        }
      if (!hit) return { deg, ok: true, s, clear: s };
    }
    return { deg, ok: false, s: 600 };
  };
  const coarse = [];
  for (let deg = 0; deg < 360; deg++) coarse.push(path(deg));
  let free = coarse.filter((r) => r.ok);
  if (!free.length) {
    const best = [...coarse].sort((a, b) => b.s - a.s).slice(0, 4);
    for (const b of best) for (let k = -10; k <= 10; k++) free.push(path(+(b.deg + k / 10).toFixed(1)));
    free = free.filter((r) => r.ok);
  }
  if (!free.length) return null;
  let pick;
  if (hl > 0) {
    const hd = ((Math.atan2(hz, hx) * 180) / Math.PI + 360) % 360;
    const off = (f) => Math.abs(((f.deg - hd + 540) % 360) - 180);
    pick = free.filter((f) => off(f) <= 2).sort((a, b) => off(a) - off(b))[0];
  }
  // else the middle of the free directions next to the one that got clear soonest
  if (!pick) {
    free.sort((a, b) => a.deg - b.deg);
    const runs = [];
    for (const f of free) {
      const last = runs[runs.length - 1];
      if (last && f.deg - last[last.length - 1].deg <= 1.01) last.push(f);
      else runs.push([f]);
    }
    const run = runs.sort((a, b) => b.length - a.length)[0];
    pick = run[Math.floor(run.length / 2)];
  }
  const len = Math.max(pick.clear * H + gap, hl);
  const rad = (pick.deg * Math.PI) / 180;
  return { deg: pick.deg, len, own: [+(Math.cos(rad) * len).toFixed(3), +(Math.sin(rad) * len).toFixed(3)] };
}

// a quarter turn that frees `mover` along the vertical, and turns freely in place
function findTurn(mover, other) {
  const v0 = rest(mover, other);
  for (const sign of [1, -1]) {
    const r = relation(mover, other, 90 * sign, 0);
    if (r !== 'over' && r !== 'under') continue;
    let ok = true;
    for (let d = 1; d <= 90 && ok; d++) if (valueAt(fn(mover, d * sign, other, 0), 0) > v0 + TOL) ok = false;
    if (ok) return 90 * sign;
  }
  return null;
}

// ---- plan, write -----------------------------------------------------------------------------------------
const plans = {};
if (!CHECK_ONLY) {
  for (const unit of Object.keys(UNITS)) {
    const P = planUnit(unit);
    plans[unit] = P.steps;
    console.log(`\n${unit}: the build, ${P.seq.length} parts that move on their own`);
    for (const n of P.seq) console.log(`  ${String(P.order.get(n)).padStart(4)} ${n.padEnd(20)} ${P.dir.get(n) > 0 ? 'up  ' : 'down'} ${P.r.get(n).toFixed(1).padStart(7)} mm`);
    for (const [n, x] of P.ride) if (!/_LED_/.test(n)) console.log(`       ${n.padEnd(20)} rides ${x.parent}: ${x.why}`);
    for (const t of P.notes) console.log(`  ${t}`);
    for (const s of P.steps) {
      const p = info.find((q) => q.name === s.name);
      for (const k of ['away', 'rank', 'ride', 'turn', 'base', 'ref']) delete p[k];
      Object.assign(p, { away: s.away, rank: s.rank }, s.ride ? { ride: s.ride } : {}, s.turn ? { turn: s.turn } : {}, s.base ? { base: true } : {}, s.ref ? { ref: true } : {});
      if (p.order == null && P.order.has(s.name) && !/_LED_/.test(s.name)) p.order = P.order.get(s.name);
    }
  }
  fs.writeFileSync(PARTS, JSON.stringify(info, null, 1) + '\n');
  console.log(`\nwrote ${PARTS}`);
  info = JSON.parse(fs.readFileSync(PARTS, 'utf8'));
}

// ---- check -----------------------------------------------------------------------------------------------
const unitPlans = {};
for (const unit of Object.keys(UNITS)) {
  const steps = info.filter((p) => p.unit === unit).map((p) => ({ name: p.name, away: p.away, rank: p.rank, ride: p.ride, turn: p.turn, base: p.base, ref: p.ref }));
  if (steps.some((s) => !s.away)) throw new Error(`explode.mjs: no plan for ${unit} in ${PARTS}; run without --check`);
  unitPlans[unit] = M.makePlan(steps);
}
const deg = (r) => Math.round((r * 180) / Math.PI);
// the moments: [asm, e] per unit, x from together (0) to apart (1)
const scenarios = {
  'stage (scrolled back up)': (x) => ({ receiver: [M.span(1 - x, ...M.STAGE.receiver), 0], guitar: [M.span(1 - x, ...M.STAGE.guitar), 0] }),
  'inside (receiver explode)': (x) => ({ receiver: [1, M.easeInOut(x)], guitar: [1, 0] }),
  'stack (pickguard explode)': (x) => ({ receiver: [1, 0], guitar: [1, M.easeInOut(x)] }),
};
const report = [];
let worst = 0, samples = 0, pairTests = 0;
const stats = new Map(); // pair -> { max, rest, at }
// run: per pair the least overlap so far on the way apart. A pair that touches at rest has to come
// apart and stay apart: its overlap may only shrink.
function test(unit, st, prev, run = null) {
  const names = [...st.keys()];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j], pa = st.get(a), pb = st.get(b);
      const A = solids.get(a), B = solids.get(b);
      // boxes first (a turned part: its circle)
      const ra = pa.turn ? Math.hypot(A.x1 - A.x0, A.z1 - A.z0) / 2 : 0, rb = pb.turn ? Math.hypot(B.x1 - B.x0, B.z1 - B.z0) / 2 : 0;
      const ax = (A.x0 + A.x1) / 2 + pa.x, az = (A.z0 + A.z1) / 2 + pa.z, bx = (B.x0 + B.x1) / 2 + pb.x, bz = (B.z0 + B.z1) / 2 + pb.z;
      const hax = ra || (A.x1 - A.x0) / 2, haz = ra || (A.z1 - A.z0) / 2, hbx = rb || (B.x1 - B.x0) / 2, hbz = rb || (B.z1 - B.z0) / 2;
      const lo = Math.min(A.y0 + pa.y, prev ? A.y0 + prev.get(a).y : Infinity), hi = Math.max(A.y1 + pa.y, prev ? A.y1 + prev.get(a).y : -Infinity);
      const lo2 = Math.min(B.y0 + pb.y, prev ? B.y0 + prev.get(b).y : Infinity), hi2 = Math.max(B.y1 + pb.y, prev ? B.y1 + prev.get(b).y : -Infinity);
      if (Math.abs(ax - bx) > hax + hbx + H || Math.abs(az - bz) > haz + hbz + H || lo > hi2 || lo2 > hi) continue;
      pairTests++;
      const mx = Math.round((pa.x - pb.x) / H), mz = Math.round((pa.z - pb.z) / H), ta = deg(pa.turn), tb = deg(pb.turn);
      const f = fn(a, ta, b, tb, mx, mz);
      const d = pa.y - pb.y;
      let v = valueAt(f, d);
      if (prev) {
        const qa = prev.get(a), qb = prev.get(b);
        // the same pose across: the whole vertical stretch between the samples
        if (Math.round((qa.x - qb.x) / H) === mx && Math.round((qa.z - qb.z) / H) === mz && deg(qa.turn) === ta && deg(qb.turn) === tb) v = maxOn(f, qa.y - qb.y, d);
      }
      const key = `${a} x ${b}`;
      const r0 = rest(a, b);
      const s = stats.get(key) ?? { max: 0, rest: r0, unit };
      if (v > s.max) s.max = v;
      if (v > r0 + TOL && v - r0 > (s.over ?? 0)) (s.over = v - r0), (s.at = st.label);
      if (run && r0 > 0.01) {
        const low = run.get(key) ?? r0;
        if (v > low + TOL && v - low > (s.regrow ?? 0)) (s.regrow = v - low), (s.regrowAt = st.label);
        run.set(key, Math.min(low, v));
      }
      stats.set(key, s);
    }
}
function poseOf(unit, asm, e, label) {
  const st = new Map();
  for (const [n, p] of M.poses(unitPlans[unit], asm, e)) st.set(n, { ...p });
  st.label = label;
  return st;
}
const moved = (s1, s2) => {
  let m = 0;
  for (const [n, p] of s1) {
    const q = s2.get(n);
    m = Math.max(m, Math.abs(p.x - q.x) / H, Math.abs(p.z - q.z) / H, Math.abs(p.turn - q.turn) * (180 / Math.PI));
  }
  return m;
};
for (const [name, at] of Object.entries(scenarios)) {
  for (const unit of Object.keys(UNITS)) {
    const N = 400;
    let prev = null, px = 0;
    const run = new Map();
    for (let k = 0; k <= N; k++) {
      const x = k / N;
      const [asm, e] = at(x)[unit];
      let st = poseOf(unit, asm, e, `${name} ${x.toFixed(4)}`);
      // across and turning: no more than a cell or a degree between samples
      if (prev && moved(prev, st) > 1) {
        const n = Math.ceil(moved(prev, st));
        for (let q = 1; q < n; q++) {
          const xq = px + ((x - px) * q) / n;
          const [aq, eq] = at(xq)[unit];
          const sq = poseOf(unit, aq, eq, `${name} ${xq.toFixed(4)}`);
          test(unit, sq, prev, run);
          samples++;
          prev = sq;
        }
      }
      test(unit, st, prev, run);
      samples++;
      prev = st;
      px = x;
    }
  }
}
// random moments: a stage position with an explode still under way, both ways
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let k = 0; k < 1500; k++)
  for (const unit of Object.keys(UNITS)) {
    test(unit, poseOf(unit, rnd(), M.easeInOut(rnd()), `random ${k}`), null);
    samples++;
  }

// at full explode: who still touches (only parts that ride as one piece should)
const apart = [];
for (const unit of Object.keys(UNITS)) {
  const st = poseOf(unit, 1, 1, 'apart');
  const names = [...st.keys()];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j], pa = st.get(a), pb = st.get(b);
      const v = valueAt(fn(a, deg(pa.turn), b, deg(pb.turn), Math.round((pa.x - pb.x) / H), Math.round((pa.z - pb.z) / H)), pa.y - pb.y);
      const rigid = pa.x === pb.x && pa.y === pb.y && pa.z === pb.z && pa.turn === pb.turn;
      if (v > 0.001) apart.push(`${a} x ${b}: ${v.toFixed(2)} mm3${rigid ? ', one piece: they move together, as at rest' : ''}`);
    }
}

console.log(`\ncheck: ${samples} moments, ${pairTests} pair tests, solids on a ${H} mm grid, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('\noverlap at rest (mm3), the pairs that touch in the model:');
for (const [k, s] of [...stats].filter(([, s]) => s.rest > 0.01).sort((x, y) => y[1].rest - x[1].rest)) {
  const [a, b] = k.split(' x ');
  const why = INTENDED.find(([p, q]) => (p === a && q === b) || (p === b && q === a));
  console.log(`  ${k.padEnd(40)} ${s.rest.toFixed(3).padStart(9)}  ${why ? `intended: ${why[2]}` : ''}`);
}
const bad = [...stats].filter(([, s]) => s.over || s.regrow);
console.log(`\noverlap beyond rest + ${TOL} mm3 while moving, or growing again after coming apart: ${bad.length ? '' : 'none'}`);
for (const [k, s] of bad) {
  if (s.over) console.log(`  ${k.padEnd(40)} +${s.over.toFixed(2)} mm3 over rest at ${s.at}`);
  if (s.regrow) console.log(`  ${k.padEnd(40)} +${s.regrow.toFixed(2)} mm3 after coming apart, at ${s.regrowAt}`);
}
console.log(`\nat full explode, pairs that still overlap: ${apart.length ? '' : 'none'}`);
for (const l of apart) console.log(`  ${l}`);
process.exitCode = bad.length ? 1 : 0;
