export type SfxName =
  | 'ui-move' | 'ui-select' | 'ui-back' | 'ui-error' | 'ui-toggle'
  | 'hit-perfect' | 'hit-great' | 'hit-good' | 'miss' | 'wrong' | 'combo-break'
  | 'combo-milestone' | 'mult-up' | 'boost-ready' | 'boost-on' | 'boost-off' | 'sustain-end'
  | 'count-tick' | 'count-go' | 'star' | 'star-gold' | 'score-tick' | 'grade-stamp' | 'new-record'
  | 'level-up' | 'unlock' | 'achievement' | 'xp-tick' | 'crowd-cheer' | 'crowd-roar' | 'crowd-boo' | 'crowd-clap'
  | 'fail' | 'word-complete' | 'whoosh' | 'attack' | 'riff';

export type SfxOptions = {
  lane?: number;
  pan?: number;
  intensity?: number;
  at?: number;
  pitch?: number;
};

type Params = {
  t: number;
  pan: number;
  inten: number;
  k: number;
  lane: number;
  bright: number;
  lvl: number;
};

type Builder = (v: Voice, p: Params) => void;
type NoiseKind = 'white' | 'pink';
type Contour = ReadonlyArray<readonly [number, number]>;

type Bus = {
  ctx: AudioContext;
  master: GainNode;
  comp: DynamicsCompressorNode;
  active: number;
  crowd: CrowdBed | null;
};

type CrowdBed = {
  voice: Voice;
  gain: GainNode;
  depth: GainNode;
  band: BiquadFilterNode;
  level: number;
};

const FLOOR = 0.0001;
const MAX_VOICES = 96;
const NOISE_SECONDS = 2;
const CROWD_MAX = 0.22;
const SCALE = [0, 3, 5, 7, 10];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const noop = () => undefined;

function laneFreq(lane: number): number {
  const l = clamp(Math.round(lane), 0, 9);
  return midiHz(64 + SCALE[l % 5] + 12 * Math.floor(l / 5));
}

function buildCurve(drive: number) {
  const n = 512;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i += 1) {
    curve[i] = Math.tanh(drive * ((i * 2) / (n - 1) - 1)) / norm;
  }
  return curve;
}

const curves = new Map<number, ReturnType<typeof buildCurve>>();

function driveCurve(drive: number) {
  let curve = curves.get(drive);
  if (!curve) {
    curve = buildCurve(drive);
    curves.set(drive, curve);
  }
  return curve;
}

const noiseCache = new WeakMap<AudioContext, Partial<Record<NoiseKind, AudioBuffer>>>();

function makeNoise(ctx: AudioContext, kind: NoiseKind): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

function noiseBuffer(ctx: AudioContext, kind: NoiseKind): AudioBuffer {
  let cache = noiseCache.get(ctx);
  if (!cache) {
    cache = {};
    noiseCache.set(ctx, cache);
  }
  let buffer = cache[kind];
  if (!buffer) {
    buffer = makeNoise(ctx, kind);
    cache[kind] = buffer;
  }
  return buffer;
}

class Voice {
  readonly out: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private live = 0;
  private done = false;

  constructor(readonly ctx: AudioContext, private readonly bus: Bus, gain: number, pan: number) {
    this.out = this.add(ctx.createGain());
    this.out.gain.value = gain;
    let tail: AudioNode = this.out;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = this.add(ctx.createStereoPanner());
      panner.pan.value = pan;
      this.out.connect(panner);
      tail = panner;
    }
    tail.connect(bus.master);
    bus.active += 1;
  }

  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  gain(value: number): GainNode {
    const node = this.add(this.ctx.createGain());
    node.gain.value = value;
    return node;
  }

  filter(type: BiquadFilterType, frequency: number, q = 1): BiquadFilterNode {
    const node = this.add(this.ctx.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  shaper(drive: number): WaveShaperNode {
    const node = this.add(this.ctx.createWaveShaper());
    node.curve = driveCurve(drive);
    node.oversample = '2x';
    return node;
  }

  osc(type: OscillatorType, frequency: number, start: number, stop?: number): OscillatorNode {
    const node = this.add(this.ctx.createOscillator());
    node.type = type;
    node.frequency.value = frequency;
    this.track(node);
    node.start(start);
    if (stop !== undefined) node.stop(stop);
    return node;
  }

  noise(start: number, stop?: number, kind: NoiseKind = 'white'): AudioBufferSourceNode {
    const node = this.add(this.ctx.createBufferSource());
    node.buffer = noiseBuffer(this.ctx, kind);
    node.loop = true;
    this.track(node);
    node.start(start, Math.random() * (NOISE_SECONDS / 2));
    if (stop !== undefined) node.stop(stop);
    return node;
  }

  stopAt(when: number): void {
    for (const source of this.sources) {
      try {
        source.stop(when);
      } catch {
        noop();
      }
    }
  }

  seal(): void {
    if (this.live === 0) this.dispose();
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    this.bus.active -= 1;
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        noop();
      }
    }
  }

  private track(source: AudioScheduledSourceNode): void {
    this.live += 1;
    this.sources.push(source);
    source.onended = () => {
      this.live -= 1;
      if (this.live <= 0) this.dispose();
    };
  }
}

