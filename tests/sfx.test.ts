import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sfx, SFX_NAMES, sfx, type SfxName } from '../src/game/sfx';

type ParamEvent = { kind: 'set' | 'linear' | 'exp' | 'target'; value: number; time: number; constant?: number };

class FakeParam {
  events: ParamEvent[] = [];
  cancels: number[] = [];

  constructor(public value: number, private readonly violations: string[]) {}

  private record(kind: ParamEvent['kind'], value: number, time: number, constant?: number): this {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      this.violations.push(`${kind} ramp got non-finite value ${value} at ${time}`);
    }
    this.events.push({ kind, value, time, constant });
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    return this.record('set', value, time);
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.record('linear', value, time);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    const last = this.events.length ? this.events[this.events.length - 1].value : this.value;
    if (!(value > 0)) {
      this.violations.push(`exponential ramp target ${value} at ${time}`);
      throw new RangeError(`exponential ramp target must be above 0, got ${value}`);
    }
    if (!(last > 0)) this.violations.push(`exponential ramp starts from ${last}`);
    return this.record('exp', value, time);
  }

  setTargetAtTime(value: number, time: number, constant: number): this {
    return this.record('target', value, time, constant);
  }

  cancelScheduledValues(time: number): this {
    this.cancels.push(time);
    return this;
  }
}

class FakeNode {
  outputs: unknown[] = [];
  disconnected = false;

  constructor(readonly ctx: FakeContext) {}

  protected param(value: number): FakeParam {
    return new FakeParam(value, this.ctx.violations);
  }

  connect<T>(destination: T): T {
    if (!(destination instanceof FakeNode) && !(destination instanceof FakeParam)) {
      throw new TypeError('connect needs an audio node or an audio param');
    }
    this.outputs.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  gain = this.param(1);
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = this.param(350);
  Q = this.param(1);
  gain = this.param(0);
  detune = this.param(0);
}

class FakeCompressor extends FakeNode {
  threshold = this.param(-24);
  knee = this.param(30);
  ratio = this.param(12);
  attack = this.param(0.003);
  release = this.param(0.25);
}

class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}

class FakePanner extends FakeNode {
  pan = this.param(0);
}

class FakeDelay extends FakeNode {
  delayTime = this.param(0);
}

class FakeSource extends FakeNode {
  type = 'sine';
  loop = false;
  buffer: unknown = null;
  frequency = this.param(440);
  detune = this.param(0);
  playbackRate = this.param(1);
  startedAt: number | undefined;
  stoppedAt: number | undefined;
  ended = false;
  onended: (() => void) | null = null;

  start(when = 0): void {
    if (this.startedAt !== undefined) {
      this.ctx.violations.push('start called twice');
      throw new Error('InvalidStateError: start called twice');
    }
    this.startedAt = when;
  }

  stop(when = 0): void {
    if (this.startedAt === undefined) {
      this.ctx.violations.push('stop called before start');
      throw new Error('InvalidStateError: stop called before start');
    }
    this.stoppedAt = when;
  }

  finish(): void {
    this.ended = true;
    this.onended?.();
  }
}

class FakeContext {
  currentTime = 1;
  sampleRate = 44100;
  state: 'running' | 'suspended' | 'closed' = 'running';
  nodes: FakeNode[] = [];
  violations: string[] = [];
  buffersCreated = 0;
  resumeCalls = 0;
  closeCalls = 0;
  destination = new FakeNode(this);

  private make<T extends FakeNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  createGain() {
    return this.make(new FakeGain(this));
  }

  createOscillator() {
    return this.make(new FakeSource(this));
  }

  createBiquadFilter() {
    return this.make(new FakeFilter(this));
  }

  createBufferSource() {
    return this.make(new FakeSource(this));
  }

  createDynamicsCompressor() {
    return this.make(new FakeCompressor(this));
  }

  createWaveShaper() {
    return this.make(new FakeShaper(this));
  }

  createStereoPanner() {
    return this.make(new FakePanner(this));
  }

  createDelay() {
    return this.make(new FakeDelay(this));
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    this.buffersCreated += 1;
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => data,
    };
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  get sources(): FakeSource[] {
    return this.nodes.filter((node): node is FakeSource => node instanceof FakeSource);
  }

  get compressor(): FakeCompressor {
    const found = this.nodes.find((node): node is FakeCompressor => node instanceof FakeCompressor);
    assert.ok(found, 'the engine created a compressor');
    return found;
  }

  get master(): FakeGain {
    const comp = this.compressor;
    const found = this.nodes.find((node): node is FakeGain => node instanceof FakeGain && node.outputs.includes(comp));
    assert.ok(found, 'the engine created a master gain feeding the compressor');
    return found;
  }

