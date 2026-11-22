// <reins-scene>: both REINS units in one three.js scene, driven by a few numbers.
//
//   scene.progress = 0..1   0 apart; the guitar unit goes together, then the receiver
//   scene.view = name       turns and frames the scene for one section (VIEWS below)
//   scene.side = -1, 0, 1   where the words are: the units keep the other half (desktop) or the top (phone)
//   scene.explode = 0..1    takes the receiver apart again, for the section about its inside
//   scene.explodeGuitar     the same for the pickguard
//
// How the parts move, together and apart, is src/motion.ts with the plan of tools/explode.mjs
// (parts.json): the real build, in its order, each part along its own way in, never through
// another part.
//   scene.hand(mm | null)   the ghost hand over the guitar's sensor
//   scene.pulse(kind)       a pulse in the field: a packet from the guitar, or the receiver's own sensor
//   scene.ring / stick      the colour of each pixel now (the firmware model in reins.ts)
//
// The model (public/model/reins.glb, tools/assemble.mjs) holds both units, each in its own frame
// in metres with y up: the guitar unit in the pickguard frame, the receiver in the case frame
// (x = KiCad x, z = KiCad y). Here they stand on one table, in mm. The receiver's lid art says
// where the guitar is: its outer rings come from the back right corner (lid_art.py GUITAR), so
// the guitar's sensor sits on the line from the receiver's sensor through that point.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import PARTS from "./parts.json";
import type { Rgb } from "./reins";
import { Hand, Field, GuitarGhost, type GuitarShape } from "./ghosts";
import GUITAR from "./guitar.json";
import POD_AT from "./pod.json";
import { makePlan, poses, STAGE, type Plan, type Pose, type Step } from "./motion";

type Unit = "guitar" | "receiver";
type PartInfo = { name: string; unit: string; layer: string; colour: string | null; order?: number; min: number[]; max: number[] } & Partial<Omit<Step, "name">>;
const INFO = new Map((PARTS as PartInfo[]).map((p) => [p.name, p]));

// the receiver's sensor and the lid art's guitar point, KiCad mm (build_case.py, lid_art.py)
const BOX_TOF = new THREE.Vector2(92.15, 104.54);
const LID_GUITAR = new THREE.Vector2(168.0, 18.0);
// the guitar's sensor in the pickguard frame (build_pickguard.py POD_C), on the body top
const POD = new THREE.Vector2(POD_AT.x, POD_AT.y); // the ring's centre, written with the model
const SENSOR_Y = -7.2; // the sensor window, mm under the body top (Z_TOF_TOP + 1, pod.py)
const LINK = 430; // mm from sensor to sensor on the table: the guitar's tail clears the box
const GUITAR_LIFT = 16; // the guitar's body top over the table
const GUITAR_YAW = 0.85; // radians: the neck points away from the receiver

// the plan of each unit (tools/explode.mjs); a part without one stays home
const PLANS = Object.fromEntries(
  (["guitar", "receiver"] as Unit[]).map((u) => [
    u,
    makePlan([...INFO.values()].filter((p) => p.unit === u && p.away).map((p) => ({ ...(p as Step), name: p.name }))),
  ]),
) as Record<Unit, Plan>;

