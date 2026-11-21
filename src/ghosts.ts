// What the page adds to the CAD: the hand over the guitar's sensor and its light cone, drawn
// as light like H2H's ghost cables, and the field on the table under both units: the wave
// pattern of the receiver lid (heat/case/lid_art.py), rings around the guitar's sensor and
// rings around the receiver's sensor that meet on the line halfway between them. A packet is
// a pulse that runs out through the guitar's rings and in through the receiver's; the
// receiver's own sensor sends a pulse out through its rings.
import * as THREE from "three";

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

/** A relaxed open hand, palm down, about 190 mm long, fingers along -z. Origin at the palm's centre. */
function handGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const palm = new THREE.SphereGeometry(1, 40, 24);
  palm.scale(42, 13, 50);
  parts.push(palm);
  // four fingers: x across the palm, length, a little curl down
  const fingers: [number, number, number][] = [[-27, 62, 7.4], [-9, 72, 8], [9, 69, 7.8], [26, 56, 7]];
  for (const [x, len, r] of fingers) {
    const g = new THREE.CapsuleGeometry(r, len, 8, 20);
    g.rotateX(Math.PI / 2 - 0.12);
    g.translate(x * 1.05, -4, -44 - len / 2);
    parts.push(g);
  }
  const thumb = new THREE.CapsuleGeometry(9, 44, 8, 20);
  thumb.rotateX(Math.PI / 2);
  thumb.rotateY(-0.85);
  thumb.translate(-46, -6, -10);
  parts.push(thumb);
  // the wrist, fading off toward the player
  const wrist = new THREE.CapsuleGeometry(24, 26, 8, 24);
  wrist.rotateX(Math.PI / 2);
  wrist.scale(1.15, 0.55, 1);
  wrist.translate(0, 2, 56);
  parts.push(wrist);
  return parts;
}

export class Hand {
  readonly group = new THREE.Group();
  private hand = new THREE.Group();
  private cone: THREE.Mesh;
  private handMat = ghost(false);
  private coneMat = ghost(true, ORANGE.clone().lerp(PALE, 0.2));
  private heightNow = 200;
  height = 200; // mm above the sensor window
  opacity = 0;
  private opNow = 0;
  constructor(private halfAngle = 14) {
    for (const g of handGeometry()) this.hand.add(new THREE.Mesh(g, this.handMat));
    this.hand.rotation.y = -Math.PI / 2; // the fingers toward the neck
    const cg = new THREE.CylinderGeometry(1, 0.08, 1, 48, 1, true);
    cg.translate(0, 0.5, 0);
    // radius 1 at the top (y = 1), a point at the sensor
    this.cone = new THREE.Mesh(cg, this.coneMat);
    this.cone.renderOrder = 3;
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
    this.hand.position.y = h + 13;
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
