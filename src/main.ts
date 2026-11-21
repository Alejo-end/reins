import "@fontsource-variable/nunito";
import "./style.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./scene"; // registers <reins-scene>
import type { ReinsScene } from "./scene";
import { reins, SOURCES, type Packet } from "./reins";
import { handDiagram, fieldDiagram, gridDiagram, pedalDiagram, routesDiagram } from "./diagrams";
import FW from "./firmware.json";
import PARTS from "./parts.json";

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

const G = FW.guitar, R = FW.receiver;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = matchMedia("(min-width: 960px)");
if (reduce) document.documentElement.classList.add("reduce");
const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)];
const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const sec = (ms: number) => `${(ms / 1000).toLocaleString("en", { maximumFractionDigits: 1 })} s`;

// ---- the words that carry firmware numbers ----------------------------------------------------
const N = Math.round(Math.sqrt(R.zones));
const words: Record<string, string> = {
  "guitar-fw": `Every ${G.pollMs} ms the firmware reads the distance, smooths it and sends it as CC ${G.ccDist}: ${G.distMin} mm is 0, ${G.distMax} mm is 127. How fast the hand moves goes out as CC ${G.ccVel}. Each message goes to USB and to the radio.`,
  "link-fw": `The guitar broadcasts every message over ESP-NOW on WiFi channel ${G.channel}, in five bytes: 0x${hex(G.magic)}, a counter, then the MIDI message. Nothing connects and nothing waits for an answer. One way takes about 2 to 4 ms. The box drops anything that does not start with 0x${hex(R.magic)} and counts the gaps in the counter as lost packets. Held for ${sec(R.pairHoldMs)}, MODE pairs the box with the guitar it hears.`,
  "receiver-fw": `The box passes the guitar's messages to USB as a class compliant MIDI device, and to the 5-pin DIN socket, so a synth needs no computer. Its own sensor sees ${N} × ${N} zones ${R.hz} times a second. The nearest zone sets CC ${R.ccDist} and its speed CC ${R.ccVel}, on channel ${R.localCh}, so a host can tell the two hands apart.`,
  "pedals-fw": `Three sockets in the back wall: EXP, MIDI OUT and FOOT. A pedal on EXP sends CC ${R.expCc} on channel ${R.localCh}. It stays quiet until the pedal has moved ${Math.round((R.expMinSpan / 4095) * 100)} % of its travel, so an empty jack sends nothing. FOOT takes two footswitches on one TRS cable. The tip is MUTE, which also sends all notes off. The ring is HOLD: while it is down, the box's own CCs and the pedal keep their value. A latching switch held over ${sec(R.muteLatchMs)} toggles MUTE again when it opens, so one stomp is one toggle.`,
  "stack-fw": "The pickguard is 3.0 mm thick, printed in three plies: charcoal, orange, charcoal. The bevel, the chamfers and the REINS name cut through the top ply to the orange. Under it, in the order they go in:",
  "mode-fw": `A tap on MODE picks what goes out: both sensors, the guitar only or the box only. Each change sends all notes off on all 16 channels. The pedal passes in every mode.`,
  "inside-fw": `Two boards from JLCPCB in a printed case. The main board holds the XIAO ESP32-S3 Plus, the sensor, the screen, the knob, MODE, MUTE and the 8 LED stick. The jack board holds the three sockets and plugs in with a 7 pin JST PH cable. The list below is the order they go together in.`,
};
for (const [id, t] of Object.entries(words)) $(`#${id}`).textContent = t;

// ---- the scene ------------------------------------------------------------------------------------
const scene = $<ReinsScene>("reins-scene");
scene.addEventListener("nowebgl", () => document.documentElement.classList.add("no-webgl"));
scene.ring = (now) => reins.ringPixels(now);
scene.stick = (now) => reins.stickPixels(now);
if (import.meta.env.DEV) Object.assign(window, { reins, scene });

