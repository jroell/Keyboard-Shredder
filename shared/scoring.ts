import type { SongEvent } from './song';
import { ratingFor, type Tally } from './rating';

export type Judgement = 'Perfect' | 'Great' | 'Good' | 'Miss' | 'Sustain dropped' | 'Wrong key';
export const PERFECT_MS = 45;
export const GREAT_MS = 80;
export const POINTS = { Perfect: 100, Great: 75, Good: 50, sustain: 30 } as const;
export const BOOST_MS = 8000;
export type ScoreEvent =
  | { type: 'hit'; judgement: 'Perfect' | 'Great' | 'Good'; event: SongEvent; lanes: number[]; offsetMs: number; points: number; combo: number; multiplier: number; boosted: boolean; timeMs: number }
  | { type: 'miss'; event: SongEvent; lanes: number[]; brokeCombo: number; timeMs: number }
  | { type: 'wrong'; lanes: number[]; brokeCombo: number; timeMs: number }
  | { type: 'drop'; event: SongEvent; lanes: number[]; brokeCombo: number; timeMs: number }
  | { type: 'sustain'; event: SongEvent; lanes: number[]; points: number; timeMs: number }
  | { type: 'boost'; timeMs: number }
  | { type: 'charged'; timeMs: number };
type Feedback = { judgement: Judgement; timeMs: number; lanes: number[]; offsetMs?: number; points?: number };

export const DEFAULT_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];

export class Scoring {
  readonly held = new Set<number>();
  readonly consumed = new Set<string>();
  readonly sustaining = new Map<string, SongEvent>();
  readonly hitOffsets = new Map<string, number>();
  /** Called for every scoring change. The client uses it for effects and sound. */
  onEvent: ((event: ScoreEvent) => void) | null = null;
  score = 0;
  hits = 0;
  perfects = 0;
  greats = 0;
  goods = 0;
  sustainsHeld = 0;
  boostsUsed = 0;
  chordsHit = 0;
  misses = 0;
  wrongKeys = 0;
  combo = 0;
  bestCombo = 0;
  ampCharge = 0;
  boostHits = 0;
  crowd = 50;
  private boostUntil = -Infinity;

  get boostEndMs() { return Number.isFinite(this.boostUntil) ? this.boostUntil : null; }

  rejoin(timeMs: number, combo: number, ampCharge: number, boostEndMs: number | null) {
    while (this.cursor < this.events.length && this.events[this.cursor].timeMs < timeMs - this.windowMs) {
      this.consumed.add(this.events[this.cursor++].id);
    }
    this.combo = combo;
    this.ampCharge = ampCharge;
    this.boostUntil = boostEndMs ?? -Infinity;
  }

  boosting(timeMs: number) { return timeMs < this.boostUntil; }
  boostRemaining(timeMs: number) { return Math.max(0, this.boostUntil - timeMs); }

  activateBoost(timeMs: number) {
    if (timeMs < 0 || this.ampCharge < 100 || this.boosting(timeMs)) return false;
    this.ampCharge = 0;
    this.boostUntil = timeMs + BOOST_MS;
    this.boostsUsed++;
    this.onEvent?.({ type: 'boost', timeMs });
    return true;
  }

  multiplier(timeMs: number) {
    return Math.min(4, 1 + Math.floor(this.combo / 10)) * (this.boosting(timeMs) ? 2 : 1);
  }
  feedback: Feedback | null = null;

