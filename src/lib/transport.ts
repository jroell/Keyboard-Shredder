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
  private contextStart = 0;
  private offset = 0;

  constructor(readonly context: AudioContext, readonly buffer: AudioBuffer) {}

  async start(offset = 0, countInMs = 650, scheduledAt?: number) {
    if (this.context.state !== 'running') {
      await withAudioDeadline(this.context.resume(), 'Audio did not resume. Press Play to try again.');
    }
    this.stop();
    if (this.context.state !== 'running') throw new Error('Audio could not start. Press Play to try again.');
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    this.source = source;
    const current = this.context.currentTime;
    const latency = scheduledAt === undefined ? 0 : (this.context.baseLatency || 0) + (this.context.outputLatency || 0);
    const delay = scheduledAt === undefined ? countInMs : scheduledAt - performance.now();
    const target = current + delay / 1000 - latency;
    this.contextStart = Math.max(current, target);
    this.offset = offset + Math.max(0, current - target) * 1000;
    source.start(this.contextStart, Math.min(this.buffer.duration, this.offset / 1000));
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

  stop() {
    this.source?.stop();
    this.source?.disconnect();
    this.source = null;
  }
}