// the transmitter's electronics: the guitar board, the ring, the sensor, the knob, the cap, the pixels
const ELECTRONICS = /^G_(Board|Ring|LED_|OLED)|^G_.*(tof|knob|button|sensor|encoder|switch)/i;
export type View = { units: Unit[]; tilt: number; yaw: number; zoom: number; lift?: number; focus?: RegExp; only?: RegExp; ghost?: number };
// tilt: pi/2 looks straight down; yaw 0: the receiver's front faces you
export const VIEWS: Record<string, View> = {
  hero: { units: ["guitar", "receiver"], tilt: 0.62, yaw: -0.42, zoom: 1 },
  stage: { units: ["guitar", "receiver"], tilt: 0.78, yaw: -0.3, zoom: 1.05 },
  guitar: { units: ["guitar"], tilt: 0.72, yaw: -1.25, zoom: 1.12, lift: 40 },
  link: { units: ["guitar", "receiver"], tilt: 1.22, yaw: -0.72, zoom: 1.1 },
  receiver: { units: ["receiver"], tilt: 0.98, yaw: -0.18, zoom: 1.1 },
  back: { units: ["receiver"], tilt: 0.36, yaw: Math.PI - 0.5, zoom: 1.2 },
  mode: { units: ["receiver"], tilt: 1.25, yaw: 0.2, zoom: 1.0 },
  lights: { units: ["guitar", "receiver"], tilt: 1.0, yaw: -0.55, zoom: 0.95 },
  inside: { units: ["receiver"], tilt: 0.5, yaw: -0.55, zoom: 0.95 },
  // the guitar board up close: the screen, the knob, the button and the XIAO's USB-C on top,
  // inside the faint outline of the Mustang it sits in
  board: { units: ["guitar"], tilt: 0.72, yaw: -2.3, zoom: 1.0, focus: ELECTRONICS, only: ELECTRONICS, ghost: 0.6 },
  // low, from the treble side: the layers under the plate show between the plate and the table
  stack: { units: ["guitar"], tilt: 0.22, yaw: -0.8, zoom: 1.4 },
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _b = new THREE.Box3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

type Part = {
  obj: THREE.Object3D;
  name: string;
  unit: Unit;
  layer: string;
  home: THREE.Vector3;
  box: THREE.Box3; // at home, unit frame, mm
};

export class ReinsScene extends HTMLElement {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(24, 1, 5, 8000);
  private pivot = new THREE.Group();
  private world = new THREE.Group();
  private units: Record<Unit, THREE.Group> = { guitar: new THREE.Group(), receiver: new THREE.Group() };
  private parts: Part[] = [];
  private pose: Record<Unit, Map<string, Pose>> = { guitar: new Map(), receiver: new Map() };
  private byName = new Map<string, Part>();
  private ledMats: Record<"G" | "R", THREE.MeshBasicMaterial[]> = { G: [], R: [] };
  private glowMats: Record<"G" | "R", THREE.MeshBasicMaterial[]> = { G: [], R: [] };
  private partMats = new Map<string, { m: THREE.Material; opacity: number; transparent: boolean }[]>();
  private partAlpha = new Map<string, number>();
  private unitAlpha: Record<Unit, number> = { guitar: 1, receiver: 1 };
  private diffusers: Partial<Record<"G" | "R", THREE.MeshPhysicalMaterial>> = {};
  private handG = new Hand();
  // the receiver's VL53L5CX sees about 45 degrees across: a wider cone
  private handR = new Hand(22);
  private guitarGhost = new GuitarGhost(GUITAR as GuitarShape);
  private _explodeG = 0;
  private explodeGNow = 0;
  private field!: Field;
  private _progress = 0;
  private _explode = 0;
  private explodeNow = 0;
  private sideTarget = 0;
  private sideNow = 0;
  private shiftTarget = 0;
  private shiftNow = 0;
  private viewTarget: View = VIEWS.hero;
  private v = { tilt: VIEWS.hero.tilt, yaw: VIEWS.hero.yaw, zoom: 1, lift: 0 };
  private fit = { c: new THREE.Vector3(), r: 300, ready: false };
  private pointer = new THREE.Vector2();
  private pointerNow = new THREE.Vector2();
  private visible = true;
  private t0 = performance.now();
  private lastFrame = performance.now();
  private portrait = false;
  paused = false;
  ring: ((now: number) => Rgb[]) | null = null;
  stick: ((now: number) => Rgb[]) | null = null;
  ready: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    super();
    this.ready = new Promise((r) => (this.resolveReady = r));
  }

  set progress(v: number) {
    this._progress = clamp(v);
  }
  get progress() {
    return this._progress;
  }
  set view(name: string) {
    this.viewTarget = VIEWS[name] ?? VIEWS.hero;
  }
  /** Where the words are: -1 left, 1 right, 0 none (centred or above). */
  set side(s: number) {
    this.sideTarget = s;
  }
  /** 0 while the stage runs (the units centred), 1 in the sections. */
  set shift(s: number) {
    this.shiftTarget = clamp(s);
  }
  set explode(v: number) {
    this._explode = clamp(v);
  }
  /** Takes the pickguard stack apart, for the section about it. */
  set explodeGuitar(v: number) {
    this._explodeG = clamp(v);
  }
  hand(mm: number | null) {
    if (mm == null) this.handG.opacity = 0;
    else {
      this.handG.opacity = 1;
      this.handG.height = mm;
    }
  }
  /** The ghost hand over the receiver's sensor, mm, or null. Drawn up to 420 mm so the box stays in frame. */
  handBox(mm: number | null) {
    if (mm == null) this.handR.opacity = 0;
    else {
      this.handR.opacity = 1;
      this.handR.height = Math.min(mm, 420);
    }
  }
  pulse(kind: "guitar" | "local") {
    if (!this.field) return;
    if (kind === "guitar") this.field.packet();
    else this.field.local();
  }
  set fieldOn(v: number) {
    if (this.field) this.field.opacity = v;
  }

  connectedCallback() {
    if (this.renderer) return;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    this.appendChild(canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      this.fail();
      return;
    }
    this.renderer = renderer;
    const touch = matchMedia("(pointer: coarse)").matches;
    renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.75 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    const key = new THREE.DirectionalLight(0xfff3e6, 2.4);
    key.position.set(-300, 520, 420);
    const rim = new THREE.DirectionalLight(0xffc8a0, 1.3);
    rim.position.set(480, 140, -520);
    const fill = new THREE.HemisphereLight(0xb4b0aa, 0x0a0a0b, 0.45);
    this.scene.add(key, rim, fill, this.pivot);
    this.pivot.add(this.world);
    this.world.add(this.units.guitar, this.units.receiver);

    new ResizeObserver(() => this.resize()).observe(this);
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(this);
    addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      this.pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    });
    this.load().catch((err) => {
      console.error(err);
      this.fail();
    });
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.visible && !this.paused) this.frame();
    };
    requestAnimationFrame(loop);
  }

  private fail() {
    this.classList.add("no-webgl");
    this.dispatchEvent(new Event("nowebgl"));
  }

  private async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}model/reins.glb`);
    const root = gltf.scene;

    // the two units on the table: the receiver's tray on it, centred at the origin; the guitar
    // with its sensor on the lid art's line
    const R = this.units.receiver, G = this.units.guitar;
    const tray = INFO.get("R_Tray")!;
    R.position.set(-(tray.min[0] + tray.max[0]) / 2, -tray.min[1], -(tray.min[2] + tray.max[2]) / 2);
    const tof = new THREE.Vector2(BOX_TOF.x + R.position.x, BOX_TOF.y + R.position.z);
    const dir = LID_GUITAR.clone().sub(BOX_TOF).normalize();
    const pod = tof.clone().addScaledVector(dir, LINK);
    G.rotation.y = GUITAR_YAW;
    G.position.set(0, GUITAR_LIFT, 0);
    G.updateMatrixWorld(true);
    const podNow = new THREE.Vector3(POD.x, 0, -POD.y).applyMatrix4(G.matrixWorld);
    G.position.x += pod.x - podNow.x;
    G.position.z += pod.y - podNow.z;
    this.handG.group.position.set(POD.x, SENSOR_Y, -POD.y);
    G.add(this.handG.group, this.guitarGhost.group);
    // the box's hand: over its sensor window, under the bezel
    const bezel = INFO.get("R_Bezel_ToF");
    this.handR.group.position.set(BOX_TOF.x, bezel ? bezel.min[1] : 17.8, BOX_TOF.y);
    this.handR.group.rotation.y = 0; // the forearm away from the words
    R.add(this.handR.group);
    this.field = new Field(new THREE.Vector2(pod.x, pod.y), tof);
    this.world.add(this.field.mesh);

    // each part hangs from a pivot at its own centre (assemble.mjs put the node origins there)
    for (const obj of [...root.children]) {
      const info = INFO.get(obj.name);
      if (!info) continue;
      const unit = info.unit as Unit;
      this.material(obj, info);
      // the node keeps its own transform (quantizing gave it one); a holder scales metres to mm
      const box = new THREE.Box3(new THREE.Vector3(...info.min), new THREE.Vector3(...info.max));
      const pivot = new THREE.Group();
      pivot.name = obj.name;
      box.getCenter(pivot.position);
      const holder = new THREE.Group();
      holder.scale.setScalar(1000);
      holder.position.copy(pivot.position).negate();
      holder.add(obj);
      pivot.add(holder);
      this.units[unit].add(pivot);
      const p: Part = { obj: pivot, name: obj.name, unit, layer: info.layer, home: pivot.position.clone(), box };
      this.byName.set(p.name, p);
      this.parts.push(p);
    }
    this.addGlows();
    try {
      await this.renderer!.compileAsync(this.scene, this.camera);
    } catch {
      /* a frame compiles anything left */
    }
    this.frame();
    requestAnimationFrame(() => this.classList.add("ready"));
    this.resolveReady();
  }

  private material(obj: THREE.Object3D, info: PartInfo) {
    const name = info.name;
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry as THREE.BufferGeometry;
      if (!g.getAttribute("normal")) mesh.geometry = toCreasedNormals(g, THREE.MathUtils.degToRad(/Board|Ring|Jack/.test(name) ? 40 : 32));
      const old = mesh.material as THREE.MeshStandardMaterial;
      if (/_LED_/.test(name)) {
        const m = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
        this.ledMats[name[0] as "G" | "R"][Number(name.split("_").pop())] = m;
        mesh.material = m;
        mesh.renderOrder = 2;
      } else if (info.colour) {
        const c = new THREE.Color(info.colour);
        if (/Diffuser|Light_bar/.test(name)) {
          const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.85, transparent: true, opacity: 0.62, emissive: new THREE.Color(0) });
          this.diffusers[name[0] as "G" | "R"] = m;
          mesh.material = m;
          mesh.renderOrder = 1;
        } else if (/Screw/.test(name)) {
          mesh.material = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.38, metalness: 0.85, clearcoat: 0.2 });
        } else if (/Insert|Nut/.test(name)) {
          mesh.material = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.4, metalness: /Insert/.test(name) ? 0.9 : 0 });
        } else {
          // printed PLA: matte, a soft sheen at grazing angles
          mesh.material = new THREE.MeshPhysicalMaterial({
            color: c, roughness: 0.72, metalness: 0, sheen: 0.4, sheenRoughness: 0.8,
            sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.25),
          });
        }
      } else if (old && "envMapIntensity" in old) {
        // the boards share materials across units in the file: each mesh gets its own
        const m = old.clone();
        m.envMapIntensity = 0.9;
        mesh.material = m;
      }
      const m = mesh.material as THREE.Material;
      if (!/_LED_/.test(name)) {
        if (!this.partMats.has(name)) this.partMats.set(name, []);
        this.partMats.get(name)!.push({ m, opacity: m.opacity, transparent: m.transparent });
      }
    });
  }

  // a soft halo over each pixel, so a lit LED reads through its diffuser from a distance
  private addGlows() {
    const g = document.createElement("canvas");
    g.width = g.height = 128;
    const c = g.getContext("2d")!;
    const grad = c.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.3)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = grad;
    c.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(g);
    for (const u of ["G", "R"] as const) {
      const n = u === "G" ? 16 : 8;
      for (let i = 0; i < n; i++) {
        const led = this.byName.get(`${u}_LED_${i}`);
        if (!led) continue;
        const m = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        this.glowMats[u][i] = m;
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(u === "G" ? 15 : 13, u === "G" ? 15 : 13), m);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = 0.4;
        plane.renderOrder = 3;
        led.obj.add(plane);
      }
    }
  }

  private resize() {
    if (!this.renderer) return;
    const w = this.clientWidth || innerWidth;
    const h = this.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = w / h < 0.9;
    this.camera.updateProjectionMatrix();
    this.frame();
  }

  private paint(u: "G" | "R", pixels: Rgb[] | null, scale: number) {
    const f = (x: number) => Math.pow(clamp(x / 255), 0.5);
    let sum = 0;
    const avg = [0, 0, 0];
    (pixels ?? []).forEach((c, i) => {
      const m = this.ledMats[u][i], g = this.glowMats[u][i];
      const k = [f(c[0] * scale), f(c[1] * scale), f(c[2] * scale)];
      if (m) m.color.setRGB(0.06 + k[0] * 1.3, 0.06 + k[1] * 1.3, 0.06 + k[2] * 1.3);
      if (g) g.color.setRGB(k[0] * 0.75, k[1] * 0.75, k[2] * 0.75);
      for (let j = 0; j < 3; j++) avg[j] += k[j];
      sum++;
    });
    return sum ? avg.map((x) => x / sum) : avg;
  }

  private frame() {
    if (!this.renderer) return;
    const now = performance.now();
    const t = (now - this.t0) / 1000;
    // easing by time, not by frame: a slow machine gets there as fast as a quick one
    const dt = Math.min(0.25, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const p = this._progress;
    const v = this.v, tv = this.viewTarget;
    const ease = (a: number, b: number, k = 0.07) => a + (b - a) * (1 - Math.pow(1 - k, dt * 60));
    v.tilt = ease(v.tilt, tv.tilt);
    v.yaw = ease(v.yaw, tv.yaw);
    v.zoom = ease(v.zoom, tv.zoom);
    v.lift = ease(v.lift, tv.lift ?? 0);
    this.sideNow = ease(this.sideNow, this.sideTarget, 0.08);
    this.shiftNow = ease(this.shiftNow, this.shiftTarget, 0.08);
    this.explodeNow = ease(this.explodeNow, this._explode, 0.12);
    this.explodeGNow = ease(this.explodeGNow, this._explodeG, 0.12);

    // parts: home in the order of the build during the stage; apart again with explode
    const boxes: Record<Unit, THREE.Box3> = { guitar: new THREE.Box3(), receiver: new THREE.Box3() };
    poses(PLANS.guitar, span(p, ...STAGE.guitar), easeInOut(this.explodeGNow), this.pose.guitar);
    poses(PLANS.receiver, span(p, ...STAGE.receiver), easeInOut(this.explodeNow), this.pose.receiver);
    for (const part of this.parts) {
      const at = this.pose[part.unit].get(part.name);
      part.obj.position.copy(part.home);
      if (at) part.obj.position.add(_v.set(at.x, at.y, at.z));
      part.obj.quaternion.setFromAxisAngle(Y, at?.turn ?? 0);
      if (!/_LED_/.test(part.name) && (!tv.focus || tv.focus.test(part.name))) {
        _b.copy(part.box).translate(_v.subVectors(part.obj.position, part.home));
        boxes[part.unit].union(_b);
      }
    }

    // the ghost hand: its top joins the guitar's box so a view keeps it in frame
    const handMoving = this.handG.update(dt);
    if (this.handG.opacity > 0) {
      const top = SENSOR_Y + this.handG.top;
      boxes.guitar.expandByPoint(_v.set(POD.x - 60, top, -POD.y)).expandByPoint(_v.set(POD.x + 60, top, -POD.y));
    }
    this.handR.update(dt);
    if (this.handR.opacity > 0) {
      const y = (INFO.get("R_Bezel_ToF")?.min[1] ?? 17.8) + this.handR.top;
      boxes.receiver.expandByPoint(_v.set(BOX_TOF.x - 60, y, BOX_TOF.y)).expandByPoint(_v.set(BOX_TOF.x + 60, y, BOX_TOF.y));
    }
    const fieldMoving = this.field?.update(dt) ?? false;
    // the guitar shows once the pickguard is together, and steps back while it is apart
    const gAsm = span(p, STAGE.guitar[0] + 0.25, STAGE.guitar[1] + 0.05);
    this.guitarGhost.opacity = gAsm * (1 - this.explodeGNow) * this.unitAlpha.guitar * (tv.only ? tv.ghost ?? 0 : 1);
    this.guitarGhost.update(dt);

    // what the view frames, in world mm
    const frameBox = new THREE.Box3();
    for (const u of tv.units) {
      this.units[u].updateMatrixWorld(true);
      if (!boxes[u].isEmpty()) frameBox.union(_b.copy(boxes[u]).applyMatrix4(this.units[u].matrix));
    }
    const c = frameBox.getCenter(new THREE.Vector3());
    const r = frameBox.getSize(new THREE.Vector3()).length() / 2;
    if (!this.fit.ready && this.parts.length) {
      this.fit.c.copy(c);
      this.fit.r = r;
      this.fit.ready = true;
    }
    this.fit.c.lerp(c, 1 - Math.pow(0.93, dt * 60));
    this.fit.r = ease(this.fit.r, r);

    // orientation, a slow drift and the pointer
    this.pointerNow.lerp(this.pointer, 1 - Math.pow(0.95, dt * 60));
    const idle = 1 - span(p, 0, 0.25);
    const drift = _q.setFromEuler(_e.set(Math.sin(t * 0.3) * 0.03 * idle + this.pointerNow.y * 0.04, Math.sin(t * 0.2) * 0.08 * idle + this.pointerNow.x * 0.06, 0));
    this.pivot.quaternion.setFromAxisAngle(X, v.tilt).multiply(new THREE.Quaternion().setFromAxisAngle(Y, v.yaw)).premultiply(drift);
    this.world.position.set(-this.fit.c.x, -this.fit.c.y - v.lift, -this.fit.c.z);

    // camera: fit the framed box, then come in by the view's zoom
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const s = this.shiftNow * Math.abs(this.sideNow);
    const fitAspect = this.camera.aspect * (this.portrait ? 1 : 1 - 0.48 * s);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * fitAspect);
    const room = this.portrait ? 1.04 : 1.12;
    const zoom = 1 + (v.zoom - 1) * this.shiftNow * (this.portrait ? 0.6 : 1);
    const portraitRoom = this.portrait ? 1 + 0.75 * this.shiftNow : 1; // a phone keeps the top part of the screen for the units
    const heroRoom = 1 + 0.4 * (1 - easeInOut(span(p, 0.02, 0.12))) * (1 - this.shiftNow); // the hero leaves the lower half to the words
    const dist = ((this.fit.r * room * portraitRoom * heroRoom) / Math.sin(Math.min(vFov, hFov) / 2)) / zoom;
    this.camera.position.set(0, 0, dist);
    this.camera.near = Math.max(5, dist - this.fit.r * 3);
    this.camera.far = dist + this.fit.r * 4 + 800;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    // room for the words: beside them on a desktop, above them on a phone
    const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
    const offX = this.portrait ? 0 : this.sideNow * w * 0.25 * this.shiftNow;
    // the hero: the units above the words, until the words have gone
    const hero = (1 - easeInOut(span(p, 0.02, 0.12))) * (1 - this.shiftNow);
    const offY = (this.portrait ? h * 0.25 * this.shiftNow : 0) + h * 0.24 * hero;
    if (Math.abs(offX) > 0.5 || Math.abs(offY) > 0.5) this.camera.setViewOffset(w, h, offX, offY, w, h);
    else this.camera.clearViewOffset();

    // a view of one unit fades the other; a view with `only` fades the rest of its unit too
    for (const u of ["guitar", "receiver"] as Unit[]) {
      const want = tv.units.includes(u) ? 1 : 0;
      const a0 = this.unitAlpha[u];
      this.unitAlpha[u] = Math.abs(want - a0) < 0.004 ? want : ease(a0, want, 0.09);
      this.units[u].visible = this.unitAlpha[u] > 0.01;
    }
    for (const part of this.parts) {
      const want = (tv.units.includes(part.unit) ? 1 : 0) * (!tv.only || tv.only.test(part.name) ? 1 : 0);
      const a0 = this.partAlpha.get(part.name) ?? 1;
      const a = Math.abs(want - a0) < 0.004 ? want : ease(a0, want, 0.09);
      if (a === a0) continue;
      this.partAlpha.set(part.name, a);
      part.obj.visible = a > 0.01;
      for (const e of this.partMats.get(part.name) ?? []) {
        e.m.opacity = e.opacity * a;
        const tr = e.transparent || a < 1;
        if (e.m.transparent !== tr) (e.m.transparent = tr), (e.m.needsUpdate = true);
      }
    }

    // the lights: the firmware's colours, at its brightness, lifted the way the eye reads a dim LED
    const ga = this.paint("G", this.ring ? this.ring(now) : null, 1);
    const ra = this.paint("R", this.stick ? this.stick(now) : null, 1);
    this.diffusers.G?.emissive.setRGB(ga[0] * 0.3, ga[1] * 0.3, ga[2] * 0.3);
    this.diffusers.R?.emissive.setRGB(ra[0] * 0.3, ra[1] * 0.3, ra[2] * 0.3);
    void handMoving;
    void fieldMoving;
    this.renderer.render(this.scene, this.camera);
  }
}

customElements.define("reins-scene", ReinsScene);