// ---- smooth scroll -----------------------------------------------------------------------------
if (!reduce) {
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, anchors: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

// ---- the stage: apart, together, linked -----------------------------------------------------------
const note = $("#stage-note");
note.textContent = `Radio on channel ${G.channel}.`;
let stageHand = false;
const stage = (p: number) => {
  scene.progress = p;
  scene.fieldOn = p > 0.8 ? Math.min(1, (p - 0.8) / 0.08) : 0;
  // at the end a hand comes down over the guitar; each step it takes is a packet
  const h = p > 0.86 ? 380 - Math.min(1, (p - 0.86) / 0.12) * 230 : null;
  if (h != null || stageHand) {
    stageHand = h != null;
    reins.setHand(h);
    scene.hand(h);
  }
};
if (reduce) stage(1);
else {
  ScrollTrigger.create({ trigger: "#stage", start: "top top", end: "bottom bottom", onUpdate: (st) => stage(st.progress) });
  const tl = gsap.timeline({ scrollTrigger: { trigger: "#stage", start: "top top", end: "bottom bottom", scrub: true } });
  tl.to(".hero-copy", { autoAlpha: 0, y: -24, duration: 0.07, ease: "power1.in" }, 0.03)
    .fromTo(".note-on", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.84)
    .to(".note-on", { autoAlpha: 0, duration: 0.04 }, 0.96)
    .set({}, {}, 1);
}
const bar = () => document.documentElement.classList.toggle("scrolled", scrollY > innerHeight * 0.5);
addEventListener("scroll", bar, { passive: true });
bar();

// the sections: the units move beside the words (desktop) or above them (phone)
ScrollTrigger.create({ trigger: "#features", start: "top bottom", end: "top 30%", onUpdate: (st) => (scene.shift = st.progress) });
// past the sections the scene fades for the specifications
let fade = 1;
const sceneOn = () => (scene.paused = fade === 0 || document.documentElement.classList.contains("scene-off"));
ScrollTrigger.create({
  trigger: "#details", start: "top 90%", end: "top 30%",
  onUpdate: (st) => {
    fade = Math.max(0, 1 - st.progress);
    scene.style.setProperty("--fade", String(fade));
    sceneOn();
  },
});
// the stack section takes the pickguard apart, the inside section the box
ScrollTrigger.create({ trigger: "#stack", start: "top 75%", end: "bottom 60%", onUpdate: (st) => (scene.explodeGuitar = Math.sin(Math.PI * Math.min(1, st.progress * 1.25)) ** 0.6) });
ScrollTrigger.create({ trigger: "#inside", start: "top 75%", end: "bottom 60%", onUpdate: (st) => (scene.explode = Math.sin(Math.PI * Math.min(1, st.progress * 1.25)) ** 0.6) });

let current: HTMLElement | null = null;
const sideOf = (el: HTMLElement) => (el.dataset.side === "left" ? -1 : el.dataset.side === "right" ? 1 : 0);
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      if (el === current) continue;
      current?.removeAttribute("aria-current");
      current = el;
      el.setAttribute("aria-current", "true");
      scene.view = el.dataset.view ?? "hero";
      scene.side = sideOf(el);
      // the ghost hand belongs to the guitar's sections
      const handHere = el.id === "guitar" || el.id === "link";
      scene.hand(handHere ? reins.hand : null);
      scene.fieldOn = el.id === "inside" ? 0 : 1;
      // a centred section draws its own picture: the scene steps back
      document.documentElement.classList.toggle("scene-off", el.dataset.scene === "off");
      sceneOn();
    }
  },
  { rootMargin: "-40% 0px -50% 0px" },
);
$$(".feature").forEach((el) => io.observe(el));
ScrollTrigger.create({
  trigger: "#features", start: "top 60%",
  onLeaveBack: () => {
    scene.view = "hero";
    scene.side = 0;
    current = null;
    document.documentElement.classList.remove("scene-off");
    sceneOn();
  },
});

// ---- 01 the hand over the guitar ----------------------------------------------------------------
const drawHand = handDiagram($("[data-diagram=hand]"));
const handIn = $<HTMLInputElement>("[data-hand]");
const handOut = $("[data-hand-out]");
const handRead = $("[data-hand-read]");
const setHand = () => {
  const mm = Number(handIn.value);
  handOut.textContent = `${mm} mm`;
  reins.setHand(mm);
  scene.hand(mm);
};
handIn.addEventListener("input", setHand);
handIn.addEventListener("focus", setHand);
$("#guitar").addEventListener("pointerenter", () => reins.hand == null && setHand(), { once: true });

