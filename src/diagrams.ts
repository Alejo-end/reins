// The flat line drawings of the page. Each one draws a part of REINS the way the lid prints:
// thin lines, orange where something happens, labels in capitals. They read the firmware model
// (reins.ts) and its numbers (firmware.json); none of them invents a value.
import FW from "./firmware.json";
import type { Rgb } from "./reins";

const NS = "http://www.w3.org/2000/svg";
const G = FW.guitar, R = FW.receiver;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

function svg(host: HTMLElement, vb: string, label: string) {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", vb);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.setAttribute("class", "line");
  host.appendChild(el);
  return el;
}
function mk<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element, text?: string) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}
const rgb = (c: Rgb | number[]) => `rgb(${c.map((x) => Math.round(x)).join(" ")})`;
// a pixel as the eye sees it: the firmware's value lifted, so a dim LED still reads
const lift = (c: Rgb) => c.map((x) => 255 * Math.pow(Math.min(1, x / 255), 0.55)) as Rgb;
const isOff = (c: Rgb) => c[0] + c[1] + c[2] < 3;

// ---- 1. the hand over the guitar's sensor, in section, and the ring from above -------------------
export function handDiagram(host: HTMLElement) {
  const el = svg(host, "0 0 400 226", "The hand over the guitar's sensor, in section, with the distance scale and the 16 LED ring seen from above");
  const Y0 = 196, K = 0.29; // the body top, px per mm
  const X = 150; // the sensor's axis
  const yOf = (mm: number) => Y0 - 6 - mm * K;
  // the scale: 0 to 600 mm, the firmware's range marked
  const sc = mk("g", { class: "scale" }, el);
  mk("line", { x1: 40, y1: yOf(0), x2: 40, y2: yOf(600), class: "rule" }, sc);
  for (let mm = 0; mm <= 600; mm += 100) {
    mk("line", { x1: 36, y1: yOf(mm), x2: 40, y2: yOf(mm), class: "rule" }, sc);
    mk("text", { x: 31, y: yOf(mm) + 3.5, "text-anchor": "end", class: "small" }, sc, String(mm));
  }
  mk("line", { x1: 44, y1: yOf(G.distMin), x2: 44, y2: yOf(G.distMax), class: "range-bar" }, sc);
  mk("text", { x: 50, y: yOf(G.distMax) + 3.5, class: "small o" }, sc, `CC ${G.ccDist} = 127`);
  mk("text", { x: 50, y: yOf(G.distMin) + 3.5, class: "small o" }, sc, "0");
  mk("text", { x: 50, y: yOf(600) + 3.5, class: "cap" }, sc, "MM");
  // the body, the plate with the eye, the sensor under it
  mk("path", { d: `M60 ${Y0}H112M188 ${Y0}H240M60 ${Y0 - 4}H112M188 ${Y0 - 4}H240M112 ${Y0 - 4}V${Y0 + 10}H188V${Y0 - 4}`, class: "ink" }, el);
  mk("rect", { x: X - 9, y: Y0 + 6, width: 18, height: 4, class: "ink" }, el);
  mk("text", { x: 248, y: Y0 + 1, class: "cap" }, el, "PICKGUARD");
  // the cone the pod leaves open (pod.py, 14 degrees), and the hand
  const cone = mk("path", { class: "beam" }, el);
  const hand = mk("g", { class: "hand" }, el);
  // a relaxed hand, palm down, from the side: the wrist on the left, the knuckles, the fingers
  // curling down at their two joints, the thumb under the palm
  mk("path", {
    d: "M-84 -14C-60 -18 -36 -22 -14 -22C-4 -22 4 -20 10 -17C20 -15 30 -14 40 -12C46 -11 50 -10 54 -7C60 -4 64 0 66 5C67 9 66 12 62 12C58 12 56 8 54 5C50 0 44 -2 36 -3C24 -4 12 -3 2 -1C-14 2 -34 2 -52 1C-66 0 -76 -2 -84 -2",
    class: "ink",
  }, hand);
  mk("path", { d: "M8 -17C9 -12 8 -6 5 -2M52 -8C51 -5 50 -2 47 0M-30 1C-20 8 -4 10 8 6", class: "ink thin" }, hand);
  const lead = mk("line", { x1: 44, x2: X - 64, class: "lead" }, el);
  const val = mk("text", { x: X + 84, class: "num" }, el);
  // the ring from above: 16 pixels, LED 1 just counter clockwise of the wire pads (make_ring.py)
  const RC = [338, 96], RR = 40;
  mk("circle", { cx: RC[0], cy: RC[1], r: 48, class: "ink" }, el);
  mk("circle", { cx: RC[0], cy: RC[1], r: 32, class: "ink" }, el);
  mk("text", { x: RC[0], y: RC[1] + 72, "text-anchor": "middle", class: "cap" }, el, "RING");
  const px: SVGRectElement[] = [];
  for (let i = 0; i < G.pixels; i++) {
    const a = ((11.25 + 22.5 * i) * Math.PI) / 180;
    const x = RC[0] + RR * Math.cos(a), y = RC[1] - RR * Math.sin(a);
    px.push(mk("rect", { x: x - 3.6, y: y - 3.6, width: 7.2, height: 7.2, rx: 1, transform: `rotate(${-(11.25 + 22.5 * i)} ${x} ${y})`, class: "px" }, el));
  }
  return (mm: number | null, ring: Rgb[]) => {
    const on = mm != null;
    hand.style.opacity = on ? "1" : "0";
    lead.style.opacity = val.style.opacity = on ? "1" : "0";
    cone.style.opacity = on ? "1" : "0.25";
    const h = Math.min(600, mm ?? 600);
    const y = yOf(h);
    const r = Math.tan((14 * Math.PI) / 180) * (Y0 + 6 - y);
    cone.setAttribute("d", `M${X - 4} ${Y0 + 6}L${X - 4 - r} ${y + 4}M${X + 4} ${Y0 + 6}L${X + 4 + r} ${y + 4}`);
    hand.setAttribute("transform", `translate(${X} ${y})`);
    lead.setAttribute("y1", String(y));
    lead.setAttribute("y2", String(y));
    val.setAttribute("y", String(y - 16));
    val.textContent = `${Math.round(h)} mm`;
    ring.forEach((c, i) => {
      const l = lift(c);
      px[i].style.fill = isOff(c) ? "" : rgb(l);
      px[i].classList.toggle("on", !isOff(c));
    });
  };
}

