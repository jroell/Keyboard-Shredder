export async function withAudioDeadline<T>(operation: Promise<T>, message: string) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), 8000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class Transport {
  private source: AudioBufferSourceNode | null = null;
  private leadSource: AudioBufferSourceNode | null = null;
  private leadGain: GainNode | null = null;
  private contextStart = 0;
  private offset = 0;
  private lastInputTime = -Infinity;

  constructor(readonly context: AudioContext, readonly buffer: AudioBuffer, readonly leadBuffer?: AudioBuffer,
    private readonly output: AudioNode = context.destination) {}

  async start(offset = 0, countInMs = 650, scheduledAt?: number) {
    if (this.context.state !== 'running') {
      await withAudioDeadline(this.context.resume(), 'Audio did not resume. Press Play to try again.');
    }
    this.stop();
    this.lastInputTime = -Infinity;
    if (this.context.state !== 'running') throw new Error('Audio could not start. Press Play to try again.');
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output);
    this.source = source;
    const current = this.context.currentTime;
    const latency = scheduledAt === undefined ? 0 : (this.context.baseLatency || 0) + (this.context.outputLatency || 0);
    const delay = scheduledAt === undefined ? countInMs : scheduledAt - performance.now();
    const target = current + delay / 1000 - latency;
    this.contextStart = Math.max(current, target);
    this.offset = offset + Math.max(0, current - target) * 1000;
    source.start(this.contextStart, Math.min(this.buffer.duration, this.offset / 1000));
    if (this.leadBuffer) {
      const lead = this.context.createBufferSource();
      const gain = this.context.createGain();
      gain.gain.value = 0;
      lead.buffer = this.leadBuffer;
      lead.connect(gain);
      gain.connect(this.output);
      this.leadSource = lead;
      this.leadGain = gain;
      lead.start(this.contextStart, Math.min(this.leadBuffer.duration, this.offset / 1000));
    }
  }

  soundLead(startMs: number, endMs: number) {
    if (!this.leadGain) return;
    const toContext = (ms: number) => this.contextStart + (ms - this.offset) / 1000;
    const start = Math.max(this.context.currentTime, toContext(startMs));
    const end = toContext(endMs);
    if (end <= start) return;
    const ramp = Math.min(.005, (end - start) / 3);
    const { gain } = this.leadGain;
    gain.setValueAtTime(0, start);
    gain.linearRampToValueAtTime(1, start + ramp);
    gain.setValueAtTime(1, end - ramp);
    gain.linearRampToValueAtTime(0, end);
  }

  muteLead() {
    if (!this.leadGain) return;
    const { gain } = this.leadGain;
    const now = this.context.currentTime;
    if (typeof gain.cancelAndHoldAtTime === 'function') {
      gain.cancelAndHoldAtTime(now);
      gain.linearRampToValueAtTime(0, now + .006);
    } else {
      gain.cancelScheduledValues(now);
      gain.setTargetAtTime(0, now, .002);
    }
  }

  /** Slows the recording to a stop, like a record player losing power. */
  windDown(seconds = 0.9) {
    const now = this.context.currentTime;
    for (const source of [this.source, this.leadSource]) {
      if (!source) continue;
      source.playbackRate.setValueAtTime(1, now);
      source.playbackRate.exponentialRampToValueAtTime(0.05, now + seconds);
      source.stop(now + seconds);
    }
  }

  /** Lets the lead guitar ring without waiting for hits. */
  openLead(level = 1) {
    this.leadGain?.gain.setValueAtTime(level, this.context.currentTime);
  }

  timeMs(now = performance.now()) {
    const clockNow = performance.now();
    const contextNow = this.context.currentTime;
    const fallback = contextNow - (this.context.baseLatency || 0) - (this.context.outputLatency || 0);
    const output = this.context.getOutputTimestamp?.();
    const outputNow = output && output.contextTime > 0 && output.performanceTime > 0
      ? output.contextTime + (clockNow - output.performanceTime) / 1000 : NaN;
    const time = Math.abs(outputNow - fallback) < 0.25 ? outputNow : fallback;
    return this.offset + (time - this.contextStart) * 1000 + now - clockNow;
  }

  inputTimeMs(timestamp: number) {
    // A browser may refresh the output clock between a press and its release.
    this.lastInputTime = Math.max(this.lastInputTime, this.timeMs(timestamp));
    return this.lastInputTime;
  }

  stop() {
    this.source?.stop();
    this.source?.disconnect();
    this.source = null;
    this.leadSource?.stop();
    this.leadSource?.disconnect();
    this.leadGain?.disconnect();
    this.leadSource = null;
    this.leadGain = null;
  }
}
