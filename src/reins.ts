// A small model of the two REINS firmwares, for the page. The guitar (tof_midi_v5) turns the
// hand's distance into CC and sends each message over USB and ESP-NOW. The receiver
// (tof_midi_v6_rx) takes the packets, has its own sensor, a pedal and two footswitches, and
// sends everything on to USB and DIN. Every number comes from src/firmware.json, which
// tools/firmware.mjs reads from the firmware source.
import FW from "./firmware.json";

export type Rgb = [number, number, number];
export type Packet = { bytes: number[]; seq: number; from: "guitar" | "local" | "pedal"; passed: boolean; note: string };
const G = FW.guitar, R = FW.receiver;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const BLACK: Rgb = [0, 0, 0];
export const SOURCES = R.sources; // BOTH, GTR, LOC

export class Reins extends EventTarget {
  // ---- the guitar --------------------------------------------------------------------------
  hand: number | null = null; // mm above the sensor, or no hand
  guitarMuted = false;
  private ema = -1;
  private prevEma = -1;
  dist = 0; // CC 20 value
  vel = 0; // CC 21 value
  private sentDist = -1;
  private sentVel = -1;
  private seq = 0;
  private wipe = { until: 0, c: [200, 200, 200] as Rgb };
  // ---- the receiver --------------------------------------------------------------------------
  local: number | null = null; // mm above the receiver's sensor
  private lDist = 0;
  private lPrev = 0;
  private lVel = 0;
  private lT = 0;
  lDistCC = 0;
  lVelCC = 0;
  private lSent = [-1, -1];
  muted = false;
  holding = false;
  source = 0; // index into SOURCES
  pedal = { raw: 0, ema: -1, lo: 4095, hi: 0, live: false, cc: 0, sent: -1 };
  lastRx = -1e9;
  received = 0;
  private timers: number[] = [];

  constructor() {
    super();
    // the guitar polls its sensor every POLL_MS, the receiver's sensor runs at R.hz
    this.timers.push(window.setInterval(() => this.pollGuitar(), G.pollMs));
    this.timers.push(window.setInterval(() => this.pollLocal(), 1000 / R.hz));
  }

  private emit(p: Packet) {
    this.dispatchEvent(new CustomEvent<Packet>("packet", { detail: p }));
  }
  private changed() {
    this.dispatchEvent(new Event("change"));
  }

  // ---- guitar: sensor to CC to radio ---------------------------------------------------------
  private pollGuitar() {
    if (this.hand == null) return;
    this.prevEma = this.ema < 0 ? this.hand : this.ema;
    this.ema = this.ema < 0 ? this.hand : this.ema + G.ema * (this.hand - this.ema);
    const t = clamp((this.ema - G.distMin) / (G.distMax - G.distMin), 0, 1);
    this.dist = Math.round(t * 127);
    let d = Math.abs(this.ema - this.prevEma);
    if (d < G.velDeadMm) d = 0;
    this.vel = Math.round(clamp((d / G.velMaxMm) * 127, 0, 127));
    if (this.dist !== this.sentDist) {
      this.sentDist = this.dist;
      this.sendGuitar(G.ccDist, this.dist);
    }
    if (this.vel !== this.sentVel) {
      this.sentVel = this.vel;
      this.sendGuitar(G.ccVel, this.vel);
    }
  }
  private sendGuitar(cc: number, v: number) {
    if (this.guitarMuted) return;
    const status = 0xb0 | (G.midiCh - 1);
    const seq = this.seq;
    this.seq = (this.seq + 1) & 0xff;
    // the receiver: drops nothing on the way here; MODE and MUTE decide what goes out
    const src = SOURCES[this.source];
    const passed = src !== "LOC" && !this.muted;
    this.lastRx = performance.now();
    this.received++;
    const note = src === "LOC" ? "Received, not sent on: MODE is LOC." : this.muted ? "Received, not sent on: muted." : "Sent on to USB and DIN.";
    this.emit({ bytes: [G.magic, seq, status, cc, v], seq, from: "guitar", passed, note });
    this.changed();
  }
  setHand(mm: number | null) {
    this.hand = mm;
    if (mm == null) this.ema = -1;
  }
  toggleGuitarMute() {
    this.guitarMuted = !this.guitarMuted;
    this.wipe = { until: performance.now() + G.wipeMs, c: this.guitarMuted ? (G.mute as Rgb) : [200, 200, 200] };
    this.changed();
  }