  finishAll(): void {
    for (const source of this.sources) if (source.startedAt !== undefined && !source.ended) source.finish();
  }

  voiceNodes(): FakeNode[] {
    const bus = new Set<FakeNode>([this.master, this.compressor]);
    return this.nodes.filter((node) => !bus.has(node));
  }

  maxGainPeak(): number {
    let peak = 0;
    for (const node of this.nodes) {
      if (!(node instanceof FakeGain)) continue;
      for (const event of node.gain.events) {
        if (event.kind === 'linear' || event.kind === 'set') peak = Math.max(peak, event.value);
      }
    }
    return peak;
  }
}

function setup(configure?: (ctx: FakeContext) => void) {
  const ctx = new FakeContext();
  configure?.(ctx);
  const engine = new Sfx(ctx as unknown as AudioContext);
  return { ctx, engine };
}

const DESIGN_MS: Record<SfxName, number> = {
  'ui-move': 40,
  'ui-select': 120,
  'ui-back': 110,
  'ui-error': 180,
  'ui-toggle': 60,
  'hit-perfect': 140,
  'hit-great': 130,
  'hit-good': 120,
  miss: 160,
  wrong: 90,
  'combo-break': 280,
  'combo-milestone': 450,
  'mult-up': 150,
  'boost-ready': 500,
  'boost-on': 1100,
  'boost-off': 600,
  'sustain-end': 120,
  'count-tick': 60,
  'count-go': 300,
  star: 500,
  'star-gold': 1200,
  'score-tick': 25,
  'grade-stamp': 350,
  'new-record': 900,
  'level-up': 1300,
  unlock: 800,
  achievement: 700,
  'xp-tick': 25,
  'crowd-cheer': 1600,
  'crowd-roar': 2800,
  'crowd-boo': 1500,
  'crowd-clap': 500,
  fail: 1400,
  'word-complete': 180,
  whoosh: 350,
  attack: 400,
  riff: 700,
};

test('Importing the sound module in Node does not throw and play() does nothing without Web Audio', () => {
  assert.equal(typeof (globalThis as { AudioContext?: unknown }).AudioContext, 'undefined');
  assert.doesNotThrow(() => sfx.play('ui-select'));
  assert.doesNotThrow(() => sfx.crowd(0.5));
  assert.doesNotThrow(() => sfx.stopCrowd());
  assert.equal(sfx.context, null);
});

test('The shared instance creates its own AudioContext on the first play() when none was attached', () => {
  const scope = globalThis as { AudioContext?: unknown };
  const created: FakeContext[] = [];
  scope.AudioContext = class extends FakeContext {
    constructor() {
      super();
      created.push(this);
    }
  };
  try {
    const engine = new Sfx();
    assert.equal(engine.context, null);
    engine.play('hit-perfect');
    assert.equal(created.length, 1);
    assert.equal(engine.context, created[0] as unknown as AudioContext);
    assert.ok(created[0].sources.length > 0);
    engine.play('hit-great');
    assert.equal(created.length, 1);
  } finally {
    delete scope.AudioContext;
  }
});

test('SFX_NAMES lists the 37 effects once each', () => {
  assert.equal(SFX_NAMES.length, 37);
  assert.equal(new Set(SFX_NAMES).size, SFX_NAMES.length);
  assert.deepEqual([...SFX_NAMES].sort(), (Object.keys(DESIGN_MS) as SfxName[]).sort());
});

test('Every effect schedules at least one started and stopped source node without throwing', () => {
  for (const name of SFX_NAMES) {
    const { ctx, engine } = setup();
    assert.doesNotThrow(() => engine.play(name), name);
    assert.ok(ctx.sources.length > 0, `${name} schedules a source`);
    for (const source of ctx.sources) {
      assert.notEqual(source.startedAt, undefined, `${name} starts every source`);
      assert.notEqual(source.stoppedAt, undefined, `${name} stops every source`);
    }
  }
});

test('Every effect ends within 150 ms of its designed length and never ends early by more than 60 ms', () => {
  for (const name of SFX_NAMES) {
    const { ctx, engine } = setup();
    engine.play(name, { at: 1 });
    const end = Math.max(...ctx.sources.map((source) => source.stoppedAt ?? 0)) - 1;
    const design = DESIGN_MS[name] / 1000;
    assert.ok(end <= design + 0.15, `${name} ends at ${(end * 1000).toFixed(0)} ms, design ${DESIGN_MS[name]} ms`);
    assert.ok(end >= design - 0.06, `${name} ends at ${(end * 1000).toFixed(0)} ms, design ${DESIGN_MS[name]} ms`);
  }
});