  get judgement() {
    return this.feedback?.judgement ?? null;
  }
  get tally(): Tally {
    return { perfects: this.perfects, greats: this.greats, goods: this.goods, misses: this.misses,
      wrongKeys: this.wrongKeys, total: this.events.length, bestCombo: this.bestCombo };
  }
  /** 0 to 100 over the whole chart. */
  get rating() { return ratingFor(this.tally); }
  /** 0 to 100 over the notes judged so far. */
  get liveRating() {
    return ratingFor({ ...this.tally, total: this.hits + this.misses });
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
      } else if (ended) this.completeSustain(id, event, timeMs);
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
      this.crowd = Math.max(0, this.crowd - 2);
      const brokeCombo = this.combo;
      this.combo = 0;
      this.feedback = { judgement: 'Wrong key', lanes: [lane], timeMs };
      this.onEvent?.({ type: 'wrong', lanes: [lane], brokeCombo, timeMs });
      return;
    }
    const offset = timeMs - event.timeMs;
    if (!this.chord) this.chord = { event, firstMs: timeMs, lanes: new Set(), offsetMs: offset };
    if (Math.abs(offset) > Math.abs(this.chord.offsetMs)) this.chord.offsetMs = offset;
    this.chord.lanes.add(lane);
    if (!event.lanes.every(key => this.chord!.lanes.has(key) && this.held.has(key))) return;
    const offsetMs = Math.round(this.chord.offsetMs);
    const distance = Math.abs(this.chord.offsetMs);
    const judgement = distance <= PERFECT_MS ? 'Perfect' : distance <= GREAT_MS ? 'Great' : 'Good';
    const perfect = judgement === 'Perfect';
    if (perfect) this.perfects++;
    else if (judgement === 'Great') this.greats++;
    else this.goods++;
    this.consumed.add(event.id);
    this.chord = null;
    this.hits++;
    this.hitOffsets.set(event.id, offsetMs);
    if (event.lanes.length > 1) this.chordsHit++;
    const boost = this.boosting(timeMs);
    const multiplier = this.multiplier(timeMs);
    const points = POINTS[judgement] * multiplier * event.lanes.length;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += points;
    this.crowd = Math.min(100, this.crowd + (perfect ? 4 : judgement === 'Great' ? 3 : 2) * (boost ? 2 : 1));
    if (boost) this.boostHits++;
    else {
      const before = this.ampCharge;
      this.ampCharge = Math.min(100, before + (perfect ? 6 : judgement === 'Great' ? 4 : 2.5) + (event.lanes.length > 1 ? 2 : 0));
      if (before < 100 && this.ampCharge === 100) this.onEvent?.({ type: 'charged', timeMs });
    }
    if (event.durationMs) this.sustaining.set(event.id, event);
    this.feedback = { judgement, offsetMs, lanes: event.lanes, timeMs, points };
    this.onEvent?.({ type: 'hit', judgement, event, lanes: event.lanes, offsetMs, points, combo: this.combo, multiplier, boosted: boost, timeMs });
    return event;
  }

  /** A key press that belongs to no lane, such as a wrong letter in a typing lesson. */
  stray(timeMs: number) {
    this.tick(timeMs);
    this.wrongKeys++;
    this.crowd = Math.max(0, this.crowd - 2);
    const brokeCombo = this.combo;
    this.combo = 0;
    this.feedback = { judgement: 'Wrong key', lanes: [], timeMs };
    this.onEvent?.({ type: 'wrong', lanes: [], brokeCombo, timeMs });
  }

  release(lane: number, timeMs: number) {
    this.tick(timeMs);
    this.held.delete(lane);
    for (const [id, event] of this.sustaining) {
      if (event.lanes.includes(lane)) {
        if (timeMs <= this.regripUntil) continue;
        if (timeMs >= event.timeMs + event.durationMs - 80) this.completeSustain(id, event, timeMs);
        else this.dropSustain(event, timeMs);
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

  private completeSustain(id: string, event: SongEvent, timeMs: number) {
    // The bonus depends only on the sustain's own end time, so a replay settles it the same way as live play.
    const points = POINTS.sustain * (this.boosting(event.timeMs + event.durationMs) ? 2 : 1);
    this.score += points;
    this.sustainsHeld++;
    this.sustaining.delete(id);
    this.onEvent?.({ type: 'sustain', event, lanes: event.lanes, points, timeMs });
  }

  private dropSustain(event: SongEvent, timeMs: number) {
    // Letting go early loses the sustain bonus but keeps the streak, as in the guitar games.
    this.sustaining.delete(event.id);
    this.feedback = { judgement: 'Sustain dropped', lanes: event.lanes, timeMs };
    this.onEvent?.({ type: 'drop', event, lanes: event.lanes, brokeCombo: 0, timeMs });
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
    this.crowd = Math.max(0, this.crowd - 6);
    const brokeCombo = this.combo;
    this.combo = 0;
    this.feedback = { judgement: 'Miss', lanes: event.lanes, timeMs };
    this.onEvent?.({ type: 'miss', event, lanes: event.lanes, brokeCombo, timeMs });
  }
}
