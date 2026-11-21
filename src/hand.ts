// A right hand, palm down, built from its bones: a palm, four fingers of three phalanges each
// with their knuckles, and a thumb with its own angle, in a relaxed curl. Proportions of an
// adult hand: about 190 mm from wrist to the tip of the middle finger, 84 mm across the palm.
//
// Frame: mm, origin at the middle of the palm, y up, fingers along -z, thumb on -x. Every
// vertex carries aFade: 1 on the hand, falling to 0 along the forearm.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const deg = (d: number) => (d * Math.PI) / 180;
const Y = new THREE.Vector3(0, 1, 0);

type Finger = {
  base: [number, number, number]; // the knuckle (MCP joint)
  splay: number; // degrees about y, + toward the thumb
  lengths: [number, number, number]; // proximal, middle, distal phalanx
  radii: [number, number, number, number]; // at the MCP, PIP, DIP joint and the tip
  flex: [number, number, number]; // degrees at MCP, PIP, DIP, down toward the palm
};
const FINGERS: Finger[] = [
  { base: [-28, 3, -43], splay: 5, lengths: [43, 25, 20], radii: [10.2, 9.2, 8.2, 7.2], flex: [9, 22, 14] }, // index
  { base: [-9, 4, -47], splay: 1, lengths: [48, 29, 21], radii: [10.6, 9.6, 8.5, 7.5], flex: [11, 25, 16] }, // middle
  { base: [10, 3, -45], splay: -3, lengths: [45, 27, 21], radii: [10.0, 9.0, 8.0, 7.1], flex: [13, 28, 18] }, // ring
  { base: [27, 0.5, -39], splay: -9, lengths: [35, 21, 18], radii: [8.8, 7.8, 7.0, 6.2], flex: [15, 31, 21] }, // little
];

// a tapered rod from a to b, closed by spheres at both joints
function bone(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number) {
  const len = a.distanceTo(b);
  const rod = new THREE.CylinderGeometry(rb, ra, len, 24, 3, true);
  rod.translate(0, len / 2, 0);
  rod.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()));
  rod.translate(a.x, a.y, a.z);
  const joint = new THREE.SphereGeometry(rb, 24, 16);
  joint.translate(b.x, b.y, b.z);
  return [rod, joint];
}

// a chain of bones from a start point: each joint turns the direction about an axis
function chain(start: THREE.Vector3, dir: THREE.Vector3, axisOf: (d: THREE.Vector3) => THREE.Vector3, lengths: number[], radii: number[], flex: number[]) {
  const out: THREE.BufferGeometry[] = [];
  const s0 = new THREE.SphereGeometry(radii[0] * 1.12, 24, 16); // the knuckle
  s0.translate(start.x, start.y, start.z);
  out.push(s0);
  let p = start.clone(), d = dir.clone();
  lengths.forEach((L, i) => {
    d.applyAxisAngle(axisOf(d), deg(flex[i]));
    const q = p.clone().addScaledVector(d, L);
    out.push(...bone(p, q, radii[i], radii[i + 1]));
    p = q;
  });
  return out;
}

export function handGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // the palm: a rounded slab (a sphere pushed toward a box), narrower at the wrist, its back
  // domed and its underside flatter
  const palm = new THREE.SphereGeometry(1, 48, 32);
  const pos = palm.getAttribute("position");
  const sq = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < pos.count; i++) {
    let x = sq(pos.getX(i), 0.55) * 40, y = sq(pos.getY(i), 0.8) * 13;
    const z = sq(pos.getZ(i), 0.6) * 47;
    const t = (z + 47) / 94; // 0 at the knuckles, 1 at the wrist
    x *= 1 - 0.16 * t;
    y = y > 0 ? y + 4 * (1 - Math.min(1, (x / 40) ** 2)) : y * 0.8;
    pos.setXYZ(i, x, y, z);
  }
  palm.computeVertexNormals();
  parts.push(palm);
  for (const f of FINGERS) {
    const start = new THREE.Vector3(...f.base);
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(Y, deg(f.splay));
    const across = (d: THREE.Vector3) => new THREE.Vector3().crossVectors(d, Y).normalize().negate();
    parts.push(...chain(start, dir, across, f.lengths, f.radii, f.flex));
  }
  // the thumb: from the wrist side of the palm, out and forward, below the palm's plane
  const tStart = new THREE.Vector3(-33, -7, 14);
  const tDir = new THREE.Vector3(-0.6, -0.2, -0.78).normalize();
  const tAxis = (d: THREE.Vector3) => new THREE.Vector3().crossVectors(d, new THREE.Vector3(0.5, 1, 0).normalize()).normalize().negate();
  parts.push(...chain(tStart, tDir, tAxis, [40, 31, 25], [11.5, 10.2, 8.8, 7.4], [6, 14, 20]));
  // the ball of the thumb, joining it to the palm
  const thenar = new THREE.SphereGeometry(1, 32, 20);
  thenar.scale(19, 11, 27);
  thenar.rotateY(deg(-20));
  thenar.translate(-27, -6, 8);
  parts.push(thenar);
  // the wrist and the forearm, toward the player
  const arm = new THREE.CylinderGeometry(33, 29, 170, 32, 6, true);
  arm.rotateX(Math.PI / 2);
  arm.scale(1, 0.62, 1);
  arm.translate(0, -1, 40 + 85);
  parts.push(arm);

  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute("uv");
    if (!n.getAttribute("normal")) n.computeVertexNormals();
    const p = n.getAttribute("position");
    const fade = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) fade[i] = 1 - THREE.MathUtils.smoothstep(p.getZ(i), 60, 190);
    n.setAttribute("aFade", new THREE.BufferAttribute(fade, 1));
    return n;
  });
  return mergeGeometries(flat)!;
}