function env(param: AudioParam, t: number, peak: number, atk: number, dur: number): void {
  param.setValueAtTime(FLOOR, t);
  param.linearRampToValueAtTime(Math.max(peak, FLOOR * 2), t + atk);
  param.exponentialRampToValueAtTime(FLOOR, t + Math.max(dur, atk + 0.005));
}

function contour(param: AudioParam, t: number, points: Contour): void {
  param.setValueAtTime(FLOOR, t);
  for (const [dt, value] of points) param.linearRampToValueAtTime(Math.max(value, FLOOR), t + dt);
}

function sweep(param: AudioParam, t: number, from: number, to: number, dur: number): void {
  param.setValueAtTime(Math.max(from, FLOOR), t);
  param.exponentialRampToValueAtTime(Math.max(to, FLOOR), t + dur);
}

type NoteSpec = {
  type: OscillatorType;
  f: number;
  to?: number;
  fdur?: number;
  t: number;
  dur: number;
  peak: number;
  atk?: number;
  detune?: number;
  dest?: AudioNode;
};

function note(v: Voice, s: NoteSpec): OscillatorNode {
  const g = v.gain(FLOOR);
  const o = v.osc(s.type, s.f, s.t, s.t + s.dur + 0.03);
  if (s.detune) o.detune.value = s.detune;
  if (s.to !== undefined) sweep(o.frequency, s.t, s.f, s.to, s.fdur ?? s.dur);
  o.connect(g);
  g.connect(s.dest ?? v.out);
  env(g.gain, s.t, s.peak, s.atk ?? 0.004, s.dur);
  return o;
}

type BurstSpec = {
  t: number;
  dur: number;
  peak: number;
  type: BiquadFilterType;
  f: number;
  to?: number;
  fdur?: number;
  q?: number;
  atk?: number;
  kind?: NoiseKind;
  contour?: Contour;
  dest?: AudioNode;
};

function burst(v: Voice, s: BurstSpec): GainNode {
  const src = v.noise(s.t, s.t + s.dur + 0.03, s.kind);
  const filter = v.filter(s.type, s.f, s.q ?? 1);
  if (s.to !== undefined) sweep(filter.frequency, s.t, s.f, s.to, s.fdur ?? s.dur);
  const g = v.gain(FLOOR);
  src.connect(filter);
  filter.connect(g);
  g.connect(s.dest ?? v.out);
  if (s.contour) contour(g.gain, s.t, s.contour);
  else env(g.gain, s.t, s.peak, s.atk ?? 0.002, s.dur);
  return g;
}

function blip(v: Voice, f: number, t: number, dur: number, peak: number): void {
  note(v, { type: 'triangle', f, t, dur, peak });
  note(v, { type: 'sine', f: f * 2, t, dur: dur * 0.8, peak: peak * 0.35 });
}

const BELL_PARTIALS = [
  [1, 1, 1],
  [2.76, 0.45, 0.55],
  [5.4, 0.22, 0.35],
  [8.93, 0.1, 0.22],
] as const;

function bell(v: Voice, f: number, t: number, dur: number, peak: number): void {
  const root = Math.min(f, 12000);
  for (const [ratio, amp, life] of BELL_PARTIALS) {
    if (root * ratio > 15000) continue;
    note(v, { type: 'sine', f: root * ratio, t, dur: dur * life, peak: peak * amp, atk: 0.002 });
  }
}

function shimmer(v: Voice, f: number, t: number, dur: number, peak: number): void {
  for (const ratio of [2, 2.012, 3.02]) {
    if (f * ratio > 15000) continue;
    note(v, { type: 'sine', f: f * ratio, t: t + 0.02, dur, peak, atk: Math.min(0.08, dur * 0.2) });
  }
}