  /** The 16 pixels of the guitar ring now (showRing, showBreathe, the wipe), before brightness. */
  ringPixels(now = performance.now()): Rgb[] {
    const n = G.pixels;
    const out: Rgb[] = Array.from({ length: n }, () => BLACK);
    const sh = this.showing(now);
    const shown = sh?.unit === "ring" ? this.shownRing(sh.kind, now) : null;
    if (shown) return shown;
    if (now < this.wipe.until) {
      const k = Math.floor(((G.wipeMs - (this.wipe.until - now)) * n) / G.wipeMs);
      for (let i = 0; i < Math.min(k, n); i++) out[i] = this.wipe.c;
      return out;
    }
    if (this.guitarMuted) {
      const b = 40 + 100 * (1 + Math.sin((now * 2 * Math.PI) / G.breathMs)) / 2;
      return out.map(() => G.mute.map((c) => (b * c) / 255) as Rgb);
    }
    const lit = clamp(Math.floor((this.dist * n + 63) / 127), 0, n);
    for (let i = 0; i < lit; i++) {
      const b = lit > 1 ? G.ramp[0] + ((G.ramp[1] - G.ramp[0]) * i) / (lit - 1) : 255;
      out[i] = [b, b, b];
    }
    if (this.vel > G.flashVel && lit > 0) out[lit - 1] = [255, 255, 255];
    return out;
  }

  // ---- receiver: its own sensor ------------------------------------------------------------------
  private pollLocal() {
    const now = performance.now();
    if (this.local == null) {
      this.lT = 0;
      return;
    }
    const d = this.local;
    if (this.lDist === 0) this.lDist = d;
    this.lDist += R.emaDist * (d - this.lDist);
    if (this.lT > 0) {
      const dt = (now - this.lT) / 1000;
      let v = (this.lPrev - this.lDist) / dt;
      if (Math.abs(v) < R.velDeadMms) v = 0;
      this.lVel += R.emaVel * (v - this.lVel);
    }
    this.lPrev = this.lDist;
    this.lT = now;
    const t = clamp((this.lDist - R.distMin) / (R.distMax - R.distMin), 0, 1);
    this.lDistCC = Math.round(t * 127);
    this.lVelCC = Math.round((Math.min(Math.abs(this.lVel), R.velFullMms) / R.velFullMms) * 127);
    const src = SOURCES[this.source];
    if (src === "GTR" || this.muted || this.holding) return this.changed();
    const ch = 0xb0 | (R.localCh - 1);
    if (this.lDistCC !== this.lSent[0]) {
      this.lSent[0] = this.lDistCC;
      this.emit({ bytes: [ch, R.ccDist, this.lDistCC], seq: -1, from: "local", passed: true, note: "" });
    }
    if (this.lVelCC !== this.lSent[1]) {
      this.lSent[1] = this.lVelCC;
      this.emit({ bytes: [ch, R.ccVel, this.lVelCC], seq: -1, from: "local", passed: true, note: "" });
    }
    this.changed();
  }
  setLocal(mm: number | null) {
    this.local = mm;
    if (mm == null) this.lDist = 0;
    this.changed();
  }

  // ---- pedal, MUTE, HOLD, MODE -----------------------------------------------------------------
  /** The pedal's wiper, 0..4095 ADC counts. The range is learned (pollExp). */
  setPedal(raw: number) {
    const p = this.pedal;
    p.raw = raw;
    p.ema = raw; // the firmware smooths the wiper every 5 ms; a slider needs no smoothing
    p.lo = Math.min(p.lo, p.ema);
    p.hi = Math.max(p.hi, p.ema);
    if (p.hi - p.lo < R.expMinSpan) return this.changed();
    p.live = true;
    const scaled = ((p.ema - p.lo) / (p.hi - p.lo)) * 127;
    if (p.sent >= 0 && Math.abs(scaled - p.sent) < 0.6) return this.changed();
    const v = Math.round(scaled);
    if (v === p.sent || this.holding) return this.changed();
    p.sent = v;
    p.cc = v;
    if (!this.muted) this.emit({ bytes: [0xb0 | (R.localCh - 1), R.expCc, v], seq: -1, from: "pedal", passed: true, note: "" });
    this.changed();
  }
  resetPedal() {
    this.pedal = { raw: 0, ema: -1, lo: 4095, hi: 0, live: false, cc: 0, sent: -1 };
    this.changed();
  }
  toggleMute() {
    this.muted = !this.muted;
    this.changed();
  }
  setHold(v: boolean) {
    this.holding = v;
    this.changed();
  }
  cycleSource() {
    this.source = (this.source + 1) % SOURCES.length;
    this.changed();
  }
  setSource(i: number) {
    this.source = i;
    this.changed();
  }
  linkAlive(now = performance.now()) {
    return now - this.lastRx < R.noSignalMs;
  }