// ---- 2. the field: the lid's two ring fields, a packet running through them ----------------------
// lid_art.py: rings every PITCH from each centre, wide near the centre and thin far out, a plain
// seam on the line halfway between the two centres, a plain margin along the edge.
export function fieldDiagram(host: HTMLElement) {
  // a phone gets a taller sheet, so the rings and the labels keep their size
  const narrow = host.clientWidth < 560;
  const W = narrow ? 600 : 1000, H = narrow ? 460 : 300;
  const el = svg(host, `0 0 ${W} ${H}`, "The two ring fields of the receiver lid: the guitar's at one corner, the receiver's around its sensor. A packet runs out through the guitar's rings and in through the receiver's.");
  const Gc = narrow ? [96, 380] : [120, 236], Bc = narrow ? [450, 110] : [800, 104];
  const P = narrow ? 15 : 13, M = 10;
  const dx = Bc[0] - Gc[0], dy = Bc[1] - Gc[1], L = Math.hypot(dx, dy);
  const nx = dx / L, ny = dy / L, mx = (Gc[0] + Bc[0]) / 2, my = (Gc[1] + Bc[1]) / 2;
  const half = (s: number, gap: number) => {
    // the half plane on the side s (-1 guitar, 1 box), gap / 2 off the seam
    const ox = mx + nx * s * gap / 2, oy = my + ny * s * gap / 2, tx = -ny * 2000, ty = nx * 2000;
    const fx = nx * s * 3000, fy = ny * s * 3000;
    return `M${ox + tx} ${oy + ty}L${ox - tx} ${oy - ty}L${ox - tx + fx} ${oy - ty + fy}L${ox + tx + fx} ${oy + ty + fy}Z`;
  };
  const id = `f${Math.random().toString(36).slice(2, 7)}`;
  mk("defs", {}, el).innerHTML = `
    <clipPath id="${id}-g"><path d="${half(-1, 7)}" /></clipPath>
    <clipPath id="${id}-b"><path d="${half(1, 7)}" /></clipPath>
    <clipPath id="${id}-f"><rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" rx="14" /></clipPath>`;
  mk("rect", { x: 1, y: 1, width: W - 2, height: H - 2, rx: 20, class: "frame" }, el);
  const all = mk("g", { "clip-path": `url(#${id}-f)` }, el);
  const far = (c: number[]) => Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
  const field = (c: number[], r0: number, side: string) => {
    const g = mk("g", { "clip-path": `url(#${id}-${side})`, class: "rings" }, all);
    const n = Math.floor((far(c) - r0) / P) + 1;
    const out: SVGCircleElement[] = [];
    for (let i = 0; i < n; i++) {
      const w = 2.4 + (1.1 - 2.4) * Math.min(i / Math.max(n - 1, 1), 1);
      out.push(mk("circle", { cx: c[0], cy: c[1], r: r0 + i * P, "stroke-width": w.toFixed(2) }, g));
    }
    return out;
  };
  const gr = field(Gc, 6, "g");
  const br = field(Bc, 34, "b");
  // the two sensors
  mk("circle", { cx: Bc[0], cy: Bc[1], r: 20, class: "hole" }, el);
  mk("circle", { cx: Gc[0], cy: Gc[1], r: 4, class: "dot" }, el);
  const fs = narrow ? 24 : 15; // about 10 px on a phone, 15 px on a desktop
  const lab = (x: number, y: number, t: string, anchor = "start") => {
    const w = t.length * fs * 0.95 + 16;
    mk("rect", { x: anchor === "middle" ? x - w / 2 : x - 8, y: y - fs, width: w, height: fs * 1.45, rx: 4, class: "lab-bg" }, el);
    mk("text", { x, y, "text-anchor": anchor, class: "cap-lg", "font-size": fs }, el, t);
  };
  lab(Gc[0] + 18, Gc[1] + 40, "GUITAR");
  lab(Bc[0], Bc[1] + 52, "BOX", "middle");
  // a ring is crossed when the wave front passes its radius; the box's rings, from the seam in
  const seamG = (L / 2 - 3.5);
  const run = (rings: SVGCircleElement[], order: number[], t0: number, ms: number, colour: string) => {
    order.forEach((i, k) => {
      rings[i]?.animate(
        [{ stroke: colour, opacity: 1 }, { stroke: colour, opacity: 1, offset: 0.25 }, { opacity: 0.32 }],
        { duration: ms, delay: t0 + k * 22, easing: "ease-out" },
      );
    });
    return t0 + order.length * 22;
  };
  let last = 0;
  return {
    /** A packet: out through the guitar's rings to the seam, in through the box's to its sensor. */
    packet() {
      const now = performance.now();
      if (reduce || now - last < 160) return;
      last = now;
      const out = gr.map((_, i) => i).filter((i) => 6 + i * P <= seamG + P);
      const t1 = run(gr, out, 0, 700, "var(--orange)");
      const inn = br.map((_, i) => i).filter((i) => 34 + i * P <= L / 2).reverse();
      run(br, inn, t1, 700, "var(--orange)");
    },
    /** The box's own sensor: out through its rings. */
    local() {
      const now = performance.now();
      if (reduce || now - last < 200) return;
      last = now;
      const out = br.map((_, i) => i).filter((i) => 34 + i * P <= L / 2);
      run(br, out, 0, 650, "var(--ink)");
    },
  };
}