function pluck(v: Voice, f: number, t: number, dur: number, peak: number, bright: number): void {
  const cutoff = Math.min(f * bright, 14000);
  const lp = v.filter('lowpass', cutoff, 0.8);
  sweep(lp.frequency, t, cutoff, Math.max(f * 1.2, 200), dur);
  const g = v.gain(FLOOR);
  const sawLevel = v.gain(0.55);
  const triLevel = v.gain(0.35);
  const saw = v.osc('sawtooth', f, t, t + dur + 0.03);
  const tri = v.osc('triangle', f, t, t + dur + 0.03);
  tri.detune.value = 7;
  saw.connect(sawLevel);
  tri.connect(triLevel);
  sawLevel.connect(lp);
  triLevel.connect(lp);
  lp.connect(g);
  g.connect(v.out);
  env(g.gain, t, peak, 0.002, dur);
}

function sparkle(v: Voice, t: number, peak: number): void {
  burst(v, { t, dur: 0.05, peak, type: 'bandpass', f: 6000, q: 3, atk: 0.001 });
  note(v, { type: 'sine', f: 6000, t, dur: 0.03, peak: peak * 0.4, atk: 0.001 });
}

function distChord(
  v: Voice,
  freqs: number[],
  t: number,
  dur: number,
  peak: number,
  drive: number,
  cutoff: number,
  atk = 0.004,
): void {
  const pre = v.gain(0.6 / freqs.length);
  const ws = v.shaper(drive);
  const lp = v.filter('lowpass', cutoff, 0.9);
  sweep(lp.frequency, t, cutoff, Math.max(cutoff * 0.35, 300), dur);
  const g = v.gain(FLOOR);
  pre.connect(ws);
  ws.connect(lp);
  lp.connect(g);
  g.connect(v.out);
  for (const f of freqs) {
    for (const cents of [-8, 8]) {
      const o = v.osc('sawtooth', f, t, t + dur + 0.03);
      o.detune.value = cents;
      o.connect(pre);
    }
  }
  env(g.gain, t, peak, atk, dur);
}

function crowdContour(dur: number, peak: number): Contour {
  return [
    [dur * 0.3, peak],
    [dur * 0.65, peak * 0.9],
    [dur, 0],
  ];
}

function crowdSwell(v: Voice, p: Params, dur: number, peak: number, whoos: number, low: number): void {
  const swell = burst(v, {
    t: p.t,
    dur,
    peak,
    type: 'bandpass',
    f: 800,
    to: 2500,
    q: 0.9,
    kind: 'pink',
    contour: crowdContour(dur, peak),
  });
  const wobble = v.osc('sine', rand(3, 4.5), p.t, p.t + dur + 0.03);
  const depth = v.gain(peak * 0.18);
  wobble.connect(depth);
  depth.connect(swell.gain);
  if (low > 0) {
    burst(v, {
      t: p.t,
      dur,
      peak: low,
      type: 'lowpass',
      f: 420,
      q: 0.7,
      kind: 'pink',
      contour: crowdContour(dur, low),
    });
  }
  for (let i = 0; i < whoos; i += 1) {
    const start = p.t + rand(0.05, dur * 0.55);
    const f0 = rand(520, 760) * p.k;
    const len = rand(0.28, 0.42);
    for (const cents of [-14, 11]) {
      note(v, { type: 'sine', f: f0, to: f0 * rand(1.25, 1.6), t: start, dur: len, peak: 0.04, atk: 0.06, detune: cents });
    }
  }
}

