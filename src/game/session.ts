import type { Chart, SongEvent } from '../../shared/song';
import { Scoring, type ScoreEvent } from '../../shared/scoring';
import type { LaneInput } from '../../shared/duel';
import { Transport, withAudioDeadline } from '../lib/transport';

export type PlayerSetup = {
  events: SongEvent[];
  windowMs: number;
  /** Lane index to `KeyboardEvent.code`. */
  keys: string[];
  boostKey: string;
  /** 0 to 1. When set, the computer plays this highway. */
  bot?: number;
};

export type Match = {
  startAt: number | null; ready: boolean; ampCharge: number; boostEndMs: number | null; combo: number;
  onReady: () => Promise<void>; onInput: (input: LaneInput) => void; onBoost: (timeMs: number) => void;
};

export type SessionState = 'ready' | 'starting' | 'playing' | 'paused' | 'finished' | 'failed';
export type SessionEvent =
  | { type: 'score'; player: number; event: ScoreEvent }
  | { type: 'state'; state: SessionState }
  | { type: 'countin'; beat: number }
  | { type: 'press'; player: number; lane: number }
  | { type: 'error'; message: string };

export type InputLog = { inputs: [number, number, number][]; boosts: number[] };

type BotState = { cursor: number; releases: { lane: number; at: number }[]; jitter: number; skip: boolean };

/** Plays a highway for the attract screen, party fill-ins and automated checks. */
export function botStep(scoring: Scoring, events: SongEvent[], state: BotState, timeMs: number, skill: number, onPress?: (lane: number) => void) {
  for (let i = state.releases.length - 1; i >= 0; i--) {
    if (state.releases[i].at <= timeMs) {
      scoring.release(state.releases[i].lane, state.releases[i].at);
      state.releases.splice(i, 1);
    }
  }
  while (state.cursor < events.length) {
    const event = events[state.cursor];
    const at = event.timeMs + state.jitter;
    if (at > timeMs) break;
    state.cursor++;
    if (!state.skip && !scoring.consumed.has(event.id)) {
      for (const lane of event.lanes) {
        scoring.press(lane, at);
        onPress?.(lane);
        state.releases.push({ lane, at: at + (event.durationMs ? event.durationMs + 5 : 70) });
      }
    }
    const roll = Math.random();
    state.skip = roll > skill + (1 - skill) * 0.35;
    const spread = 18 + (1 - skill) * 110;
    state.jitter = (Math.random() + Math.random() - 1) * spread;
  }
  if (skill > 0.5 && scoring.ampCharge >= 100 && !scoring.boosting(timeMs)) scoring.activateBoost(timeMs);
}

export function newBot(): BotState {
  return { cursor: 0, releases: [], jitter: 0, skip: false };
}

export class GameSession {
  readonly scorings: Scoring[] = [];
  readonly logs: InputLog[] = [];
  state: SessionState = 'ready';
  failedPlayer = -1;
  /** Chart position where playback last started or resumed. */
  offset = 0;
  readonly beatMs: number;
  private context: AudioContext | null = null;
  private transport: Transport | null = null;
  private musicGain: GainNode | null = null;
  private pending = false;
  private disposed = false;
  private leadEvent: SongEvent | undefined;
  private readonly leadEnds = new Map<string, number>();
  private lastAudioTime = 0;
  private lastAudioUpdate = 0;
  private bots: BotState[] = [];
  private countBeat = -1;
  private touchKeys = new Map<string, { player: number; lane: number }>();
  private boostKeys = new Map<string, number>();
  private endedAt: number | null = null;
  private lastSync = 0;
  private lastLogged = -Infinity;
  /** True once this attempt was paused. Paused runs stay off the leaderboards. */
  paused = false;
  calibration: number;
  /** Typing lessons: the song stops at each letter until the right key is pressed. */
  wait = false;
  /** Time spent actually playing, in real milliseconds. Words per minute use this when the song waits. */
  playedMs = 0;
  private holding: SongEvent | null = null;
  /** Real time of the first and last correct key in wait mode, for an honest words-per-minute figure. */
  firstKeyAt = 0;
  lastKeyAt = 0;
  private stamp() { const now = performance.now(); if (!this.firstKeyAt) this.firstKeyAt = now; this.lastKeyAt = now; }
  private waitCursor = 0;
  /** Lanes the learner was meant to press when they hit a wrong key, for the weak-key report. */
  readonly confused: number[] = [];
  private lastFrame = 0;