// ---- 3. the receiver's 8 x 8 zones and its stick ------------------------------------------------
export function gridDiagram(host: HTMLElement) {
  const el = svg(host, "0 0 400 230", "The receiver's sensor: 8 by 8 zones, the hand over some of them, the nearest zone marked, and the 8 LED stick");
  const N = Math.round(Math.sqrt(R.zones)), C = 22, X0 = 24, Y0 = 18;
  const cells: SVGRectElement[] = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) cells.push(mk("rect", { x: X0 + i * C, y: Y0 + j * C, width: C, height: C, class: "cell" }, el));
  const near = mk("rect", { width: C, height: C, class: "near" }, el);
  mk("text", { x: X0, y: Y0 + N * C + 20, class: "cap" }, el, `${N} × ${N} ZONES, ${R.hz} PER SECOND`);
  // the stick, as the lid shows it: a column of square windows
  const SX = 300, SY = 18, S = 18, gap = 6.4;
  mk("rect", { x: SX - 6, y: SY - 6, width: S + 12, height: R.pixels * (S + gap) - gap + 12, rx: 3, class: "ink" }, el);
  const px: SVGRectElement[] = [];
  for (let i = 0; i < R.pixels; i++) px.push(mk("rect", { x: SX, y: SY + (R.pixels - 1 - i) * (S + gap), width: S, height: S, rx: 2, class: "px" }, el));
  mk("text", { x: SX + S / 2, y: Y0 + N * C + 20, "text-anchor": "middle", class: "cap" }, el, "STICK");
  return (mm: number | null, stick: Rgb[]) => {
    // the hand covers more zones the closer it is: a palm about 90 mm across seen through the
    // sensor's cone; the nearest zone is the middle of the palm
    const hc = [3.6, 3.9];
    const rz = mm == null ? 0 : Math.min(5.5, (90 / Math.max(mm, 60)) * 9);
    let best = -1, bestD = Infinity;
    cells.forEach((c, k) => {
      const i = k % N, j = Math.floor(k / N);
      const d = Math.hypot((i + 0.5 - hc[0]) / 1.0, (j + 0.5 - hc[1]) / 1.2);
      const inside = mm != null && d < rz;
      c.classList.toggle("hit", inside);
      c.style.opacity = inside ? String(0.35 + 0.65 * (1 - d / rz)) : "";
      if (inside && d < bestD) (bestD = d), (best = k);
    });
    near.style.opacity = best >= 0 ? "1" : "0";
    if (best >= 0) {
      near.setAttribute("x", String(X0 + (best % N) * C));
      near.setAttribute("y", String(Y0 + Math.floor(best / N) * C));
    }
    stick.forEach((c, i) => {
      px[i].style.fill = isOff(c) ? "" : rgb(lift(c));
      px[i].classList.toggle("on", !isOff(c));
    });
  };
}