const BUILDERS: Record<SfxName, Builder> = {
  'ui-move': (v, p) => {
    note(v, { type: 'triangle', f: 960 * p.k, to: 700 * p.k, t: p.t, dur: 0.04, peak: 0.12, atk: 0.002 });
  },
  'ui-select': (v, p) => {
    blip(v, 660 * p.k, p.t, 0.07, 0.15);
    blip(v, 990 * p.k, p.t + 0.05, 0.07, 0.15);
  },
  'ui-back': (v, p) => {
    blip(v, 990 * p.k, p.t, 0.06, 0.14);
    blip(v, 660 * p.k, p.t + 0.05, 0.065, 0.14);
  },
  'ui-error': (v, p) => {
    const lp = v.filter('lowpass', 1100, 0.7);
    lp.connect(v.out);
    note(v, { type: 'square', f: 110 * p.k, to: 98 * p.k, t: p.t, dur: 0.18, peak: 0.13, atk: 0.006, dest: lp });
    note(v, { type: 'square', f: 116.5 * p.k, to: 103 * p.k, t: p.t, dur: 0.18, peak: 0.1, atk: 0.006, dest: lp });
  },
  'ui-toggle': (v, p) => {
    note(v, { type: 'sine', f: 1500 * p.k, to: 900 * p.k, t: p.t, dur: 0.06, peak: 0.12, atk: 0.001 });
    burst(v, { t: p.t, dur: 0.02, peak: 0.1, type: 'bandpass', f: 3500, q: 1.5, atk: 0.001 });
  },

  'hit-perfect': (v, p) => {
    pluck(v, laneFreq(p.lane) * p.k, p.t, 0.14, 0.3, 9 * p.bright);
    sparkle(v, p.t, 0.1);
  },
  'hit-great': (v, p) => {
    pluck(v, laneFreq(p.lane) * p.k, p.t, 0.13, 0.24, 6 * p.bright);
  },
  'hit-good': (v, p) => {
    pluck(v, laneFreq(p.lane) * p.k, p.t, 0.12, 0.18, 3.5 * p.bright);
  },
  miss: (v, p) => {
    const lp = v.filter('lowpass', 500, 1);
    sweep(lp.frequency, p.t, 500, 140, 0.16);
    lp.connect(v.out);
    note(v, { type: 'sawtooth', f: 90 * p.k, to: 70 * p.k, t: p.t, dur: 0.16, peak: 0.26, atk: 0.003, dest: lp });
    note(v, { type: 'sawtooth', f: 90 * p.k, to: 70 * p.k, t: p.t, dur: 0.16, peak: 0.18, atk: 0.003, detune: 45, dest: lp });
    burst(v, { t: p.t, dur: 0.03, peak: 0.08, type: 'bandpass', f: 1800, q: 1, atk: 0.001 });
  },
  wrong: (v, p) => {
    const lp = v.filter('lowpass', 2600, 0.7);
    lp.connect(v.out);
    note(v, { type: 'square', f: 440 * p.k, t: p.t, dur: 0.09, peak: 0.1, atk: 0.001, dest: lp });
    note(v, { type: 'square', f: 466.16 * p.k, t: p.t, dur: 0.09, peak: 0.1, atk: 0.001, dest: lp });
    burst(v, { t: p.t, dur: 0.012, peak: 0.12, type: 'highpass', f: 3000, atk: 0.001 });
  },
  'combo-break': (v, p) => {
    const peak = 0.16 + 0.24 * p.inten;
    burst(v, { t: p.t, dur: 0.28, peak, type: 'bandpass', f: 3200, to: 260, q: 4, atk: 0.004 });
    const lp = v.filter('lowpass', 2500, 0.8);
    lp.connect(v.out);
    note(v, { type: 'sawtooth', f: 700 * p.k, to: 110 * p.k, t: p.t, dur: 0.28, peak: peak * 0.35, dest: lp });
  },

  'combo-milestone': (v, p) => {
    const count = 4 + Math.floor(p.inten * 2.99);
    const base = 67 + Math.round(p.inten * 9);
    const steps = [0, 4, 7, 12, 16, 19];
    for (let i = 0; i < count; i += 1) {
      const f = midiHz(base + steps[i]) * p.k;
      const t = p.t + i * 0.05;
      note(v, { type: 'triangle', f, t, dur: 0.2, peak: 0.14 });
      note(v, { type: 'sine', f: f * 2, t, dur: 0.16, peak: 0.05 });
    }
    const last = midiHz(base + steps[count - 1]) * p.k;
    shimmer(v, last, p.t + (count - 1) * 0.05, 0.3, 0.05);
  },
  'mult-up': (v, p) => {
    const lp = v.filter('lowpass', 5000, 0.8);
    lp.connect(v.out);
    note(v, { type: 'sawtooth', f: 300 * p.k, to: 1500 * p.k, t: p.t, dur: 0.15, peak: 0.13, atk: 0.01, dest: lp });
    note(v, { type: 'sine', f: 600 * p.k, to: 3000 * p.k, t: p.t, dur: 0.15, peak: 0.1, atk: 0.01 });
    burst(v, { t: p.t, dur: 0.01, peak: 0.12, type: 'highpass', f: 4000, atk: 0.001 });
  },
  'boost-ready': (v, p) => {
    const lp = v.filter('lowpass', 500, 2);
    sweep(lp.frequency, p.t, 500, 3500, 0.26);
    lp.connect(v.out);
    const g = v.gain(FLOOR);
    g.connect(lp);
    contour(g.gain, p.t, [[0.24, 0.17], [0.3, 0]]);
    const a = v.osc('sawtooth', 196 * p.k, p.t, p.t + 0.34);
    const b = v.osc('sawtooth', 196 * p.k, p.t, p.t + 0.34);
    b.detune.value = 22;
    sweep(a.frequency, p.t, 196 * p.k, 262 * p.k, 0.26);
    sweep(b.frequency, p.t, 196 * p.k, 262 * p.k, 0.26);
    a.connect(g);
    b.connect(g);
    const buzz = v.osc('sine', 48, p.t, p.t + 0.34);
    const buzzDepth = v.gain(0.04);
    buzz.connect(buzzDepth);
    buzzDepth.connect(g.gain);
    bell(v, 1174.7 * p.k, p.t + 0.26, 0.24, 0.2);
  },
  'boost-on': (v, p) => {
    note(v, { type: 'sine', f: 150 * p.k, to: 40 * p.k, t: p.t, dur: 1.0, fdur: 0.7, peak: 0.42, atk: 0.01 });
    note(v, { type: 'sine', f: 300 * p.k, to: 80 * p.k, t: p.t, dur: 0.8, fdur: 0.7, peak: 0.14, atk: 0.01 });
    burst(v, {
      t: p.t,
      dur: 1.1,
      peak: 0.2,
      type: 'bandpass',
      f: 300,
      to: 6500,
      fdur: 0.5,
      q: 2,
      contour: [[0.5, 0.2], [1.1, 0]],
    });
    const hit = p.t + 0.48;
    burst(v, { t: hit, dur: 0.15, peak: 0.2, type: 'lowpass', f: 1500, atk: 0.002 });
    distChord(v, [82.41 * p.k, 123.47 * p.k, 164.81 * p.k], hit, 0.62, 0.3, 5, 3200);
  },
  'boost-off': (v, p) => {
    const lp = v.filter('lowpass', 3200, 1);
    sweep(lp.frequency, p.t, 3200, 150, 0.55);
    lp.connect(v.out);
    note(v, { type: 'sawtooth', f: 800 * p.k, to: 60 * p.k, t: p.t, dur: 0.58, fdur: 0.55, peak: 0.22, dest: lp });
    note(v, { type: 'sine', f: 140 * p.k, to: 35 * p.k, t: p.t, dur: 0.55, peak: 0.22 });
    burst(v, { t: p.t, dur: 0.5, peak: 0.08, type: 'bandpass', f: 3000, to: 200, q: 1.2, atk: 0.01 });
  },
  'sustain-end': (v, p) => {
    bell(v, 1568 * p.k, p.t, 0.12, 0.15);
  },

  'count-tick': (v, p) => {
    note(v, { type: 'triangle', f: 1500 * p.k, to: 900 * p.k, t: p.t, dur: 0.05, peak: 0.2, atk: 0.001 });
    burst(v, { t: p.t, dur: 0.04, peak: 0.08, type: 'highpass', f: 7000, atk: 0.001 });
  },
  'count-go': (v, p) => {
    note(v, { type: 'triangle', f: 1760 * p.k, t: p.t, dur: 0.3, peak: 0.2, atk: 0.003 });
    note(v, { type: 'sine', f: 2640 * p.k, t: p.t, dur: 0.25, peak: 0.1, atk: 0.003 });
    burst(v, { t: p.t, dur: 0.06, peak: 0.14, type: 'bandpass', f: 5000, q: 1.5, atk: 0.001 });
  },
  star: (v, p) => {
    const f = 1046.5 * p.k;
    bell(v, f, p.t, 0.5, 0.2);
    shimmer(v, f, p.t, 0.5, 0.05);
  },
  'star-gold': (v, p) => {
    const root = 1046.5 * p.k;
    [1, 1.2599, 1.4983, 2].forEach((ratio, i) => {
      bell(v, root * ratio, p.t + i * 0.035, 1.2 - i * 0.05, 0.08);
    });
    shimmer(v, root, p.t, 1.2, 0.05);
    shimmer(v, root * 1.5, p.t + 0.05, 1.0, 0.03);
    burst(v, { t: p.t, dur: 0.1, peak: 0.06, type: 'highpass', f: 8000, atk: 0.002 });
  },
  'score-tick': (v, p) => {
    note(v, { type: 'triangle', f: 1800 * p.k, t: p.t, dur: 0.025, peak: 0.07, atk: 0.001 });
  },
  'grade-stamp': (v, p) => {
    note(v, { type: 'sine', f: 120 * p.k, to: 45 * p.k, t: p.t, dur: 0.35, fdur: 0.25, peak: 0.5, atk: 0.002 });
    burst(v, { t: p.t, dur: 0.08, peak: 0.28, type: 'lowpass', f: 3500, atk: 0.001 });
    burst(v, { t: p.t, dur: 0.05, peak: 0.15, type: 'bandpass', f: 900, q: 1, atk: 0.001 });
  },
  'new-record': (v, p) => {
    const lp = v.filter('lowpass', 3200, 0.8);
    lp.connect(v.out);
    const lick = [
      { m: 72, at: 0, dur: 0.17, harmony: 4 },
      { m: 76, at: 0.16, dur: 0.17, harmony: 4 },
      { m: 79, at: 0.32, dur: 0.58, harmony: 5 },
    ];
    for (const n of lick) {
      const t = p.t + n.at;
      const f = midiHz(n.m) * p.k;
      note(v, { type: 'sawtooth', f, t, dur: n.dur, peak: 0.11, atk: 0.015, dest: lp });
      note(v, { type: 'sawtooth', f, t, dur: n.dur, peak: 0.07, atk: 0.015, detune: 9, dest: lp });
      note(v, { type: 'triangle', f: midiHz(n.m + n.harmony) * p.k, t, dur: n.dur, peak: 0.1, atk: 0.015, dest: lp });
    }
    bell(v, midiHz(91) * p.k, p.t + 0.32, 0.55, 0.1);
  },

  'level-up': (v, p) => {
    const chord = [72, 76, 79, 84];
    chord.forEach((m, i) => {
      const f = midiHz(m) * p.k;
      note(v, { type: 'triangle', f, t: p.t + i * 0.09, dur: 0.25, peak: 0.15 });
      note(v, { type: 'sine', f: f * 2, t: p.t + i * 0.09, dur: 0.2, peak: 0.05 });
    });
    const hold = p.t + 0.36;
    for (const m of chord) note(v, { type: 'triangle', f: midiHz(m) * p.k, t: hold, dur: 0.94, peak: 0.075, atk: 0.02 });
    note(v, { type: 'sine', f: midiHz(48) * p.k, t: hold, dur: 0.9, peak: 0.12, atk: 0.02 });
    bell(v, midiHz(96) * p.k, hold, 0.9, 0.07);
    shimmer(v, midiHz(84) * p.k, hold, 0.94, 0.05);
  },
  unlock: (v, p) => {
    const chords: Array<[number, number[]]> = [
      [0, [84, 88, 91, 95]],
      [0.24, [89, 93, 96, 100]],
    ];
    for (const [at, notes] of chords) {
      notes.forEach((m, i) => bell(v, midiHz(m) * p.k, p.t + at + i * 0.03, at === 0 ? 0.5 : 0.55, 0.09));
      burst(v, { t: p.t + at, dur: 0.08, peak: 0.05, type: 'highpass', f: 8000, atk: 0.002 });
    }
  },
  achievement: (v, p) => {
    [84, 88, 91].forEach((m, i) => bell(v, midiHz(m) * p.k, p.t + i * 0.035, 0.6, 0.13));
    note(v, { type: 'sine', f: 100 * p.k, to: 50 * p.k, t: p.t, dur: 0.3, fdur: 0.25, peak: 0.35, atk: 0.003 });
  },
  'xp-tick': (v, p) => {
    note(v, { type: 'sine', f: 2400 * p.k, t: p.t, dur: 0.025, peak: 0.07, atk: 0.001 });
  },
  'crowd-cheer': (v, p) => {
    crowdSwell(v, p, 1.6, 0.3, 3 + Math.floor(Math.random() * 2), 0);
  },
  'crowd-roar': (v, p) => {
    crowdSwell(v, p, 2.8, 0.4, 5, 0.25);
  },
  'crowd-boo': (v, p) => {
    burst(v, {
      t: p.t,
      dur: 1.5,
      peak: 0.24,
      type: 'bandpass',
      f: 320,
      q: 1.1,
      kind: 'pink',
      contour: [[0.4, 0.24], [1.0, 0.24], [1.5, 0]],
    });
    const lp = v.filter('lowpass', 700, 0.8);
    lp.connect(v.out);
    const count = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i += 1) {
      note(v, {
        type: 'sawtooth',
        f: rand(145, 155) * p.k,
        to: rand(108, 115) * p.k,
        t: p.t + rand(0, 0.45),
        dur: 1.0,
        fdur: 0.9,
        peak: 0.07,
        atk: 0.12,
        detune: rand(-12, 12),
        dest: lp,
      });
    }
  },
  'crowd-clap': (v, p) => {
    const count = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i += 1) {
      burst(v, {
        // Claps spread over the whole half second, so the effect always lasts its full length.
        t: p.t + (i / (count - 1)) * 0.44 + rand(0, 0.02),
        dur: rand(0.025, 0.04),
        peak: rand(0.08, 0.16),
        type: 'bandpass',
        f: rand(1500, 2800),
        q: 1.2,
        atk: 0.001,
      });
    }
  },

  fail: (v, p) => {
    burst(v, { t: p.t, dur: 0.55, peak: 0.22, type: 'bandpass', f: 4500, to: 180, q: 6, atk: 0.01 });
    const lp = v.filter('lowpass', 1800, 0.8);
    sweep(lp.frequency, p.t, 1800, 300, 1.3);
    lp.connect(v.out);
    for (const f of [220, 261.63, 329.63]) {
      for (const cents of [-12, 13]) {
        note(v, {
          type: 'sawtooth',
          f: f * p.k,
          to: (f * p.k) / 2,
          t: p.t + 0.05,
          dur: 1.3,
          fdur: 1.25,
          peak: 0.06,
          atk: 0.03,
          detune: cents,
          dest: lp,
        });
      }
    }
  },
  'word-complete': (v, p) => {
    bell(v, 1174.7 * p.k, p.t, 0.12, 0.14);
    bell(v, 1568 * p.k, p.t + 0.06, 0.12, 0.16);
  },
  whoosh: (v, p) => {
    burst(v, {
      t: p.t,
      dur: 0.35,
      peak: 0.2,
      type: 'bandpass',
      f: 400 * p.k,
      to: 3500 * p.k,
      q: 1.4,
      contour: [[0.14, 0.2], [0.35, 0]],
    });
    burst(v, {
      t: p.t,
      dur: 0.3,
      peak: 0.06,
      type: 'highpass',
      f: 2500,
      contour: [[0.12, 0.06], [0.3, 0]],
    });
  },
  attack: (v, p) => {
    const stop = p.t + 0.43;
    const square = v.osc('square', 1800 * p.k, p.t, stop);
    sweep(square.frequency, p.t, 1800 * p.k, 120 * p.k, 0.4);
    const mod = v.osc('sine', 260, p.t, stop);
    sweep(mod.frequency, p.t, 260, 70, 0.4);
    const ring = v.gain(0);
    mod.connect(ring.gain);
    square.connect(ring);
    const lp = v.filter('lowpass', 6000, 0.7);
    const g = v.gain(FLOOR);
    ring.connect(lp);
    lp.connect(g);
    g.connect(v.out);
    env(g.gain, p.t, 0.26, 0.004, 0.4);
    burst(v, { t: p.t, dur: 0.04, peak: 0.1, type: 'bandpass', f: 5000, q: 2, atk: 0.001 });
  },
  riff: (v, p) => {
    const lick = [
      { m: 52, at: 0, dur: 0.2 },
      { m: 55, at: 0.18, dur: 0.2 },
      { m: 57, at: 0.36, dur: 0.34 },
    ];
    for (const n of lick) {
      distChord(v, [midiHz(n.m) * p.k], p.t + n.at, n.dur, 0.24, 6, 2800 * p.bright);
    }
  },
};