test('Exponential ramps never target zero or start from zero and no automation value is non-finite', () => {
  const variants = [
    {},
    { intensity: 0, lane: 0, pitch: -12, pan: -1 },
    { intensity: 1, lane: 9, pitch: 12, pan: 1 },
    { intensity: 0.5, lane: 4, pitch: 24, at: 3 },
    { intensity: Number.NaN, lane: Number.NaN, pitch: Number.NaN, pan: Number.NaN, at: Number.NaN },
  ];
  for (const name of SFX_NAMES) {
    for (const options of variants) {
      for (let run = 0; run < 3; run += 1) {
        const { ctx, engine } = setup();
        engine.play(name, options);
        assert.deepEqual(ctx.violations, [], `${name} ${JSON.stringify(options)}`);
        assert.ok(ctx.sources.length > 0, `${name} built every voice node`);
      }
    }
  }
});

test('Setting enabled to false schedules nothing and creates no audio nodes', () => {
  const { ctx, engine } = setup();
  engine.enabled = false;
  for (const name of SFX_NAMES) engine.play(name);
  assert.equal(ctx.nodes.length, 0);
  engine.enabled = true;
  engine.play('ui-select');
  assert.ok(ctx.sources.length > 0);
});

test('Setting hitSounds to false skips only hit-perfect, hit-great and hit-good', () => {
  const hits: SfxName[] = ['hit-perfect', 'hit-great', 'hit-good'];
  for (const name of SFX_NAMES) {
    const { ctx, engine } = setup();
    engine.hitSounds = false;
    engine.play(name);
    if (hits.includes(name)) assert.equal(ctx.sources.length, 0, `${name} is skipped`);
    else assert.ok(ctx.sources.length > 0, `${name} still plays`);
  }
});

test('Hit sounds pick E minor pentatonic notes from E4 by lane and shift by semitones', () => {
  const pluckFrequency = (options: Parameters<Sfx['play']>[1]) => {
    const { ctx, engine } = setup();
    engine.play('hit-perfect', options);
    const saw = ctx.sources.find((source) => source.type === 'sawtooth');
    assert.ok(saw, 'the pluck uses a sawtooth');
    return saw.frequency.value;
  };
  const e4 = 440 * 2 ** (-5 / 12);
  assert.ok(Math.abs(pluckFrequency({ lane: 0 }) - e4) < 0.01);
  assert.ok(Math.abs(pluckFrequency({ lane: 1 }) - e4 * 2 ** (3 / 12)) < 0.01);
  assert.ok(Math.abs(pluckFrequency({ lane: 4 }) - e4 * 2 ** (10 / 12)) < 0.01);
  assert.ok(Math.abs(pluckFrequency({ lane: 5 }) - e4 * 2) < 0.01);
  assert.ok(Math.abs(pluckFrequency({ lane: 0, pitch: 12 }) - e4 * 2) < 0.01);
});

test('Hit sounds get quieter and darker from perfect to great to good and stay near 0.3 gain or below', () => {
  const peaks = (['hit-perfect', 'hit-great', 'hit-good'] as const).map((name) => {
    const { ctx, engine } = setup();
    engine.play(name);
    return ctx.maxGainPeak();
  });
  assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2], `peaks ${peaks.join(', ')}`);
  assert.ok(peaks[0] <= 0.3 && peaks[0] >= 0.25);
  assert.ok(peaks[2] >= 0.15);
});

test('No single envelope goes above 0.5 gain for any effect at default settings', () => {
  for (const name of SFX_NAMES) {
    const { ctx, engine } = setup();
    engine.play(name);
    assert.ok(ctx.maxGainPeak() <= 0.5, `${name} peaks at ${ctx.maxGainPeak()}`);
  }
});

test('The at option starts every source at that time and a time in the past starts at the current time', () => {
  const future = setup();
  future.engine.play('level-up', { at: 4.5 });
  assert.ok(future.ctx.sources.every((source) => (source.startedAt ?? 0) >= 4.5));
  const past = setup();
  past.engine.play('level-up', { at: 0.2 });
  assert.ok(past.ctx.sources.every((source) => (source.startedAt ?? 0) >= 1));
});