  constructor(readonly options: {
    chart: Chart; audio: ArrayBuffer; leadAudio?: ArrayBuffer; players: PlayerSetup[];
    calibration: number; canFail: boolean; sudden: boolean; musicVolume: number;
    /** Keep the lead guitar audible without hits (typing and party modes). */
    openLead?: boolean;
    /** Keys that count as a wrong press without belonging to a lane (other letters in a typing lesson). */
    strayCodes?: ReadonlySet<string>;
    /** Play only this part of the song, for section practice. */
    range?: { startMs: number; endMs: number };
    /** Playback speed, 1 by default. */
    rate?: number;
    match?: () => Match | undefined;
    onEvent: (event: SessionEvent) => void;
    sharedContext?: () => AudioContext;
  }) {
    const { chart, players } = options;
    this.calibration = options.calibration;
    this.beatMs = Math.max(260, Math.min(850, 60_000 / chart.bpm));
    const tap = Math.max(460, Math.min(800, 60_000 / chart.bpm));
    const lead = players[0].events;
    lead.forEach((event, index) => this.leadEnds.set(event.id,
      Math.min(event.timeMs + (event.durationMs || tap), lead[index + 1]?.timeMs ?? chart.durationMs)));
    players.forEach((player, index) => {
      player.keys.forEach((code, lane) => this.touchKeys.set(code, { player: index, lane }));
      if (player.boostKey) this.boostKeys.set(player.boostKey, index);
    });
    this.offset = options.range?.startMs ?? 0;
    this.resetScoring();
  }

  private match() { return this.options.match?.(); }

  private resetScoring() {
    this.options.players.forEach((player, index) => {
      const scoring = new Scoring(player.events, player.windowMs);
      scoring.onEvent = event => this.onScore(index, event);
      this.scorings[index] = scoring;
      this.logs[index] = { inputs: [], boosts: [] };
      this.bots[index] = newBot();
    });
    this.failedPlayer = -1;
    this.leadEvent = undefined;
    this.endedAt = null;
    this.paused = false;
    this.lastLogged = -Infinity;
    this.holding = null;
    this.waitCursor = 0;
    this.playedMs = 0;
    this.confused.length = 0;
    this.firstKeyAt = 0;
    this.lastKeyAt = 0;
  }

  private setState(state: SessionState) {
    if (this.state === state) return;
    this.state = state;
    this.options.onEvent({ type: 'state', state });
  }

  private onScore(player: number, event: ScoreEvent) {
    this.options.onEvent({ type: 'score', player, event });
    if (this.state !== 'playing' || this.match()) return;
    const scoring = this.scorings[player];
    const solo = this.options.players.length === 1;
    if (!solo) return;
    if (this.options.sudden && event.type === 'miss') this.fail(player);
    else if (this.options.canFail && scoring.crowd <= 0 && scoring.hits + scoring.misses >= 12 &&
      (event.type === 'miss' || event.type === 'wrong')) this.fail(player);
  }

  private fail(player: number) {
    if (this.state !== 'playing') return;
    this.failedPlayer = player;
    this.endedAt = this.transport?.timeMs() ?? this.offset;
    this.transport?.windDown(1);
    this.setState('failed');
  }

  get audioContext() { return this.context; }