export const SFX_NAMES: readonly SfxName[] = Object.freeze(Object.keys(BUILDERS) as SfxName[]);

const HIT_NAMES: ReadonlySet<SfxName> = new Set<SfxName>(['hit-perfect', 'hit-great', 'hit-good']);

function resolve(ctx: AudioContext, o: SfxOptions): Params {
  const now = ctx.currentTime;
  const inten = clamp(num(o.intensity, 0.5), 0, 1);
  return {
    t: Math.max(num(o.at, now), now),
    pan: clamp(num(o.pan, 0), -1, 1),
    inten,
    k: 2 ** (clamp(num(o.pitch, 0), -24, 24) / 12),
    lane: num(o.lane, 0),
    bright: 0.7 + 0.6 * inten,
    lvl: 0.7 + 0.6 * inten,
  };
}

function resumeQuietly(ctx: AudioContext): void {
  Promise.resolve(ctx.resume()).catch(noop);
}

function smooth(param: AudioParam, target: number, now: number, constant = 0.1): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(target, now, constant);
}

/** Loudness trims measured from offline renders, so quiet ticks stay audible over the music. */
const TRIM: Partial<Record<SfxName, number>> = {
  'ui-move': 3.2, 'ui-toggle': 3, 'ui-select': 1.7, 'ui-back': 1.7, 'ui-error': 2,
  'hit-perfect': 2.6, 'hit-great': 2.6, 'hit-good': 2.6, miss: 1.4, wrong: 1.6, 'combo-break': 2.2,
  'mult-up': 3.2, 'sustain-end': 2, 'count-tick': 3.6, 'count-go': 3, 'score-tick': 3.2, 'xp-tick': 3.2,
  star: 1.7, 'grade-stamp': 2.2, 'crowd-clap': 2.6, 'crowd-cheer': 1.6, 'crowd-boo': 1.9, attack: 2.2, whoosh: 1.4, fail: 1.3,
};