test('A higher intensity adds notes to combo-milestone and makes combo-break louder', () => {
  const low = setup();
  low.engine.play('combo-milestone', { intensity: 0 });
  const high = setup();
  high.engine.play('combo-milestone', { intensity: 1 });
  assert.ok(high.ctx.sources.length > low.ctx.sources.length);
  const lowFreq = Math.min(...low.ctx.sources.map((source) => source.frequency.value));
  const highFreq = Math.min(...high.ctx.sources.map((source) => source.frequency.value));
  assert.ok(highFreq > lowFreq, 'the arpeggio starts on a higher note');

  const soft = setup();
  soft.engine.play('combo-break', { intensity: 0 });
  const loud = setup();
  loud.engine.play('combo-break', { intensity: 1 });
  assert.ok(loud.ctx.maxGainPeak() > soft.ctx.maxGainPeak());
});

test('The pan option adds a stereo panner set to that position and pan 0 adds none', () => {
  const centered = setup();
  centered.engine.play('hit-good');
  assert.equal(centered.ctx.nodes.filter((node) => node instanceof FakePanner).length, 0);
  const side = setup();
  side.engine.play('hit-good', { pan: -0.6 });
  const panners = side.ctx.nodes.filter((node): node is FakePanner => node instanceof FakePanner);
  assert.equal(panners.length, 1);
  assert.equal(panners[0].pan.value, -0.6);
});

test('All output reaches the destination only through one master gain and one compressor', () => {
  const { ctx, engine } = setup();
  for (const name of SFX_NAMES) engine.play(name);
  engine.crowd(0.6);
  const { master, compressor } = ctx;
  const intoDestination = ctx.nodes.filter((node) => node.outputs.includes(ctx.destination));
  assert.deepEqual(intoDestination, [compressor]);
  const intoCompressor = ctx.nodes.filter((node) => node.outputs.includes(compressor));
  assert.deepEqual(intoCompressor, [master]);
  assert.equal(ctx.nodes.filter((node) => node instanceof FakeCompressor).length, 1);
  assert.ok(ctx.nodes.some((node) => node !== master && node.outputs.includes(master)), 'voices feed the master gain');
});

test('Every voice disconnects all of its nodes once its sources have ended', () => {
  const { ctx, engine } = setup();
  for (const name of SFX_NAMES) engine.play(name, { pan: 0.3 });
  assert.ok(ctx.voiceNodes().some((node) => !node.disconnected));
  ctx.finishAll();
  const leaked = ctx.voiceNodes().filter((node) => !node.disconnected);
  assert.equal(leaked.length, 0);
  assert.equal(ctx.master.disconnected, false);
  assert.equal(ctx.compressor.disconnected, false);
});

test('Eight hundred hits over a song leave no connected nodes behind after they finish', () => {
  const { ctx, engine } = setup();
  for (let i = 0; i < 800; i += 1) {
    engine.play(i % 3 === 0 ? 'hit-perfect' : 'hit-great', { lane: i % 10, pan: ((i % 10) - 4.5) / 4.5 });
    ctx.currentTime += 0.3;
    ctx.finishAll();
  }
  assert.equal(ctx.voiceNodes().filter((node) => !node.disconnected).length, 0);
});

test('Playing hundreds of effects at once is capped and sound resumes after voices finish', () => {
  const { ctx, engine } = setup();
  for (let i = 0; i < 500; i += 1) engine.play('score-tick');
  const scheduled = ctx.sources.length;
  assert.ok(scheduled > 0 && scheduled < 500, `${scheduled} sources scheduled`);
  ctx.finishAll();
  engine.play('score-tick');
  assert.equal(ctx.sources.length, scheduled + 1);
});

test('Noise buffers are created once per context and reused by later effects', () => {
  const { ctx, engine } = setup();
  for (let i = 0; i < 6; i += 1) engine.play('whoosh');
  assert.equal(ctx.buffersCreated, 1);
  engine.play('crowd-clap');
  assert.equal(ctx.buffersCreated, 1);
  engine.play('crowd-cheer');
  engine.play('crowd-boo');
  assert.equal(ctx.buffersCreated, 2);
});

test('A suspended context is resumed once per play call without waiting and the sound is still scheduled', () => {
  const { ctx, engine } = setup((c) => {
    c.state = 'suspended';
  });
  engine.play('ui-select');
  assert.equal(ctx.resumeCalls, 1);
  assert.ok(ctx.sources.length > 0);
});

test('A closed context makes play() and crowd() do nothing', () => {
  const { ctx, engine } = setup((c) => {
    c.state = 'closed';
  });
  assert.doesNotThrow(() => engine.play('level-up'));
  assert.doesNotThrow(() => engine.crowd(1));
  assert.equal(ctx.nodes.length, 0);
});

test('A node that fails to build does not throw and the half-built voice is disconnected', () => {
  const { ctx, engine } = setup();
  engine.play('ui-select');
  ctx.createOscillator = () => {
    throw new Error('the browser refused to create an oscillator');
  };
  const before = ctx.nodes.length;
  assert.doesNotThrow(() => engine.play('hit-perfect'));
  const added = ctx.nodes.slice(before);
  assert.ok(added.length > 0);
  assert.ok(added.every((node) => node.disconnected));
});