  // the light legend: show one state on the 3D lights for a few seconds
  private shown: { unit: "ring" | "stick"; kind: string; until: number } | null = null;
  show(unit: "ring" | "stick", kind: string, ms = 4200) {
    this.shown = { unit, kind, until: performance.now() + ms };
    if (unit === "ring" && kind === "wipe") this.wipe = { until: performance.now() + G.wipeMs * 4, c: [200, 200, 200] };
    this.changed();
  }
  showing(now = performance.now()) {
    return this.shown && now < this.shown.until ? this.shown : null;
  }
  private shownRing(kind: string, now: number): Rgb[] | null {
    const n = G.pixels;
    if (kind === "bar" || kind === "fast") {
      const lit = 11;
      return Array.from({ length: n }, (_, i) => {
        if (i >= lit) return BLACK;
        if (kind === "fast" && i === lit - 1) return [255, 255, 255];
        const b = G.ramp[0] + ((G.ramp[1] - G.ramp[0]) * i) / (lit - 1);
        return [b, b, b];
      });
    }
    if (kind === "mute") {
      const b = 40 + 100 * (1 + Math.sin((now * 2 * Math.PI) / G.breathMs)) / 2;
      return Array.from({ length: n }, () => G.mute.map((c) => (b * c) / 255) as Rgb);
    }
    return null;
  }
  private shownStick(kind: string, now: number): Rgb[] {
    const n = R.pixels;
    const fill = (c: Rgb) => Array.from({ length: n }, () => c);
    const breathe = (ms: number, lo: number, hi: number) => lo + (hi * (1 + Math.sin((now * 2 * Math.PI) / ms))) / 2;
    if (kind === "mute") return fill(R.stick.mute as Rgb);
    if (kind === "link") { const b = breathe(R.stick.linkMs, 6, 24); return fill([0, b / 3, b]); }
    if (kind === "oled") { const b = breathe(R.stick.oledFailMs, 6, 30); return fill([b, 0, b]); }
    if (kind === "idle") { const b = breathe(R.stick.idleMs, 3, 10); return fill([b, b / 2, 0]); }
    // a hand: 5 of 8 lit, speed sweeping green to red
    const r = Math.round(127 + 127 * Math.sin(now / 500));
    return Array.from({ length: n }, (_, i) => (i < 5 ? ([r, 255 - r, 0] as Rgb) : BLACK));
  }

  /** The 8 pixels of the receiver's stick now (updateNeoPixel), before brightness. */
  stickPixels(now = performance.now()): Rgb[] {
    const n = R.pixels;
    const fill = (c: Rgb) => Array.from({ length: n }, () => c);
    const sh = this.showing(now);
    if (sh?.unit === "stick") return this.shownStick(sh.kind, now);
    if (this.muted) return fill(R.stick.mute as Rgb);
    if (this.local != null) {
      const lit = Math.floor((this.lDistCC * n) / 127);
      const r = Math.min(255, this.lVelCC * 2);
      return Array.from({ length: n }, (_, i) => (i < lit ? ([r, 255 - r, 0] as Rgb) : BLACK));
    }
    if (this.linkAlive(now)) {
      const b = 6 + (24 * (1 + Math.sin((now * 2 * Math.PI) / R.stick.linkMs))) / 2;
      return fill([0, b / 3, b]);
    }
    const b = 3 + (10 * (1 + Math.sin((now * 2 * Math.PI) / R.stick.idleMs))) / 2;
    return fill([b, b / 2, 0]);
  }
}

export const reins = new Reins();