export class Sfx {
  enabled = true;
  hitSounds = true;
  private ctxRef: AudioContext | null = null;
  private owned = false;
  private disposed = false;
  private bus: Bus | null = null;
  private level = 0.7;

  constructor(context?: AudioContext) {
    if (context) this.ctxRef = context;
  }

  get context(): AudioContext | null {
    return this.ctxRef;
  }

  get volume(): number {
    return this.level;
  }

  set volume(value: number) {
    this.level = clamp(num(value, this.level), 0, 1);
    const bus = this.bus;
    if (!bus) return;
    try {
      const now = bus.ctx.currentTime;
      bus.master.gain.cancelScheduledValues(now);
      bus.master.gain.setTargetAtTime(this.level, now, 0.02);
    } catch {
      noop();
    }
  }

  attach(context: AudioContext): void {
    this.disposed = false;
    if (context === this.ctxRef) return;
    this.teardown();
    this.closeOwned();
    this.ctxRef = context;
    this.owned = false;
  }

  play(name: SfxName, options: SfxOptions = {}): void {
    if (!this.enabled) return;
    if (!this.hitSounds && HIT_NAMES.has(name)) return;
    let voice: Voice | null = null;
    try {
      const build = BUILDERS[name];
      if (!build) return;
      const ctx = this.ensureContext();
      if (!ctx || ctx.state === 'closed') return;
      if (ctx.state !== 'running') resumeQuietly(ctx);
      const bus = this.busFor(ctx);
      if (bus.active >= MAX_VOICES) return;
      const params = resolve(ctx, options ?? {});
      voice = new Voice(ctx, bus, params.lvl * (TRIM[name] ?? 1), params.pan);
      build(voice, params);
      voice.seal();
    } catch {
      voice?.dispose();
    }
  }