// ---- 02 the link -------------------------------------------------------------------------------------
const field = fieldDiagram($("[data-diagram=field]"));
const packetEl = $("[data-packet]");
const FIELDS = ["magic", "counter", "status", "data 1", "data 2"];
packetEl.innerHTML = FIELDS.map((f) => `<div class="byte"><span class="b-val">--</span><span class="b-name">${f}</span></div>`).join("");
const byteVals = $$(".b-val", packetEl);
const linkRead = $("[data-link-read]");
const sourceName = { BOTH: "both", GTR: "guitar only", LOC: "box only" } as Record<string, string>;
reins.addEventListener("packet", (e) => {
  const p = (e as CustomEvent<Packet>).detail;
  if (p.from === "guitar") {
    field.packet();
    scene.pulse("guitar");
    p.bytes.forEach((b, i) => (byteVals[i].textContent = hex(b)));
    const cc = p.bytes[3], v = p.bytes[4], ch = (p.bytes[2] & 15) + 1;
    linkRead.textContent = `Control change, channel ${ch}, CC ${cc} = ${v}. Packet ${p.seq}. ${p.note}`;
  } else if (p.from === "local") {
    field.local();
    scene.pulse("local");
  }
});

// ---- 03 the box's own sensor ----------------------------------------------------------------------
const drawGrid = gridDiagram($("[data-diagram=grid]"));
const localIn = $<HTMLInputElement>("[data-local]");
const localOut = $("[data-local-out]");
const localRead = $("[data-local-read]");
localIn.addEventListener("input", () => {
  const mm = Number(localIn.value);
  const on = mm >= 30;
  localOut.textContent = on ? `${mm} mm` : "no hand";
  reins.setLocal(on ? mm : null);
});

// ---- 04 pedal, MUTE, HOLD ---------------------------------------------------------------------------
const drawPedal = pedalDiagram($("[data-diagram=pedal]"));
const pedalIn = $<HTMLInputElement>("[data-pedal]");
const pedalOut = $("[data-pedal-out]");
const pedalRead = $("[data-pedal-read]");
pedalIn.addEventListener("input", () => {
  const v = Number(pedalIn.value);
  pedalOut.textContent = v < 80 ? "heel" : v > 4015 ? "toe" : `${Math.round((v / 4095) * 100)} %`;
  reins.setPedal(v);
});
$("[data-pedal-reset]").addEventListener("click", () => {
  pedalIn.value = "0";
  pedalOut.textContent = "heel";
  reins.resetPedal();
});
const muteBtn = $<HTMLButtonElement>("[data-mute]");
muteBtn.addEventListener("click", () => reins.toggleMute());
const holdBtn = $<HTMLButtonElement>("[data-hold]");
const hold = (v: boolean) => reins.setHold(v);
holdBtn.addEventListener("pointerdown", (e) => (holdBtn.setPointerCapture(e.pointerId), hold(true)));
holdBtn.addEventListener("pointerup", () => hold(false));
holdBtn.addEventListener("pointercancel", () => hold(false));
holdBtn.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), hold(true)));
holdBtn.addEventListener("keyup", (e) => (e.key === " " || e.key === "Enter") && hold(false));