// ---- 4. the pedal, the learned range, the two footswitches --------------------------------------
export function pedalDiagram(host: HTMLElement) {
  const el = svg(host, "0 0 400 220", "An expression pedal from the side, the range the receiver has learned, and the two footswitches on the FOOT jack");
  // the pedal: a base and a plate on a hinge near the heel
  mk("path", { d: "M24 150H176M24 150V140H176V150", class: "ink" }, el);
  const plate = mk("g", {}, el);
  mk("path", { d: "M0 0H150V-7H0Z", class: "ink" }, plate);
  mk("circle", { cx: 6, cy: 3, r: 3, class: "ink" }, el).setAttribute("transform", "translate(30 132)");
  mk("text", { x: 24, y: 174, class: "cap" }, el, "EXP");
  // the learned range on the wiper's 0 to 4095 counts
  const BX = 208, BW = 170, BY = 70;
  const cx = (v: number) => BX + (v / 4095) * BW;
  mk("line", { x1: BX, y1: BY, x2: BX + BW, y2: BY, class: "rule" }, el);
  for (const v of [0, 4095]) mk("text", { x: cx(v), y: BY + 18, "text-anchor": "middle", class: "small" }, el, String(v));
  mk("text", { x: BX, y: BY - 34, class: "cap" }, el, "LEARNED RANGE");
  const band = mk("rect", { y: BY - 5, height: 10, class: "band" }, el);
  const need = mk("path", { class: "need" }, el);
  const needT = mk("text", { y: BY + 34, class: "small" }, el, `${R.expMinSpan} counts`);
  const dot = mk("circle", { cy: BY, r: 4, class: "dot" }, el);
  // the footswitches: tip is MUTE, ring is HOLD
  const sw = (x: number, name: string, wire: string) => {
    const g = mk("g", { class: "sw" }, el);
    mk("circle", { cx: x, cy: 160, r: 15, class: "ink" }, g);
    const cap = mk("circle", { cx: x, cy: 160, r: 9, class: "cap-fill" }, g);
    mk("text", { x, y: 196, "text-anchor": "middle", class: "cap" }, g, name);
    mk("text", { x, y: 210, "text-anchor": "middle", class: "small" }, g, wire);
    return cap;
  };
  const mute = sw(250, "MUTE", "tip");
  const hold = sw(330, "HOLD", "ring");
  return (s: { raw: number; lo: number; hi: number; live: boolean }, muted: boolean, holding: boolean) => {
    const k = s.raw / 4095;
    plate.setAttribute("transform", `translate(32 132) rotate(${-14 + 18 * k})`);
    const seen = s.hi >= s.lo;
    band.setAttribute("x", String(seen ? cx(s.lo) : BX));
    band.setAttribute("width", String(seen ? Math.max(1, cx(s.hi) - cx(s.lo)) : 0));
    band.classList.toggle("live", s.live);
    const n0 = seen ? s.lo : 0;
    need.setAttribute("d", `M${cx(n0)} ${BY + 10}V${BY + 16}H${cx(Math.min(4095, n0 + R.expMinSpan))}V${BY + 10}`);
    need.style.opacity = needT.style.opacity = s.live ? "0" : "1";
    needT.setAttribute("x", String(cx(n0)));
    dot.setAttribute("cx", String(cx(s.raw)));
    mute.classList.toggle("on", muted);
    hold.classList.toggle("on", holding);
  };
}