  crowd(level: number): void {
    try {
      const ctx = this.ctxRef;
      if (!ctx || this.disposed || ctx.state === 'closed') return;
      const target = this.enabled ? clamp(num(level, 0), 0, 1) : 0;
      const bus = this.busFor(ctx);
      let bed = bus.crowd;
      if (!bed) {
        if (target <= 0) return;
        if (ctx.state !== 'running') resumeQuietly(ctx);
        bed = this.startBed(ctx, bus);
        bus.crowd = bed;
      } else if (Math.abs(bed.level - target) < 0.002) {
        return;
      }
      bed.level = target;
      const now = ctx.currentTime;
      smooth(bed.gain.gain, target * CROWD_MAX, now);
      smooth(bed.depth.gain, target * CROWD_MAX * 0.35, now);
      smooth(bed.band.frequency, 700 + target * 1900, now);
    } catch {
      noop();
    }
  }

  stopCrowd(): void {
    const bus = this.bus;
    const bed = bus?.crowd;
    if (!bus || !bed) return;
    bus.crowd = null;
    try {
      const now = bus.ctx.currentTime;
      smooth(bed.gain.gain, 0, now, 0.05);
      bed.voice.stopAt(now + 0.3);
    } catch {
      bed.voice.dispose();
    }
  }