// ---- 05 sources ------------------------------------------------------------------------------------
const drawRoutes = routesDiagram($("[data-diagram=routes]"));
const seg = $("[data-sources]");
seg.innerHTML = SOURCES.map((s, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-src="${i}">${s}</button>`).join("");
$$<HTMLButtonElement>("[data-src]", seg).forEach((b) => b.addEventListener("click", () => reins.setSource(Number(b.dataset.src))));

// ---- every view follows the model ------------------------------------------------------------------
function update() {
  const now = performance.now();
  drawHand(reins.hand, reins.ringPixels(now));
  if (reins.hand != null)
    handRead.textContent = `CC ${G.ccDist} = ${reins.dist}, CC ${G.ccVel} = ${reins.vel}`;
  drawGrid(reins.local, reins.stickPixels(now));
  localRead.textContent =
    reins.local == null ? "Bring a hand over the box." : SOURCES[reins.source] === "GTR" ? "MODE is GTR: the box's sensor is off." : `CC ${R.ccDist} = ${reins.lDistCC}, CC ${R.ccVel} = ${reins.lVelCC}, channel ${R.localCh}.${reins.holding ? " HOLD keeps them." : ""}`;
  const pd = reins.pedal;
  drawPedal(pd, reins.muted, reins.holding);
  muteBtn.setAttribute("aria-pressed", String(reins.muted));
  holdBtn.setAttribute("aria-pressed", String(reins.holding));
  pedalRead.textContent = reins.muted
    ? "Muted. All notes off went out on all 16 channels."
    : !pd.live
      ? pd.hi < pd.lo ? "No pedal yet. Move it heel to toe." : "Learning the range. Keep moving."
      : `CC ${R.expCc} = ${pd.cc} on channel ${R.localCh}.${reins.holding ? " HOLD keeps it." : ""}`;
  const src = SOURCES[reins.source];
  $$("[data-src]", seg).forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.src) === reins.source)));
  drawRoutes({ guitar: !reins.muted && src !== "LOC", local: !reins.muted && src !== "GTR", pedal: !reins.muted });
  if (!linkRead.textContent?.trim()) linkRead.textContent = `MODE: ${sourceName[src]}. Move the hand in 01 to send.`;
}
reins.addEventListener("change", update);
// the lights breathe on their own: the drawings follow them while the page shows them
const tick = () => {
  update();
  setTimeout(() => requestAnimationFrame(tick), 60);
};
tick();

// ---- 06 lights ----------------------------------------------------------------------------------------
type Row = { kind: string; swatch: string; text: string };
const css = (c: number[]) => `rgb(${c.join(" ")})`;
const LEGEND: Record<"ring" | "stick", Row[]> = {
  ring: [
    { kind: "bar", swatch: "linear-gradient(90deg, rgb(76 76 76), rgb(255 255 255))", text: `White bar, brighter toward its end. The hand's height in ${G.pixels} steps.` },
    { kind: "fast", swatch: "rgb(255 255 255)", text: `The last pixel full white. A fast hand, CC ${G.ccVel} over ${G.flashVel}.` },
    { kind: "mute", swatch: css(G.mute), text: `Red, breathing every ${sec(G.breathMs)}. Muted.` },
    { kind: "wipe", swatch: "rgb(200 200 200)", text: `One sweep round the ring in ${G.wipeMs} ms. Mute pressed or the mode changed.` },
  ],
  stick: [
    { kind: "mute", swatch: css(R.stick.mute.map((x) => x * 4)), text: "Red. Muted." },
    { kind: "hand", swatch: "linear-gradient(90deg, rgb(0 255 0), rgb(255 0 0))", text: "Green to red. A hand over the box: its height sets the length, its speed the colour." },
    { kind: "link", swatch: "rgb(0 80 240)", text: `Blue, pulsing. Packets from the guitar in the last ${sec(R.noSignalMs)}.` },
    { kind: "idle", swatch: "rgb(230 115 0)", text: `Amber, breathing every ${sec(R.stick.idleMs)}. Nothing to show.` },
    { kind: "oled", swatch: "rgb(190 0 190)", text: "Purple, breathing. The screen did not start." },
  ],
};
for (const unit of ["ring", "stick"] as const) {
  const ul = $(`[data-legend=${unit}]`);
  for (const r of LEGEND[unit]) {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button"><span class="sw" style="background:${r.swatch}"></span><span>${r.text}</span></button>`;
    li.querySelector("button")!.addEventListener("click", () => reins.show(unit, r.kind));
    ul.appendChild(li);
  }
}

// ---- 07 inside: the parts of the box, in the order they go together ---------------------------
type P = { name: string; unit: string; layer: string; order?: number; min: number[]; max: number[] };
const parts = PARTS as P[];
const box = parts.filter((p) => p.unit === "receiver" && !/_LED_/.test(p.name));
const WORDS: Record<string, string> = {
  Lid: "Lid", Bezel_ToF: "Sensor bezel, a quarter turn from the top", Tof_bezel: "Sensor bezel", Insert_M3: "M3 heat-set inserts",
  LightBar: "Light bar", Light_bar: "Light bar", LightBaffle: "Light baffle, one cell per LED", Button_MUTE: "MUTE cap", Button_MODE: "MODE cap",
  Board: "Main board", Jack: "Jack board: the DIN socket, EXP and FOOT", Tray: "Tray", Screw_M3x12: "M3 × 12 screws",
  Screw_M3x8: "M3 × 8 screws", Nut_Jack: "Nuts for the two jacks", Knob: "Knob", Foot: "Feet",
};
let steps: string[];
if (box.some((p) => p.order != null)) {
  // the second case says the order of the real build
  steps = [...box].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => WORDS[p.name.slice(2)] ?? p.name.slice(2).replace(/_/g, " "));
} else {
  const LAYER_WORDS: Record<string, string> = {
    base: "Tray", jack: "Jack board: the DIN socket, EXP and FOOT, and the jack nuts", board: "Main board",
    caps: "MODE and MUTE caps", lid: "Lid with its heat-set inserts", top: "Sensor bezel, light bar and knob", screws: "M3 screws, from below",
  };
  steps = ["base", "jack", "board", "caps", "lid", "top", "screws"].filter((l) => box.some((p) => p.layer === l)).map((l) => LAYER_WORDS[l]);
}
$("[data-layers]").innerHTML = steps.map((t) => `<li>${t}</li>`).join("");

