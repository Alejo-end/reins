# reins-site

The website of REINS, a gesture MIDI controller for a guitar. A distance sensor sits in the
pickguard. A radio link goes to a receiver box with USB and DIN MIDI, a second sensor, an
expression pedal and two footswitches. Both units come apart and go together as you scroll.
Then they stand on one table, with the wave field of the receiver lid between them. Each
section turns the scene to its part. The demos run a small model of the two firmwares.

To be served at https://alejo-end.github.io/reins/.

## Run it

```
npm install
npm run dev                     # http://localhost:5210
BASE=/reins/ npm run build      # the static site in dist/, for GitHub Pages
```

## The parts

- `src/scene.ts`: `<reins-scene>`, both units in three.js. Set `progress` (0 apart, 1
  together), `view` (a name from `VIEWS`), `side` (where the words are), `shift`, `explode`
  (takes the receiver apart again), call `hand(mm)` and `pulse(kind)`.
- `src/motion.ts`: how the parts of a unit move between home and apart, from the plan in
  `src/parts.json` (see "Coming apart").
- `src/ghosts.ts`: the ghost hand and its light cone over the guitar's sensor, and the field
  on the table: the rings of the receiver lid (`heat/case/lid_art.py`) around both sensors,
  meeting halfway. A packet runs through them as a pulse.
- `src/hand.ts`: the hand over the sensor, built from its bones: a palm, four fingers of three
  phalanges with their knuckles, a thumb at its own angle, a relaxed curl. The page draws it
  as light: a depth pass, then a soft edge.
- `src/guitar.json`: the Squier Mustang around the pickguard: the body outline, the neck, the
  headstock and the strings. The build copies it from `tools/mustang.json`, or takes the body
  outline from the pickguard's own export. `tools/mustang.json` says where its numbers come from.
- `src/reins.ts`: the firmware model. The guitar polls, smooths and sends CC as `tof_midi_v5`
  does. The receiver forwards, mutes, holds, learns the pedal range and lights its stick as
  `tof_midi_v6_rx` does.
- `src/diagrams.ts`: the line drawings: the hand in section and the ring, the lid field with
  the five byte packet, the 8 x 8 zones and the stick, the pedal, the routes.
- `src/firmware.json`: the numbers, read from both firmwares by `tools/firmware.mjs`. If a
  constant is renamed in the firmware, the script stops.
- `src/parts.json`: every node of the model with its unit, layer, colour and box, written with
  the model.

## Where the model comes from

A local script builds `public/model/reins.glb` from the CAD projects and only reads them.
The script stays out of this repository (`tools/private/`, git ignored). It does these steps:

1. kicad-cli exports the four boards as GLB: `reins-guitar`, `reins-ring` (midiguitar) and
   `reins`, `reins-jack` (heat).
2. FreeCAD (`tools/private/export_cad.py`) writes the pickguard parts from
   `reins-pickguard-assembly.step`, the pod from `pod.py`'s STL, and the board placements from
   the parameters of `build_pickguard.py`.
3. If `heat/case/v2/web/` exists, the receiver case comes from there. `tools/receiver-v2.mjs`
   reads its `parts.json`: colours, assembly order, explode vectors and board transforms.
   Without it, the parts come from `heat/case/receiver-assembly.step`.
   In the same way, if `reins-guitar/pickguard/v2/web/` exists, `tools/pickguard-v2.mjs` reads
   the pickguard from there, with the board transforms and a body outline if it has one.
4. `tools/assemble.mjs` (glTF-Transform, in `tools/work/npm`) bakes each board into its unit's
   frame, simplifies it, adds the LED pucks and compresses everything (meshopt). About 1 MB.
   The guitar's OLED module leaves the board as a part of its own (`G_OLED`), and the board's
   KiCad models of the encoder and the mute switch go, as the export has them as STLs.
5. `tools/explode.mjs` works out how the parts come apart and go together, writes it into
   `src/parts.json` and checks it (below). `src/motion.ts` moves the parts by that plan, on the
   page and in the check.

## Coming apart

Each part goes in along its real way, in the order of the real build: the case goes together
upside down in the lid, so the light bar, the baffle, the button caps, the boards, the tray, the
screws and the feet all come out of the lid downwards, and the bezel and the knob upwards. The
bezel first turns a quarter turn (a bayonet), the jack nuts slide back off their threads and the
guitar's cell slides out of its sleeve. Apart, the parts stand in layers, each 7 mm clear of every
part it shares a footprint with. `tools/explode.mjs` finds all of this from the shapes in the model
(vertical rays 0.2 mm apart through every part) and the export's assembly order; the export's
own explode vectors only give the nuts their direction.

The check moves every part through the stage, both explode sections and 3000 random mixes of the
two, and measures the overlap of every pair of parts: exactly along each vertical stretch, at
0.2 mm or 1 degree steps across and turning. A pair may overlap only as much as at rest (the crush
ribs and press fits of the CAD checks, and faces that touch in the meshes), and once it starts to
come apart its overlap may only shrink. `node tools/explode.mjs` plans and checks (about two
minutes); `node tools/explode.mjs --check` only checks.

## Checks

The text was measured in Chromium at 390, 768, 1280 and 1680 px wide: no text box overlaps
another.