  dispose(): void {
    this.teardown();
    this.closeOwned();
    this.ctxRef = null;
    this.disposed = true;
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctxRef && this.ctxRef.state !== 'closed') return this.ctxRef;
    this.ctxRef = null;
    const scope = globalThis as unknown as {
      AudioContext?: new () => AudioContext;
      webkitAudioContext?: new () => AudioContext;
    };
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Ctor) return null;
    this.ctxRef = new Ctor();
    this.owned = true;
    return this.ctxRef;
  }

  private busFor(ctx: AudioContext): Bus {
    if (this.bus && this.bus.ctx === ctx) return this.bus;
    const master = ctx.createGain();
    master.gain.value = this.level;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.bus = { ctx, master, comp, active: 0, crowd: null };
    return this.bus;
  }

  private startBed(ctx: AudioContext, bus: Bus): CrowdBed {
    const voice = new Voice(ctx, bus, 1, 0);
    try {
      const now = ctx.currentTime;
      const band = voice.filter('bandpass', 700, 0.5);
      const gain = voice.gain(0);
      const depth = voice.gain(0);
      band.connect(gain);
      gain.connect(voice.out);
      depth.connect(gain.gain);
      voice.noise(now, undefined, 'pink').connect(band);
      voice.osc('sine', 0.4, now).connect(depth);
      return { voice, gain, depth, band, level: -1 };
    } catch (error) {
      voice.stopAt(ctx.currentTime);
      voice.dispose();
      throw error;
    }
  }

  private teardown(): void {
    this.stopCrowd();
    const bus = this.bus;
    this.bus = null;
    if (!bus) return;
    for (const node of [bus.master, bus.comp]) {
      try {
        node.disconnect();
      } catch {
        noop();
      }
    }
  }

  private closeOwned(): void {
    const ctx = this.ctxRef;
    if (!ctx || !this.owned) return;
    this.owned = false;
    try {
      Promise.resolve(ctx.close()).catch(noop);
    } catch {
      noop();
    }
  }
}

export const sfx = new Sfx();