  setMusicVolume(volume: number) {
    if (this.musicGain && this.context) this.musicGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.05);
  }

  async start(replay = false) {
    if (this.pending || this.disposed) return;
    this.pending = true;
    const previous = this.state;
    this.setState('starting');
    try {
      if (!this.context) this.context = this.options.sharedContext?.() ?? new AudioContext();
      const ctx = this.context;
      if (ctx.state !== 'running') await withAudioDeadline(ctx.resume(), 'Audio did not start. Press Play to try again.');
      if (!this.transport) {
        const [decoded, lead] = await withAudioDeadline(Promise.all([
          ctx.decodeAudioData(this.options.audio.slice(0)),
          this.options.leadAudio && ctx.decodeAudioData(this.options.leadAudio.slice(0)),
        ]), 'Audio could not be decoded. Press Play to try again.');
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = this.options.musicVolume;
        this.musicGain.connect(ctx.destination);
        this.transport = new Transport(ctx, decoded, lead, this.musicGain);
        this.transport.rate = this.options.rate ?? 1;
      }
      if (this.disposed) return;
      if (replay) {
        this.resetScoring();
        this.offset = this.options.range?.startMs ?? 0;
      }
      const match = this.match();
      if (match && match.startAt === null) {
        await match.onReady();
        this.setState(previous === 'starting' ? 'ready' : previous);
        return;
      }
      await this.transport.start(this.offset, this.beatMs * 4 / (this.options.rate ?? 1), match?.startAt ?? undefined);
      if (this.options.openLead) this.transport.openLead();
      if (match && this.transport.timeMs() >= 150) {
        this.scorings[0].rejoin(this.transport.timeMs() - this.calibration, match.combo, match.ampCharge, match.boostEndMs);
      }
      this.lastAudioTime = ctx.currentTime;
      this.lastAudioUpdate = performance.now();
      this.countBeat = -1;
      if (!this.disposed) this.setState('playing');
    } catch (reason) {
      this.transport?.stop();
      this.transport = null;
      if (this.context && this.context.state !== 'closed' && !this.options.sharedContext) void this.context.close().catch(() => {});
      this.context = null;
      // A finished attempt must not be announced twice, so a failed restart goes back to a clean ready state.
      if (previous === 'finished' || previous === 'failed') {
        this.resetScoring();
        this.offset = this.options.range?.startMs ?? 0;
        this.setState('ready');
      } else this.setState(previous === 'starting' ? 'ready' : previous);
      this.options.onEvent({ type: 'error', message: reason instanceof Error ? reason.message : 'Audio could not start.' });
    } finally {
      this.pending = false;
    }
  }

  /** Raw playback position in ms. Negative during the opening count-in. */
  rawTime() {
    if (this.endedAt !== null) return this.endedAt;
    if (this.holding) return this.offset;
    return this.transport && this.state === 'playing' ? this.transport.timeMs() : this.offset;
  }
  /** Chart time after the player's timing offset. */
  time() { return this.rawTime() - this.calibration; }
  get durationMs() { return this.transport ? this.transport.buffer.duration * 1000 : this.options.chart.durationMs; }
  get counting() { return this.state === 'playing' && this.rawTime() < this.offset; }

  private sound(event: SongEvent, start = event.timeMs) {
    if (!this.transport || this.options.openLead) return;
    if (this.leadEvent && event.timeMs < this.leadEvent.timeMs) return;
    const end = this.leadEnds.get(event.id);
    if (end === undefined) return;
    this.transport.soundLead(start, end);
    this.leadEvent = event;
  }

  private soundHeldSustain(start: number) {
    const scoring = this.scorings[0];
    const held = [...scoring.sustaining.values()].find(event =>
      event !== this.leadEvent && event.lanes.every(lane => scoring.held.has(lane)));
    if (held) this.sound(held, start);
  }

  pause() {
    if (this.state !== 'playing' || !this.transport) return;
    const playback = this.transport;
    const match = this.match();
    if (match) {
      playback.muteLead();
      const timeMs = Math.max(0, playback.inputTimeMs(performance.now()) - this.calibration);
      for (const lane of this.scorings[0].held) {
        this.scorings[0].release(lane, timeMs);
        match.onInput({ lane, down: false, timeMs });
      }
      return;
    }
    if (!this.holding) this.offset = Math.min(playback.buffer.duration * 1000 - 1, Math.max(this.offset, playback.timeMs()));
    this.holding = null;
    playback.stop();
    for (const scoring of this.scorings) scoring.pause(this.offset - this.calibration);
    // Settling the pause can register a miss that ends a sudden death run. That ending stands.
    if (this.state !== 'playing') return;
    this.paused = true;
    this.setState('paused');
  }

  laneInput(player: number, lane: number, down: boolean, timestamp: number) {
    if (this.state !== 'playing' || !this.transport || this.options.players[player].bot !== undefined) return;
    const playback = this.transport;
    const scoring = this.scorings[player];
    const inputTime = playback.inputTimeMs(timestamp);
    // Judged and logged at the same 0.1 ms precision, so the server replay sees exactly what was scored.
    const timeMs = Math.round((inputTime - this.calibration) * 10) / 10;
    const match = this.match();
    const lead = player === 0;
    if (!down) {
      scoring.release(lane, timeMs);
      this.log(player, [lane, 0, timeMs]);
      if (lead && this.leadEvent?.durationMs && this.leadEvent.lanes.includes(lane) && inputTime < this.leadEnds.get(this.leadEvent.id)!) {
        if (!this.options.openLead) playback.muteLead();
        this.leadEvent = undefined;
      }
      match?.onInput({ lane, down: false, timeMs });
    } else if (inputTime >= this.offset) {
      this.options.onEvent({ type: 'press', player, lane });
      const hit = scoring.press(lane, timeMs);
      this.log(player, [lane, 1, timeMs]);
      if (lead) {
        if (hit) this.sound(hit);
        else this.soundHeldSustain(inputTime);
      }
      match?.onInput({ lane, down: true, timeMs });
    } else {
      this.options.onEvent({ type: 'press', player, lane });
      scoring.regrip(lane);
      if (lead) this.soundHeldSustain(this.offset);
    }
  }

  boost(player: number, timestamp: number) {
    if (this.state !== 'playing' || !this.transport) return;
    const inputTime = this.transport.inputTimeMs(timestamp);
    if (inputTime < this.offset) return;
    // A boost is logged after any input already logged at the same instant, because the replay runs ties boost first.
    const timeMs = Math.max(Math.round((inputTime - this.calibration) * 10) / 10, player === 0 ? this.lastLogged + 0.1 : -Infinity);
    if (this.scorings[player].activateBoost(timeMs)) {
      this.logs[player].boosts.push(Math.round(timeMs * 10) / 10);
      this.match()?.onBoost(timeMs);
    }
  }

  /**
   * Picks what a strum plays. Lower frets may stay held under the note, as on a real guitar:
   * a single note needs its fret to be the highest one held, a chord needs all of its frets.
   */
  strumLanes(player: number, held: number[], timestamp: number): number[] {
    if (!held.length || !this.transport) return [];
    const scoring = this.scorings[player];
    const { events, windowMs } = this.options.players[player];
    const timeMs = this.transport.inputTimeMs(timestamp) - this.calibration;
    const top = Math.max(...held);
    let best: SongEvent | undefined;
    let distance = windowMs + 1;
    for (const event of events) {
      if (event.timeMs < timeMs - windowMs) continue;
      if (event.timeMs > timeMs + windowMs) break;
      if (scoring.consumed.has(event.id)) continue;
      const fits = event.lanes.every(lane => held.includes(lane)) && Math.max(...event.lanes) === top;
      const delta = Math.abs(event.timeMs - timeMs);
      if (fits && delta < distance) { best = event; distance = delta; }
    }
    return best ? [...best.lanes] : [top];
  }

  /** 0 to 1 from a whammy bar. Bends the lead guitar while a sustain rings. */
  whammy(amount: number) {
    this.transport?.bendLead(this.scorings[0].sustaining.size ? amount * 180 : 0);
  }

  private log(player: number, entry: [number, number, number]) {
    // Taps during the opening count-in are not part of the run.
    if (entry[2] < -400) return;
    this.logs[player].inputs.push(entry);
    if (player === 0) this.lastLogged = Math.max(this.lastLogged, entry[2]);
  }

  /** Returns true when the key belonged to the game. */
  keyDown(event: KeyboardEvent) {
    if (this.state !== 'playing') return false;
    if (event.altKey || event.metaKey || event.ctrlKey) return false;
    // A capital letter is its own key: Shift plus the letter.
    const shifted = this.touchKeys.get(`Shift+${event.code}`);
    const plain = this.touchKeys.get(event.code);
    const target = event.shiftKey ? shifted : plain;
    if (this.holding) {
      if (event.repeat || !this.transport) return !!(shifted || plain || this.options.strayCodes?.has(event.code));
      const scoring = this.scorings[0];
      const waited = this.holding;
      if (target && waited.lanes.includes(target.lane)) {
        this.options.onEvent({ type: 'press', player: 0, lane: target.lane });
        scoring.press(target.lane, waited.timeMs);
        scoring.release(target.lane, waited.timeMs + 1);
        this.stamp();
        this.holding = null;
        void this.transport.start(this.offset, 0).then(() => { if (this.options.openLead) this.transport?.openLead(); }).catch(() => {});
        return true;
      }
      if (shifted || plain || this.options.strayCodes?.has(event.code)) { scoring.stray(waited.timeMs); this.confused.push(waited.lanes[0]); return true; }
      return false;
    }
    if (this.wait && this.transport && !event.repeat && this.transport.inputTimeMs(event.timeStamp) >= this.offset) {
      // A quick typist may run ahead of the song: the next letter counts as soon as it is typed.
      const scoring = this.scorings[0];
      const events = this.options.players[0].events;
      let cursor = this.waitCursor;
      while (cursor < events.length && scoring.consumed.has(events[cursor].id)) cursor++;
      const upcoming = events[cursor];
      if (upcoming && (shifted || plain || this.options.strayCodes?.has(event.code))) {
        if (target && upcoming.lanes.includes(target.lane)) {
          this.options.onEvent({ type: 'press', player: 0, lane: target.lane });
          scoring.press(target.lane, upcoming.timeMs);
          scoring.release(target.lane, upcoming.timeMs + 1);
          this.stamp();
        } else { scoring.stray(this.transport.inputTimeMs(event.timeStamp) - this.calibration); this.confused.push(upcoming.lanes[0]); }
        return true;
      }
    }
    if (!target && (shifted || plain)) {
      // The right letter in the wrong case.
      if (!event.repeat && this.transport && this.transport.inputTimeMs(event.timeStamp) >= this.offset) {
        this.scorings[0].stray(this.transport.inputTimeMs(event.timeStamp) - this.calibration);
      }
      return true;
    }
    if (target) {
      if (!event.repeat) this.laneInput(target.player, target.lane, true, event.timeStamp);
      return true;
    }
    if (this.options.strayCodes?.has(event.code)) {
      if (!event.repeat && this.transport) {
        const inputTime = this.transport.inputTimeMs(event.timeStamp);
        if (inputTime >= this.offset) this.scorings[0].stray(inputTime - this.calibration);
      }
      return true;
    }
    const boostPlayer = this.boostKeys.get(event.code);
    if (boostPlayer !== undefined) {
      if (!event.repeat) this.boost(boostPlayer, event.timeStamp);
      return true;
    }
    return false;
  }

  keyUp(event: KeyboardEvent) {
    if (this.holding) return;
    for (const id of [event.code, `Shift+${event.code}`]) {
      const target = this.touchKeys.get(id);
      if (target && this.scorings[target.player].held.has(target.lane)) this.laneInput(target.player, target.lane, false, event.timeStamp);
    }
  }

  /** Call once per animation frame while playing. */
  frame() {
    if (this.state !== 'playing' || !this.transport) return;
    const playback = this.transport;
    const clock = performance.now();
    const step = this.lastFrame ? Math.min(250, clock - this.lastFrame) : 0;
    this.lastFrame = clock;
    if (this.holding) {
      this.playedMs += step;
      this.lastAudioUpdate = clock;
      return;
    }
    const now = playback.timeMs();
    if (now >= this.offset && now - this.calibration >= (this.options.players[0].events[0]?.timeMs ?? 0)) this.playedMs += step;
    if (this.wait && now >= this.offset) {
      const events = this.options.players[0].events;
      const scoring = this.scorings[0];
      while (this.waitCursor < events.length && scoring.consumed.has(events[this.waitCursor].id)) this.waitCursor++;
      const next = events[this.waitCursor];
      if (!next && events.length) {
        // Every letter is typed. The lesson ends here instead of playing out the rest of the song.
        for (const scoring of this.scorings) scoring.finish();
        this.endedAt = now;
        playback.stop();
        this.setState('finished');
        return;
      }
      if (next && now - this.calibration >= next.timeMs) {
        // The letter is at the ring. Stop the song here until it is typed.
        this.holding = next;
        this.offset = next.timeMs + this.calibration;
        playback.stop();
        return;
      }
    }
    if (playback.context.currentTime > this.lastAudioTime) {
      this.lastAudioTime = playback.context.currentTime;
      this.lastAudioUpdate = clock;
    } else if (clock - this.lastAudioUpdate > 3500) {
      playback.stop();
      if (!this.options.sharedContext) void playback.context.close().catch(() => {});
      this.transport = null;
      this.context = null;
      const match = this.match();
      if (match) {
        for (const lane of this.scorings[0].held) match.onInput({ lane, down: false, timeMs: Math.max(0, now - this.calibration) });
      }
      this.offset = match ? 0 : Math.max(this.offset, now);
      for (const scoring of this.scorings) scoring.pause(now - this.calibration);
      this.options.onEvent({ type: 'error', message: 'Audio stopped advancing. Press Resume to reconnect playback.' });
      this.setState('paused');
      return;
    }
    if (now < this.offset) {
      const beat = Math.ceil((this.offset - now) / this.beatMs);
      if (beat !== this.countBeat) {
        this.countBeat = beat;
        this.options.onEvent({ type: 'countin', beat: Math.min(4, beat) });
      }
    } else if (this.countBeat !== 0) {
      this.countBeat = 0;
      this.options.onEvent({ type: 'countin', beat: 0 });
    }
    // Online, the song must stay on the shared clock. If audio fell behind (a stalled tab or a busy machine), jump back in step.
    const match = this.match();
    if (match?.startAt && clock - this.lastSync > 1500) {
      const expected = clock - match.startAt;
      // Checked during the count-in too, so both players see the same numbers.
      if (expected > -this.beatMs * 4 && Math.abs(expected - now) > 110) {
        this.lastSync = clock;
        void playback.start(0, 0, match.startAt).then(() => { if (this.options.openLead) playback.openLead(); }).catch(() => {});
        return;
      }
    }
    const chartTime = now - this.calibration;
    if (now >= this.offset) {
      this.options.players.forEach((player, index) => {
        if (player.bot !== undefined) {
          botStep(this.scorings[index], player.events, this.bots[index], chartTime, player.bot,
            lane => this.options.onEvent({ type: 'press', player: index, lane }));
        }
        this.scorings[index].tick(chartTime);
      });
    }
    const end = Math.min(playback.buffer.duration * 1000, this.options.range?.endMs ?? Infinity);
    if (this.state === 'playing' && now >= end + Math.max(this.calibration, 0)) {
      for (const scoring of this.scorings) scoring.finish();
      this.endedAt = end;
      playback.stop();
      this.setState('finished');
    }
  }

  dispose() {
    this.disposed = true;
    this.transport?.stop();
    this.transport = null;
    if (this.context && this.context.state !== 'closed' && !this.options.sharedContext) void this.context.close().catch(() => {});
    this.context = null;
  }
}
