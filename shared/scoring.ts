import type { SongEvent } from './song';

export type Judgement = 'Perfect' | 'Good' | 'Miss' | 'Sustain dropped' | 'Wrong key';
type Feedback = { judgement: Judgement; timeMs: number; lanes: number[]; offsetMs?: number };

export const DEFAULT_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];

export class Scoring {
  readonly held = new Set<number>();
  readonly consumed = new Set<string>();
  readonly sustaining = new Map<string, SongEvent>();
  score = 0;
  hits = 0;
  misses = 0;
  wrongKeys = 0;
  combo = 0;
  bestCombo = 0;
  feedback: Feedback | null = null;

  get judgement() {
    return this.feedback?.judgement ?? null;
  }
  get accuracy() {
    const attempts = this.hits + this.misses + this.wrongKeys;
    return attempts ? Math.round(this.hits * 100 / attempts) : 0;
  }

  private regripUntil = -Infinity;
  private cursor = 0;
  private chord: { event: SongEvent; lanes: Set<number>; firstMs: number; offsetMs: number } | null = null;

  constructor(readonly events: SongEvent[], readonly windowMs = 95) {}

  tick(timeMs: number) {
    if (this.chord && timeMs - this.chord.firstMs > 55) {
      this.miss(this.chord.event, timeMs);
      this.chord = null;
    }
    while (this.cursor < this.events.length && this.events[this.cursor].timeMs + this.windowMs < timeMs) {
      const event = this.events[this.cursor++];
      if (!this.consumed.has(event.id)) this.miss(event, timeMs);
    }
    for (const [id, event] of this.sustaining) {
      const ended = timeMs >= event.timeMs + event.durationMs;
      if (!event.lanes.every(lane => this.held.has(lane))) {
        if (ended || timeMs > this.regripUntil) this.dropSustain(event, timeMs);
      } else if (ended) {
        this.score += 30;
        this.sustaining.delete(id);
      }
    }
  }

  press(lane: number, timeMs: number) {
    if (this.held.has(lane)) return;
    this.tick(timeMs);
    this.held.add(lane);
    const event = this.chord?.event ?? this.nearest(lane, timeMs);
    if (!event || this.consumed.has(event.id) || !event.lanes.includes(lane)) {
      if (timeMs <= this.regripUntil && [...this.sustaining.values()].some(held => held.lanes.includes(lane))) return;
      this.wrongKeys++;
      this.combo = 0;
      this.feedback = { judgement: 'Wrong key', lanes: [lane], timeMs };
      return;
    }
    const offset = timeMs - event.timeMs;
    if (!this.chord) this.chord = { event, firstMs: timeMs, lanes: new Set(), offsetMs: offset };
    if (Math.abs(offset) > Math.abs(this.chord.offsetMs)) this.chord.offsetMs = offset;
    this.chord.lanes.add(lane);
    if (!event.lanes.every(key => this.chord!.lanes.has(key) && this.held.has(key))) return;
    const offsetMs = Math.round(this.chord.offsetMs);
    const perfect = Math.abs(this.chord.offsetMs) <= 45;
    this.consumed.add(event.id);
    this.chord = null;
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += (perfect ? 100 : 70) * Math.min(4, 1 + Math.floor((this.combo - 1) / 10));
    if (event.durationMs) this.sustaining.set(event.id, event);
    this.feedback = { judgement: perfect ? 'Perfect' : 'Good', offsetMs, lanes: event.lanes, timeMs };
  }

  release(lane: number, timeMs: number) {
    this.tick(timeMs);
    this.held.delete(lane);
    for (const [id, event] of this.sustaining) {
      if (event.lanes.includes(lane)) {
        if (timeMs <= this.regripUntil) continue;
        if (timeMs >= event.timeMs + event.durationMs - 50) {
          this.score += 30;
          this.sustaining.delete(id);
        } else this.dropSustain(event, timeMs);
      }
    }
  }

  regrip(lane: number) {
    if ([...this.sustaining.values()].some(event => event.lanes.includes(lane))) this.held.add(lane);
  }

  pause(timeMs: number) {
    this.tick(timeMs);
    this.held.clear();
    this.chord = null;
    this.feedback = null;
    this.regripUntil = timeMs + 150;
  }

  private dropSustain(event: SongEvent, timeMs: number) {
    this.sustaining.delete(event.id);
    this.combo = 0;
    this.feedback = { judgement: 'Sustain dropped', lanes: event.lanes, timeMs };
  }

  finish() {
    this.tick(Infinity);
  }

  private nearest(lane: number, timeMs: number) {
    let best: SongEvent | undefined;
    let distance = this.windowMs + 1;
    for (let i = this.cursor; i < this.events.length; i++) {
      const event = this.events[i];
      if (event.timeMs > timeMs + this.windowMs) break;
      const delta = Math.abs(event.timeMs - timeMs);
      if (delta < distance && !this.consumed.has(event.id) && event.lanes.includes(lane)) {
        best = event;
        distance = delta;
      }
    }
    return best;
  }

  private miss(event: SongEvent, timeMs: number) {
    if (this.consumed.has(event.id)) return;
    this.consumed.add(event.id);
    if (this.chord?.event.id === event.id) this.chord = null;
    this.misses++;
    this.combo = 0;
    this.feedback = { judgement: 'Miss', lanes: event.lanes, timeMs };
  }
}