// ---- 5. what reaches the outputs ----------------------------------------------------------------
export function routesDiagram(host: HTMLElement) {
  const el = svg(host, "0 0 400 210", "Three inputs on the left, the two outputs on the right, joined where the receiver decides what passes");
  const J = [262, 105];
  const ins = [
    { key: "guitar", y: 36, a: "GUITAR", b: `ch ${G.midiCh}, CC ${G.ccDist} ${G.ccVel}` },
    { key: "local", y: 105, a: "BOX SENSOR", b: `ch ${R.localCh}, CC ${R.ccDist} ${R.ccVel}` },
    { key: "pedal", y: 174, a: "PEDAL", b: `ch ${R.localCh}, CC ${R.expCc}` },
  ];
  const lines: Record<string, SVGPathElement> = {};
  for (const i of ins) {
    mk("text", { x: 8, y: i.y - 4, class: "cap" }, el, i.a);
    mk("text", { x: 8, y: i.y + 12, class: "small" }, el, i.b);
    lines[i.key] = mk("path", { d: `M128 ${i.y}H${J[0] - 60}C${J[0] - 30} ${i.y} ${J[0] - 30} ${J[1]} ${J[0]} ${J[1]}`, class: "route" }, el);
  }
  const outs = [{ y: 70, t: "USB" }, { y: 140, t: "DIN" }];
  const outLines: SVGPathElement[] = [];
  for (const o of outs) {
    outLines.push(mk("path", { d: `M${J[0]} ${J[1]}C${J[0] + 30} ${J[1]} ${J[0] + 30} ${o.y} ${J[0] + 60} ${o.y}H350`, class: "route" }, el));
    mk("text", { x: 358, y: o.y + 4, class: "cap" }, el, o.t);
  }
  mk("circle", { cx: J[0], cy: J[1], r: 5, class: "dot" }, el);
  return (pass: Record<string, boolean>) => {
    for (const [k, l] of Object.entries(lines)) l.classList.toggle("on", !!pass[k]);
    const any = Object.values(pass).some(Boolean);
    outLines.forEach((l) => l.classList.toggle("on", any));
  };
}