// ---- 03 the pickguard stack, in the order of the build (reins-guitar/pickguard/README.md) ----------
const G_WORDS: Record<string, string> = {
  ButtonCap: "Mute cap, held from below the plate", ControlFrame: "Frame: screen bezel and XIAO hood in one part",
  Board: "Guitar board, four M2 screws from below into the frame", Encoder_PEC12R: "Knob encoder", Button_B3SN: "Mute button",
  Knob: "Knob, pressed onto the shaft", Switch_EG1201: "Battery switch", Diffuser: "Diffuser over the ring",
  Ring: "LED ring board, 16 LEDs", Pod: "Pod: it holds the ring and the sensor", ToF_Board: "Sensor board, VL53L1X",
  LiPo: "LiPo cell", BatteryCradle: "Battery sleeve, on the pod screws", Toggle: "The stock pickup selector",
  Tof_board: "Sensor board, screwed to the pod", Button_cap: "Mute cap, from below", Bezel: "Screen bezel, four M2 screws",
};
const gParts = parts.filter((p) => p.unit === "guitar" && !/_LED_|Ply|Tof_sensor|Pickups/.test(p.name));
const gOrder = gParts.some((p) => p.order != null)
  ? [...gParts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => p.name.slice(2))
  : ["Diffuser", "Ring", "Pod", "Tof_board", "Button_cap", "Board", "Bezel", "Knob"].filter((n) => gParts.some((p) => p.name === `G_${n}`));
$("[data-stack]").innerHTML = gOrder.map((n) => `<li>${G_WORDS[n] ?? n.replace(/_/g, " ")}</li>`).join("");

// ---- specifications: sizes from the model, numbers from the firmware -------------------------------
const size = (pred: (p: P) => boolean) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts.filter(pred)) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p.min[k])), (hi[k] = Math.max(hi[k], p.max[k]));
  return hi.map((h, k) => h - lo[k]);
};
const mm = (x: number) => x.toFixed(1);
const shell = size((p) => p.unit === "receiver" && /^R_(Tray|Lid)$/.test(p.name));
const all = size((p) => p.unit === "receiver" && !/_LED_|Screw|Nut|Foot/.test(p.name));
const accent = parts.some((p) => p.name === "R_Lid_accent");
const guard = size((p) => p.unit === "guitar" && /Ply/.test(p.name));
const spec: [string, string][] = [
  ["Guitar side", `A printed pickguard for a Squier Mustang, ${mm(guard[0])} × ${mm(guard[2])} mm, 3.0 mm thick in three plies: charcoal, orange, charcoal. Under it a board with a XIAO ESP32-S3, an SSD1306 screen, a PEC12R knob and a mute button.`],
  ["Guitar sensor", `VL53L1X time of flight sensor under a ring of ${G.pixels} WS2812B LEDs on its own 0.8 mm board, 44.4 mm across. Range ${G.distMin} to ${G.distMax} mm by default, set on the screen.`],
  ["Guitar power", `A LiPo cell, charged over USB-C. The screen shows LOW BAT under ${(G.batLowMv / 1000).toFixed(2)} V.`],
  ["Radio", `ESP-NOW on WiFi channel ${G.channel}. Five byte packets, broadcast. No Bluetooth.`],
  ["Box", `XIAO ESP32-S3 Plus, VL53L5CX sensor with ${N} × ${N} zones, SSD1306 screen, PEC12R knob, MODE and MUTE, ${R.pixels} LED stick.`],
  ["MIDI out", "USB, class compliant. 5-pin DIN (Cliff FM6725) with the same messages."],
  ["Inputs", `EXP and FOOT, 6.35 mm stereo jacks (Cliff CL1232A). EXP sends CC ${R.expCc}. FOOT: tip MUTE, ring HOLD.`],
  ["Boards", "Main board 87.7 × 66.3 mm, jack board 79.0 × 26.5 mm, guitar board and LED ring. Two layers, assembled by JLCPCB."],
  ["Case", `Printed tray and lid, ${mm(shell[0])} × ${mm(shell[2])} × ${mm(shell[1])} mm, ${mm(all[1])} mm with the knob. Charcoal, ${accent ? "with orange in the engraving" : "with an orange knob and orange caps"}.`],
  ["Firmware", `Guitar ${G.file}, box ${R.file}. A fuller box firmware, tof_midi_v6, adds a note router, presets and a settings page over WiFi. It builds, but I have not tested it on the board.`],
];
$("[data-spec]").innerHTML = spec.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join("");

desktop.addEventListener("change", () => ScrollTrigger.refresh());
