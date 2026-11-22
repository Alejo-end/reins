// How the parts of one unit come apart and go together. tools/explode.mjs works out the plan from
// the model and writes it into parts.json; the page and the collision check of that tool both move
// the parts with poses() below, so what the check proves is what the page draws.
//
// The plan holds the real assembly: a base (the receiver's lid, the pickguard plate) and every
// other part in the order it goes in, each along its own way in: down or up, or across for a
// part that slides on (a jack nut on its thread, the cell into its sleeve), with a quarter turn
// first for the bayonet bezel. Apart, the parts stand in layers like a sandwich, each clear of
// the ones it passes.
//
// A part is at `away` (mm, page axes, y up) when apart and at home when together. Its own share of
// the way is f: 1 apart, 0 home. During the stage f falls in the part's window (by rank, the
// order of the build); the explode sections lift every f to at least the explode value. A later
// part never has a smaller f than an earlier one, so a part never overtakes the part it has to
// pass: that is what keeps the motion free of collisions (tools/explode.mjs checks it).
//
// All motion is relative to the base. The page may keep another part still (the receiver keeps
// its main board on the table): `ref`. The whole unit then moves with the base by the ref's f.
export type Step = {
  name: string;
  away: number[]; // x, y, z
  rank: number;
  ride?: string; // rides on this part, and adds its own (away minus the parent's away)
  turn?: number; // radians about the vertical through the part's centre, before it moves
  base?: boolean;
  ref?: boolean;
};
export type Plan = { steps: Step[]; ranks: number; base: number[]; ref?: string };
export type Pose = { x: number; y: number; z: number; turn: number };

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const land = (t: number) => 1 - Math.pow(1 - easeInOut(t), 1.6);
// the share of a turning part's way that it spends turning, at home
export const TURN = 0.3;
// where each unit goes together in the stage (scene.progress)
export const STAGE: Record<"guitar" | "receiver", [number, number]> = { guitar: [0.04, 0.44], receiver: [0.38, 0.78] };

export function makePlan(steps: Step[]): Plan {
  // parents before their riders
  const byName = new Map(steps.map((s) => [s.name, s]));
  const depth = (s: Step): number => (s.ride && byName.has(s.ride) ? 1 + depth(byName.get(s.ride)!) : 0);
  const sorted = [...steps].sort((a, b) => depth(a) - depth(b));
  const base = steps.find((s) => s.base)?.away ?? [0, 0, 0];
  return { steps: sorted, ranks: Math.max(1, ...steps.map((s) => s.rank + 1)), base: [...base], ref: steps.find((s) => s.ref)?.name };
}

/** The window of a rank in the stage, as a share of the unit's own assembly. */
export const windowOf = (rank: number, ranks: number): [number, number] => [rank / ranks, Math.min(1, (rank + 1.6) / ranks)];

/** f of a rank: 1 apart, 0 home; asm 0..1 the unit's assembly, e 0..1 the explode. */
export function share(rank: number, ranks: number, asm: number, e: number) {
  const [a, b] = windowOf(rank, ranks);
  return Math.max(1 - land(span(asm, a, b)), e);
}

/** Every part's displacement from home (mm) and turn (radians). */
export function poses(plan: Plan, asm: number, e: number, out = new Map<string, Pose>()) {
  const byName = new Map(plan.steps.map((s) => [s.name, s]));
  const refStep = plan.ref ? byName.get(plan.ref) : undefined;
  const g = refStep ? share(refStep.rank, plan.ranks, asm, e) : 0;
  const B = plan.base;
  for (const s of plan.steps) {
    const f = share(s.rank, plan.ranks, asm, e);
    const parent = s.ride ? out.get(s.ride) : undefined;
    const p = out.get(s.name) ?? { x: 0, y: 0, z: 0, turn: 0 };
    if (parent) {
      const a = byName.get(s.ride!)!.away;
      p.x = parent.x + (s.away[0] - a[0]) * f;
      p.y = parent.y + (s.away[1] - a[1]) * f;
      p.z = parent.z + (s.away[2] - a[2]) * f;
      p.turn = parent.turn;
    } else {
      const rise = s.turn ? span(f, TURN, 1) : f;
      p.x = (s.away[0] - B[0]) * rise + B[0] * g;
      p.y = (s.away[1] - B[1]) * rise + B[1] * g;
      p.z = (s.away[2] - B[2]) * rise + B[2] * g;
      p.turn = s.turn ? s.turn * Math.min(1, f / TURN) : 0;
    }
    out.set(s.name, p);
  }
  return out;
}
