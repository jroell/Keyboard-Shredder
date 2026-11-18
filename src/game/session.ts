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

  constructor(readonly options: {
    chart: Chart; audio: ArrayBuffer; leadAudio?: ArrayBuffer; players: PlayerSetup[];
    calibration: number; canFail: boolean; sudden: boolean; musicVolume: number;
    /** Keep the lead guitar audible without hits (typing and party modes). */
    openLead?: boolean;
    /** Playback speed, 1 by default. */
    rate?: number;
    match?: () => Match | undefined;
    onEvent: (event: SessionEvent) => void;
    sharedContext?: () => AudioContext;
  }) {
    const { chart, players } = options;
    this.beatMs = Math.max(260, Math.min(850, 60_000 / chart.bpm));
    const tap = Math.max(460, Math.min(800, 60_000 / chart.bpm));
    const lead = players[0].events;
    lead.forEach((event, index) => this.leadEnds.set(event.id,
      Math.min(event.timeMs + (event.durationMs || tap), lead[index + 1]?.timeMs ?? chart.durationMs)));
    players.forEach((player, index) => {
      player.keys.forEach((code, lane) => this.touchKeys.set(code, { player: index, lane }));
      if (player.boostKey) this.boostKeys.set(player.boostKey, index);
    });
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
        this.offset = 0;
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
        this.scorings[0].rejoin(this.transport.timeMs() - this.options.calibration, match.combo, match.ampCharge, match.boostEndMs);
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
      this.setState(previous === 'starting' ? 'ready' : previous);
      this.options.onEvent({ type: 'error', message: reason instanceof Error ? reason.message : 'Audio could not start.' });
    } finally {
      this.pending = false;
    }
  }

  /** Raw playback position in ms. Negative during the opening count-in. */
  rawTime() { return this.transport && (this.state === 'playing' || this.state === 'failed') ? this.transport.timeMs() : this.offset; }
  /** Chart time after the player's timing offset. */
  time() { return this.rawTime() - this.options.calibration; }
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
      const timeMs = Math.max(0, playback.inputTimeMs(performance.now()) - this.options.calibration);
      for (const lane of this.scorings[0].held) {
        this.scorings[0].release(lane, timeMs);
        match.onInput({ lane, down: false, timeMs });
      }
      return;
    }
    this.offset = Math.min(playback.buffer.duration * 1000 - 1, Math.max(this.offset, playback.timeMs()));
    playback.stop();
    for (const scoring of this.scorings) scoring.pause(this.offset - this.options.calibration);
    this.setState('paused');
  }

  laneInput(player: number, lane: number, down: boolean, timestamp: number) {
    if (this.state !== 'playing' || !this.transport || this.options.players[player].bot !== undefined) return;
    const playback = this.transport;
    const scoring = this.scorings[player];
    const inputTime = playback.inputTimeMs(timestamp);
    const timeMs = inputTime - this.options.calibration;
    const match = this.match();
    const lead = player === 0;
    if (!down) {
      scoring.release(lane, timeMs);
      this.logs[player].inputs.push([lane, 0, Math.round(timeMs * 10) / 10]);
      if (lead && this.leadEvent?.durationMs && this.leadEvent.lanes.includes(lane) && inputTime < this.leadEnds.get(this.leadEvent.id)!) {
        if (!this.options.openLead) playback.muteLead();
        this.leadEvent = undefined;
      }
      match?.onInput({ lane, down: false, timeMs });
    } else if (inputTime >= this.offset) {
      this.options.onEvent({ type: 'press', player, lane });
      const hit = scoring.press(lane, timeMs);
      this.logs[player].inputs.push([lane, 1, Math.round(timeMs * 10) / 10]);
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
    const timeMs = inputTime - this.options.calibration;
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
    const timeMs = this.transport.inputTimeMs(timestamp) - this.options.calibration;
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

  /** Returns true when the key belonged to the game. */
  keyDown(event: KeyboardEvent) {
    if (this.state !== 'playing') return false;
    if (event.altKey || event.metaKey || event.ctrlKey) return false;
    const target = this.touchKeys.get(event.code);
    if (target) {
      if (!event.repeat) this.laneInput(target.player, target.lane, true, event.timeStamp);
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
    const target = this.touchKeys.get(event.code);
    if (target) this.laneInput(target.player, target.lane, false, event.timeStamp);
  }

  /** Call once per animation frame while playing. */
  frame() {
    if (this.state !== 'playing' || !this.transport) return;
    const playback = this.transport;
    const now = playback.timeMs();
    const clock = performance.now();
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
        for (const lane of this.scorings[0].held) match.onInput({ lane, down: false, timeMs: Math.max(0, now - this.options.calibration) });
      }
      this.offset = match ? 0 : Math.max(this.offset, now);
      for (const scoring of this.scorings) scoring.pause(now - this.options.calibration);
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
    const chartTime = now - this.options.calibration;
    if (now >= this.offset) {
      this.options.players.forEach((player, index) => {
        if (player.bot !== undefined) {
          botStep(this.scorings[index], player.events, this.bots[index], chartTime, player.bot,
            lane => this.options.onEvent({ type: 'press', player: index, lane }));
        }
        this.scorings[index].tick(chartTime);
      });
    }
    if (this.state === 'playing' && now >= playback.buffer.duration * 1000 + Math.max(this.options.calibration, 0)) {
      for (const scoring of this.scorings) scoring.finish();
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
