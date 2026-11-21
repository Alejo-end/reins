// What the page adds to the CAD: the hand over the guitar's sensor and its light cone, drawn
// as light like H2H's ghost cables, and the field on the table under both units: the wave
// pattern of the receiver lid (heat/case/lid_art.py), rings around the guitar's sensor and
// rings around the receiver's sensor that meet on the line halfway between them. A packet is
// a pulse that runs out through the guitar's rings and in through the receiver's; the
// receiver's own sensor sends a pulse out through its rings.
import * as THREE from "three";
import { handGeometry } from "./hand";

const ORANGE = new THREE.Color(0xf26b14);
const PALE = new THREE.Color(0xf4f2ec);

const ghostVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vH = position.y;
    gl_Position = projectionMatrix * mv;
  }
`;
const ghostFrag = /* glsl */ `
  uniform vec3 uRim;
  uniform float uOpacity;
  uniform float uFade; // 1 on the cone: it fades toward the hand
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(f, 2.4);
    float a = uOpacity * mix(1.0, 0.35 + 0.65 * (1.0 - vH), uFade);
    vec3 c = uRim * (0.04 + rim * 0.7) * a;
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;
function ghost(fade: boolean, rim = PALE.clone().lerp(ORANGE, 0.25)) {
  return new THREE.ShaderMaterial({
    vertexShader: ghostVert,
    fragmentShader: ghostFrag,
    uniforms: { uRim: { value: rim }, uOpacity: { value: 0 }, uFade: { value: fade ? 1 : 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
  });
}

// the hand: a soft fresnel edge and a faint body, drawn only where the hand's own front surface
// is (a depth pass first), so the bones inside never show and the gaps between the fingers
// read as lines
const handVert = /* glsl */ `
  attribute float aFade;
  varying vec3 vN;
  varying vec3 vV;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vFade = aFade;
    gl_Position = projectionMatrix * mv;
  }
`;
const handFrag = /* glsl */ `
  uniform vec3 uRim;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  varying float vFade;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float edge = pow(f, 2.2) * 1.0 + pow(f, 1.2) * 0.12;
    float a = uOpacity * vFade;
    vec3 c = uRim * (0.06 + edge) * a;
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;

export class Hand {
  readonly group = new THREE.Group();
  private hand = new THREE.Group();
  private cone: THREE.Mesh;
  private handMat = new THREE.ShaderMaterial({
    vertexShader: handVert,
    fragmentShader: handFrag,
    uniforms: { uRim: { value: PALE.clone().lerp(ORANGE, 0.18) }, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
  });
  private coneMat = ghost(true, ORANGE.clone().lerp(PALE, 0.2));
  private heightNow = 200;
  height = 200; // mm above the sensor window
  opacity = 0;
  private opNow = 0;
  constructor(private halfAngle = 14) {
    const g = handGeometry();
    const depth = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true }));
    depth.renderOrder = 4;
    const skin = new THREE.Mesh(g, this.handMat);
    skin.renderOrder = 5;
    this.hand.add(depth, skin);
    this.hand.rotation.y = -Math.PI / 2; // the fingers toward the neck
    this.hand.rotation.z = 0.08; // a little roll, the way a hand hangs over the strings
    const cg = new THREE.CylinderGeometry(1, 0.08, 1, 48, 1, true);
    cg.translate(0, 0.5, 0);
    // radius 1 at the top (y = 1), a point at the sensor
    this.cone = new THREE.Mesh(cg, this.coneMat);
    this.cone.renderOrder = 2;
    this.group.add(this.hand, this.cone);
    this.group.visible = false;
  }
  /** True while it still moves. */
  update(dt = 1 / 60): boolean {
    const k = (x: number) => 1 - Math.pow(1 - x, dt * 60);
    const d = this.height - this.heightNow;
    this.heightNow += d * k(0.18);
    const o = this.opacity - this.opNow;
    this.opNow += o * k(0.12);
    const h = Math.max(8, this.heightNow);
    this.hand.position.y = h + 14; // the palm's underside at the height
    const r = h * Math.tan((this.halfAngle * Math.PI) / 180) + 2.6;
    this.cone.scale.set(r, h, r);
    this.handMat.uniforms.uOpacity.value = this.opNow;
    this.coneMat.uniforms.uOpacity.value = this.opNow * 0.8;
    this.group.visible = this.opNow > 0.004;
    return Math.abs(d) > 0.05 || Math.abs(o) > 0.002;
  }
  get top() {
    return this.heightNow + 30;
  }
}

const fieldVert = /* glsl */ `
  uniform vec2 uC;
  varying vec2 vP;
  void main() {
    vP = position.xz + uC; // the plane's own frame is the table's, moved to the field's middle
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// lid_art.py: PITCH 3, W_NEAR 1.1 to W_FAR 0.6, SEAM 1.6, the box rings start outside a halo
// around the bezel. Here the same ratios at four times the scale.
const fieldFrag = /* glsl */ `
  uniform vec2 uG;          // the guitar's sensor
  uniform vec2 uB;          // the receiver's sensor
  uniform vec2 uC;          // the middle of the field
  uniform float uPitch, uWNear, uWFar, uSeam, uB0, uR0, uR1, uTime, uOpacity, uSpeed;
  uniform float uPG[8];     // pulse start times, guitar packets
  uniform float uPB[8];     // pulse start times, the receiver's own sensor
  uniform vec3 uColor;
  varying vec2 vP;
  float rings(float d, float r0, float span) {
    float f = (d - r0) / uPitch;
    if (f < -0.5) return 0.0;
    float k = floor(f + 0.5);
    float w = mix(uWNear, uWFar, clamp(k * uPitch / span, 0.0, 1.0));
    float x = abs(fract(f + 0.5) - 0.5) * uPitch;
    float aa = fwidth(d) * 0.9;
    return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, x);
  }
  void main() {
    float L = distance(uG, uB);
    vec2 n = (uB - uG) / L;
    float side = dot(vP - (uG + uB) * 0.5, n);
    float dg = distance(vP, uG), db = distance(vP, uB);
    float span = uR1;
    float line, s, sb = -1.0;
    if (side < -uSeam * 0.5) { line = rings(dg, uPitch, span); s = dg; }
    else if (side > uSeam * 0.5) { line = rings(db, uB0, span * 0.6); s = L - db; sb = db; }
    else discard;
    float pulse = 0.0;
    for (int i = 0; i < 8; i++) {
      float r = (uTime - uPG[i]) * uSpeed;
      if (r > 0.0 && r < L + 40.0) pulse += exp(-pow((s - r) / 16.0, 2.0)) * (1.0 - smoothstep(L - 20.0, L + 30.0, r));
      if (sb >= 0.0) {
        float rb = (uTime - uPB[i]) * uSpeed * 0.7;
        if (rb > 0.0) pulse += exp(-pow((sb - rb) / 14.0, 2.0)) * (1.0 - smoothstep(L * 0.3, L * 0.5, rb));
      }
    }
    float fade = 1.0 - smoothstep(uR0, uR1, distance(vP, uC));
    float a = line * fade * (0.15 + 0.85 * min(pulse, 1.0)) * uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class Field {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private nextG = 0;
  private nextB = 0;
  private lastG = -1;
  private t0 = performance.now();
  opacity = 0;
  private opNow = 0;
  constructor(guitar: THREE.Vector2, box: THREE.Vector2) {
    const c = guitar.clone().add(box).multiplyScalar(0.5);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: fieldVert,
      fragmentShader: fieldFrag,
      uniforms: {
        uG: { value: guitar },
        uB: { value: box },
        uC: { value: c },
        uPitch: { value: 12 },
        uWNear: { value: 1.9 },
        uWFar: { value: 0.9 },
        uSeam: { value: 9 },
        uB0: { value: 62 },
        uR0: { value: 180 },
        uR1: { value: 520 },
        uTime: { value: 0 },
        uSpeed: { value: 520 },
        uOpacity: { value: 0 },
        uPG: { value: new Array(8).fill(-100) },
        uPB: { value: new Array(8).fill(-100) },
        uColor: { value: ORANGE.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
    });
    const g = new THREE.PlaneGeometry(1400, 1400);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.position.set(c.x, 0.2, c.y);
    this.mesh.renderOrder = -1;
  }
  private now() {
    return (performance.now() - this.t0) / 1000;
  }
  /** A packet from the guitar. Close packets share a pulse: the eye cannot tell 20 ms apart. */
  packet() {
    const t = this.now();
    if (t - this.lastG < 0.16) return;
    this.lastG = t;
    this.mat.uniforms.uPG.value[this.nextG++ % 8] = t;
  }
  local() {
    const t = this.now();
    const arr = this.mat.uniforms.uPB.value as number[];
    if (t - Math.max(...arr) < 0.22) return;
    arr[this.nextB++ % 8] = t;
  }
  /** True while a pulse runs or the field fades. */
  update(dt = 1 / 60): boolean {
    const t = this.now();
    this.mat.uniforms.uTime.value = t;
    const d = this.opacity - this.opNow;
    this.opNow += d * (1 - Math.pow(1 - 0.08, dt * 60));
    this.mat.uniforms.uOpacity.value = this.opNow;
    this.mesh.visible = this.opNow > 0.003;
    const pulses = [...this.mat.uniforms.uPG.value, ...this.mat.uniforms.uPB.value] as number[];
    return Math.abs(d) > 0.002 || pulses.some((p) => t - p < 1.4);
  }
}

// ---- the guitar around the pickguard ------------------------------------------------------------
// The Squier Mustang as light: the body, the neck, the headstock with its tuners and the six
// strings, from src/guitar.json (the pickguard frame: X to the neck, Y to the bass side, Z = 0 on
// the body top, mm). The build writes that file from the pickguard's own export when it has a
// body outline, and from tools/mustang.json otherwise.
export type GuitarShape = {
  source: string;
  // how tools/mustang.json placed the body: model, scale, turn, shift, fit error
  bodyFit?: { model: string; scale_mm_per_unit: number; rotation_deg: number; translate_mm: number[]; rms_mm: number };
  body: [number, number][];
  depth: number;
  saddleX: number;
  scale: number;
  strings: { y: number; saddleSpread: number; nutSpread: number; zSaddle: number; zNut: number };
  // centreY is the neck's centre at the nut, heelCentreY at the heel (the neck may run a little off X)
  neck: { heelX: number; centreY: number; heelCentreY?: number; heelWidth: number; nutWidth: number; top: number; thick: number };
  headstock: [number, number][];
  // post i from the nut: (x0 + i pitch, y + i dy) from the nut centre; the low E post is nearest
  tuners: { y: number; x0: number; pitch: number; dy?: number };
};
const edgeFrag = /* glsl */ `
  uniform vec3 uRim;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float edge = pow(f, 2.6) * 0.9 + 0.03;
    vec3 c = uRim * edge * uOpacity;
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;
const edgeVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

export class GuitarGhost {
  readonly group = new THREE.Group();
  private mats: { m: THREE.ShaderMaterial | THREE.LineBasicMaterial; k: number }[] = [];
  opacity = 0;
  private opNow = 0;
  constructor(g: GuitarShape) {
    const rim = PALE.clone().lerp(ORANGE, 0.3);
    const solid = (k: number) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: edgeVert, fragmentShader: edgeFrag,
        uniforms: { uRim: { value: rim }, uOpacity: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
      });
      this.mats.push({ m, k });
      return m;
    };
    const line = (k: number) => {
      const m = new THREE.LineBasicMaterial({ color: rim, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.mats.push({ m, k });
      return m;
    };
    // a flat shape in (X, Y), from Z = top - thick up to Z = top, into the unit's GLB frame
    // (X, Z, -Y): (x, y, z) goes to (x, z + top - thick, -y), a rotation, so the faces keep their side
    const slab = (pts: [number, number][], thick: number, top: number, k: number, bevel = 2) => {
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), {
        depth: thick - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4,
      });
      geo.translate(0, 0, bevel);
      geo.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, top - thick, 0, -1, 0, 0, 0, 0, 0, 1));
      const mesh = new THREE.Mesh(geo, solid(k));
      mesh.renderOrder = 1;
      this.group.add(mesh);
    };
    const smooth = (pts: [number, number][]) =>
      new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, "centripetal").getSpacedPoints(400).slice(0, -1).map((v) => [v.x, v.y] as [number, number]);
    const body = smooth(g.body);
    slab(body, g.depth, 0, 0.5, 3);
    const top = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(body.map(([x, y]) => new THREE.Vector3(x, 0.3, -y))), line(0.35));
    this.group.add(top);
    // the neck, narrowing from the heel to the nut
    const n = g.neck, nutX = g.saddleX + g.scale, c = n.centreY, ch = n.heelCentreY ?? c;
    slab([[n.heelX, ch - n.heelWidth / 2], [nutX, c - n.nutWidth / 2], [nutX, c + n.nutWidth / 2], [n.heelX, ch + n.heelWidth / 2]], n.thick, n.top, 0.45, 2);
    // the headstock, in mm from the nut and the neck's centre, a little below the fretboard
    slab(g.headstock.map(([x, y]) => [nutX + x, c + y] as [number, number]), 14, n.top - 4, 0.4, 2);
    const tunerAt: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const x = nutX + g.tuners.x0 + i * g.tuners.pitch, y = c + g.tuners.y + i * (g.tuners.dy ?? 0);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 12, 16), solid(0.5));
      post.position.set(x, n.top + 2, -y);
      this.group.add(post);
      tunerAt.push(new THREE.Vector3(x, n.top + 5, -y));
    }
    // the strings: saddle to nut to the tuner post, low E on the bass side to the nearest post
    const s = g.strings;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const k = (i - 2.5) / 5; // -0.5 is the low E (bass, +Y), on post 0 next to the nut
      const a = new THREE.Vector3(g.saddleX, s.zSaddle, -(s.y - k * s.saddleSpread));
      const b = new THREE.Vector3(nutX, s.zNut, -(c - k * s.nutSpread));
      pts.push(a, b, b, tunerAt[i]);
    }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), line(0.28)));
    this.group.visible = false;
  }
  update(dt = 1 / 60) {
    const d = this.opacity - this.opNow;
    this.opNow += d * (1 - Math.pow(1 - 0.08, dt * 60));
    for (const { m, k } of this.mats) {
      if (m instanceof THREE.ShaderMaterial) m.uniforms.uOpacity.value = this.opNow * k;
      else m.opacity = this.opNow * k;
    }
    this.group.visible = this.opNow > 0.004;
  }
}
