// Reads the numbers the site shows from the two REINS firmwares, so the page says what the
// firmware does and not what it did once.
//
//   node tools/firmware.mjs <tof_midi_v5.ino> <tof_midi_v6_rx.ino> > src/firmware.json
//
// The guitar runs tof_midi_v5 (reins-guitar/README.md), the receiver runs tof_midi_v6_rx.
// Every value must be found: a renamed constant stops the build instead of a stale page.
import fs from 'node:fs';

const [gFile, rFile] = process.argv.slice(2);
if (!gFile || !rFile) throw new Error('usage: firmware.mjs <tof_midi_v5.ino> <tof_midi_v6_rx.ino>');

function reader(file) {
  const src = fs.readFileSync(file, 'utf8');
  const must = (re, what) => {
    const m = src.match(re);
    if (!m) throw new Error(`firmware.mjs: ${what} not found in ${file}`);
    return m;
  };
  const def = (name) => Number(must(new RegExp(`#define\\s+${name}\\s+(-?[\\d.]+)f?\\b`), name)[1]);
  const hexdef = (name) => parseInt(must(new RegExp(`#define\\s+${name}\\s+0x([0-9A-Fa-f]+)`), name)[1], 16);
  return { src, must, def, hexdef };
}
const g = reader(gFile), r = reader(rFile);
const num = (m) => Number(m[1]);

const fw = {
  guitar: {
    file: 'tof_midi_v5',
    channel: g.def('ESPNOW_CHANNEL'),
    magic: g.hexdef('ESPNOW_MAGIC'),
    pollMs: g.def('POLL_MS'),
    ema: g.def('EMA_ALPHA'),
    velDeadMm: g.def('VEL_DEAD_MM'),
    velMaxMm: g.def('VEL_MAX_MM'),
    midiCh: g.def('MIDI_CH_DEFAULT'),
    ccDist: g.def('CC_DIST_DEFAULT'),
    ccVel: g.def('CC_VEL_DEFAULT'),
    distMin: g.def('DIST_MIN_DEFAULT'),
    distMax: g.def('DIST_MAX_DEFAULT'),
    pixels: g.def('NUM_PIXELS'),
    stripBright: g.def('STRIP_BRIGHT_DEFAULT'),
    mute: [g.def('MUTE_R'), g.def('MUTE_G'), g.def('MUTE_B')],
    // showRing(): a white bar, its brightness ramping along its length; the tip goes full
    // white on a fast hand
    ramp: g.must(/map\(i, 0, n - 1, (\d+), (\d+)\)/, 'the ring ramp').slice(1, 3).map(Number),
    flashVel: num(g.must(/if \(liveVel > (\d+) && n > 0\)/, 'the fast hand flash')),
    breathMs: num(g.must(/showBreathe\(\) \{\s*float phase = sinf\(millis\(\) \* TWO_PI \/ ([\d.]+)f\)/, 'the mute breath')),
    wipeMs: num(g.must(/triggerWipe\(\) \{[\s\S]*?wipeUntil = millis\(\) \+ (\d+);/, 'the wipe')),
    batLowMv: g.def('BAT_LOW_MV'),
    sleepMs: g.def('OLED_SLEEP_MS'),
  },
  receiver: {
    file: 'tof_midi_v6_rx',
    channel: r.def('ESPNOW_CHANNEL'),
    magic: r.hexdef('ESPNOW_MAGIC'),
    localCh: r.def('LOCAL_CH'),
    ccDist: r.def('LOCAL_CC_DIST'),
    ccVel: r.def('LOCAL_CC_VEL'),
    distMin: r.def('DIST_MIN_MM'),
    distMax: r.def('DIST_MAX_MM'),
    velFullMms: r.def('VEL_FULL_MMS'),
    velDeadMms: r.def('VEL_DEAD_MMS'),
    emaDist: r.def('EMA_ALPHA_DIST'),
    emaVel: r.def('EMA_ALPHA_VEL'),
    zones: num(r.must(/tof\.setResolution\((\d+)\)/, 'the zone count')),
    hz: num(r.must(/tof\.setRangingFrequency\((\d+)\)/, 'the frame rate')),
    noSignalMs: r.def('NO_SIGNAL_MS'),
    rxBuf: r.def('RX_BUF_LEN'),
    expCc: r.def('EXP_CC'),
    expMinSpan: r.def('EXP_MIN_SPAN'),
    muteLatchMs: r.def('MUTE_LATCH_MS'),
    pairHoldMs: r.def('BTN_PAIR_HOLD_MS'),
    pixels: r.def('NUM_PIXELS'),
    brightness: r.def('NEOPIXEL_BRIGHTNESS'),
    sources: r.must(/SRC_NAME\[SRC_COUNT\] = \{([^}]*)\}/, 'the source names')[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1)),
    stick: {
      mute: r.must(/if \(bypassed\) \{\s*for \(int i = 0; i < NUM_PIXELS; i\+\+\) strip\.setPixelColor\(i, strip\.Color\((\d+), (\d+), (\d+)\)\)/, 'the mute colour').slice(1, 4).map(Number),
      linkMs: num(r.must(/showLinkPulse\(uint32_t now\) \{[\s\S]*?TWO_PI \/ ([\d.]+)f/, 'the link pulse')),
      idleMs: num(r.must(/showIdleBreathe\(uint32_t now\) \{[\s\S]*?TWO_PI \/ ([\d.]+)f/, 'the idle breath')),
      oledFailMs: num(r.must(/else if \(!oledOK\) \{[\s\S]*?TWO_PI \/ ([\d.]+)f/, 'the OLED fail breath')),
    },
  },
};
if (fw.guitar.channel !== fw.receiver.channel || fw.guitar.magic !== fw.receiver.magic)
  throw new Error('firmware.mjs: the guitar and the receiver disagree on the radio channel or the magic byte');
process.stdout.write(JSON.stringify(fw, null, 2) + '\n');