test('A resume() that rejects does not surface an error', async () => {
  const { ctx, engine } = setup((c) => {
    c.state = 'suspended';
    c.resume = () => Promise.reject(new Error('autoplay blocked'));
  });
  engine.play('ui-select');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(ctx.sources.length > 0);
});

test('The master volume starts at 0.7, ramps to a new value and clamps to the 0 to 1 range', () => {
  const { ctx, engine } = setup();
  assert.equal(engine.volume, 0.7);
  engine.play('ui-move');
  assert.equal(ctx.master.gain.value, 0.7);
  engine.volume = 0.3;
  const last = ctx.master.gain.events[ctx.master.gain.events.length - 1];
  assert.equal(last.kind, 'target');
  assert.equal(last.value, 0.3);
  engine.volume = 4;
  assert.equal(engine.volume, 1);
  engine.volume = -2;
  assert.equal(engine.volume, 0);
});

test('crowd(0.5) starts one looping noise source and stopCrowd() stops it', () => {
  const { ctx, engine } = setup();
  engine.crowd(0.5);
  const loops = () => ctx.sources.filter((source) => source.loop);
  assert.equal(loops().length, 1);
  assert.notEqual(loops()[0].startedAt, undefined);
  assert.equal(loops()[0].stoppedAt, undefined);
  engine.crowd(0.5);
  engine.crowd(0.51);
  assert.equal(loops().length, 1, 'repeated calls reuse the bed');
  engine.stopCrowd();
  assert.notEqual(loops()[0].stoppedAt, undefined);
  assert.ok((loops()[0].stoppedAt ?? 0) >= ctx.currentTime);
  assert.equal(loops().length, 1);
  ctx.finishAll();
  assert.equal(ctx.voiceNodes().filter((node) => !node.disconnected).length, 0);
});

test('crowd() sets the bed gain between 0 and 0.22 with a smoothing time near 300 ms', () => {
  const { ctx, engine } = setup();
  engine.crowd(1);
  const band = ctx.sources.find((source) => source.loop)?.outputs[0] as FakeFilter;
  const bed = band.outputs[0] as FakeGain;
  const target = bed.gain.events.filter((event) => event.kind === 'target');
  assert.ok(target.length > 0);
  assert.ok(Math.abs(target[target.length - 1].value - 0.22) < 1e-9);
  const constant = target[target.length - 1].constant ?? 0;
  assert.ok(constant * 3 >= 0.2 && constant * 3 <= 0.4, `3 time constants = ${constant * 3} s`);
  engine.crowd(0.25);
  const next = bed.gain.events.filter((event) => event.kind === 'target').pop();
  assert.ok(next && next.value > 0 && next.value < 0.22);
  engine.crowd(0);
  const silent = bed.gain.events.filter((event) => event.kind === 'target').pop();
  assert.equal(silent?.value, 0);
});

test('crowd(0) without a running bed starts nothing and a disabled engine silences the bed', () => {
  const { ctx, engine } = setup();
  engine.crowd(0);
  assert.equal(ctx.sources.length, 0);
  engine.crowd(0.8);
  const band = ctx.sources.find((source) => source.loop)?.outputs[0] as FakeFilter;
  const bed = band.outputs[0] as FakeGain;
  engine.enabled = false;
  engine.crowd(0.8);
  const last = bed.gain.events.filter((event) => event.kind === 'target').pop();
  assert.equal(last?.value, 0);
});

test('Attaching a new context stops the crowd bed on the old one and later sounds use the new context', () => {
  const first = setup();
  first.engine.crowd(0.7);
  const second = new FakeContext();
  first.engine.attach(second as unknown as AudioContext);
  assert.notEqual(first.ctx.sources.find((source) => source.loop)?.stoppedAt, undefined);
  first.engine.play('ui-select');
  assert.ok(second.sources.length > 0);
  assert.equal(first.engine.context, second as unknown as AudioContext);
});

test('dispose() stops sound until a context is attached again and closes only a context it created', () => {
  const { ctx, engine } = setup();
  engine.play('ui-select');
  const before = ctx.sources.length;
  engine.dispose();
  engine.play('ui-select');
  assert.equal(ctx.sources.length, before);
  assert.equal(ctx.closeCalls, 0, 'an attached context stays open');
  engine.attach(ctx as unknown as AudioContext);
  engine.play('ui-select');
  assert.ok(ctx.sources.length > before);
});
