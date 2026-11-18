import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Pause, Play, RotateCcw, Star, LogOut } from 'lucide-react';
import type { Difficulty, SongEvent } from '../../shared/song';
import { canFail, difficultyNames, notesFor } from '../../shared/difficulty';
import { applyMods, finalScore, MODS, playbackRate, windowFor, type ModId } from '../../shared/modifiers';
import { gradeFor, isFullCombo, starProgress, starsFor } from '../../shared/rating';
import type { RunMode, RunSummary } from '../../shared/progression';
import { ALL_TYPING_KEYS, baseKey, buildTypingChart, charFor, wpm, type KeyStats, type TypingChart, type TypingLesson, type TypingOptions } from '../../shared/typing';
import { keyLabel } from '../../shared/practice';
import { sectionNames } from '../../shared/sections';
import type { ScoreEvent, Scoring } from '../../shared/scoring';
import type { Recording } from '../lib/recording';
import { stageArt } from '../lib/stage-art';
import { GameSession, type InputLog, type Match, type PlayerSetup, type SessionEvent, type SessionState } from '../game/session';
import { beatPulse, Highway, StageRenderer, type LaneLayout } from '../game/renderer';
import { laneLayout, typingLayout } from '../game/layouts';
import { FINGER_COLORS } from '../game/themes';
import { sfx } from '../game/sfx';
import { looksLikeGuitar, padFocus, padName, PadReader, pads } from '../game/gamepad';
import { currentPlayer, laneColors, saveStore, settingsStore, useCell } from '../state/store';
import { completeRun, creditPlayer, type Outcome } from '../state/progress';
import PlayerHud, { type HudHandle } from './PlayerHud';
import KeyboardGuide, { type KeyboardHandle } from './KeyboardGuide';
import Results from './Results';

export type RunSetup = {
  mode: RunMode;
  difficulty: Difficulty;
  mods: ModId[];
  typing?: { options: TypingOptions; lesson?: TypingLesson };
  /** `seats` holds the saved player id in each seat, or null for a guest or the computer. Each saved player earns their own XP. */
  party?: { coop: boolean; cpu?: number; names: [string, string]; difficulties?: [Difficulty, Difficulty]; seats?: [string | null, string | null] };
  /** Several songs played back to back as one set, with a running total. */
  /** `weak` holds each finished song's costliest section, so the set summary can open practice there. */
  set?: { name: string; ids: string[]; index: number; score: number; ratings: number[]; scores?: number[]; weak?: number[] };
  /** Loop one part of the song at a chosen speed. Nothing is saved or ranked. */
  practice?: { startMs: number; endMs: number; rate: number };
  tour?: boolean;
  daily?: string;
  challenge?: { name: string; score: number };
  tutorial?: boolean;
};

export type RunResult = {
  summary: RunSummary; outcome: Outcome; log: InputLog; scorings: Scoring[]; events: SongEvent[];
  /** Party: saved players other than the active one who were credited on their own profiles, and whether the active player sat out. */
  credited?: { name: string; xp: number }[]; spectator?: boolean;
  keyStats?: KeyStats; typing?: TypingChart; typingAccuracy?: number; hitOffsetMs: number | null;
  /** Signed timing of every hit in ms. Negative is early. */
  offsets: number[]; windowMs: number;
  /** The run was paused at least once. */
  paused: boolean;
  /** Every moment that cost points or the streak: a missed note, a stray press or a hold let go early. */
  troubles: { timeMs: number; kind: 'miss' | 'stray' | 'drop'; streak: number }[];
  /** A typing run where the song waited for each letter, so timing was not judged. */
  waited: boolean;
};

type Props = {
  recording: Recording;
  setup: RunSetup;
  match?: Match;
  opponentBoostUntil?: number | null;
  onExit: () => void;
  /** Offered on the results screen, for example the next tour song or lesson. */
  next?: (result: RunResult) => { label: string; run: () => void } | undefined;
  exitLabel?: string;
  /** Lets the ready card change the run, for the practice section and speed pickers. */
  retune?: (setup: RunSetup) => void;
  /** Extra content on the ready card, such as an invite link. */
  readyExtra?: ReactNode;
};

/** Minutes, seconds and tenths, for a loop edge that moves less than a second per step. */
export const fineClock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms / 100) % 10}`;
export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** A song is split into this many sections for practice and for the results timeline. */
export const SECTIONS = 8;

/** The section of a finished run that cost the most: missed notes, stray presses and holds let go early. */
export function weakestSection(result: Pick<RunResult, 'events' | 'scorings' | 'troubles'>, durationMs: number) {
  const size = durationMs / SECTIONS;
  const scoring = result.scorings[0];
  const cost = Array.from({ length: SECTIONS }, (_, index) => {
    const inside = (timeMs: number) => timeMs >= index * size && timeMs < (index + 1) * size;
    const judged = result.events.filter(event => inside(event.timeMs) && scoring.consumed.has(event.id));
    return judged.filter(event => !scoring.hitOffsets.has(event.id)).length + result.troubles.filter(item => item.kind !== 'miss' && inside(item.timeMs)).length;
  });
  return cost.indexOf(Math.max(...cost));
}
type PracticePass = { hits: number; total: number; rating: number; drops: number };

const TUTORIAL_TIPS: [number, string][] = [
  [-4000, 'Gems slide down the neck. Press the matching key when a gem reaches its ring.'],
  [3500, 'Nice. Stay on the beat and the multiplier climbs: 2×, 3×, 4×.'],
  [9000, 'A long tail means hold the key until the tail ends.'],
  [15000, 'Good timing fills the amp. When it glows, press SPACE for double points.'],
  [22000, 'Watch the crowd meter. Clean playing keeps them cheering.'],
];

const TYPING_WINDOWS: Record<Difficulty, number> = { beginner: 260, easy: 240, medium: 176, hard: 136, expert: 104 };

const botSkill = () => {
  const value = Number(new URLSearchParams(location.search).get('bot'));
  return Number.isFinite(value) && value > 0 ? Math.min(1, value) : undefined;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

export default function GameScreen({ recording, setup: latestSetup, match, opponentBoostUntil, onExit, next, exitLabel = 'Back to songs', readyExtra, retune }: Props) {
  const { song, chart } = recording;
  // A parent may pass an equal setup in a new object on every render. The session must not restart for that.
  const setupKey = JSON.stringify(latestSetup);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setup = useMemo(() => latestSetup, [setupKey]);
  const settings = useCell(settingsStore);
  const save = useCell(saveStore);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SessionState>('ready');
  const [error, setError] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [result, setResult] = useState<RunResult>();
  const [tip, setTip] = useState(-1);
  const [pauseIndex, setPauseIndex] = useState(0);
  const [passes, setPasses] = useState<{ last: PracticePass; best: PracticePass; count: number }>();
  const names = useMemo(() => sectionNames(chart.events.normal, chart.durationMs), [chart]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLElement>(null);
  const huds = useRef<(HudHandle | null)[]>([]);
  const starFills = useRef<(HTMLElement | null)[]>([]);
  const progress = useRef<HTMLDivElement>(null);
  const ribbon = useRef<HTMLDivElement>(null);
  const liveWpm = useRef<HTMLElement>(null);
  const versus = useRef<HTMLDivElement>(null);
  const keyboard = useRef<KeyboardHandle>(null);
  const matchRef = useRef(match);
  matchRef.current = match;
  const opponentBoost = useRef(opponentBoostUntil);
  opponentBoost.current = opponentBoostUntil;
  const touch = useRef(new Map<number, number>());
  const bot = useMemo(botSkill, []);
  const artwork = stageArt(song.id);

  const typing = useMemo(() => setup.typing
    ? buildTypingChart(chart, { ...setup.typing.options, seed: setup.typing.options.seed + attempt * 7919 }) : undefined,
  [chart, setup.typing, attempt]);

  const players = useMemo<PlayerSetup[]>(() => {
    // Typing is judged on the letter more than the millisecond, so the window is generous.
    if (typing) return [{ events: typing.events, windowMs: TYPING_WINDOWS[setup.difficulty], keys: typing.keys, boostKey: 'Enter', bot }];
    const notes = (level: Difficulty) => {
      const all = applyMods(notesFor(chart, level), setup.mods);
      const range = setup.practice;
      return range ? all.filter(event => event.timeMs >= range.startMs && event.timeMs < range.endMs) : all;
    };
    if (setup.party) {
      const levels = setup.party.difficulties ?? [setup.difficulty, setup.difficulty];
      return [
        { events: notes(levels[0]), windowMs: windowFor(levels[0], setup.mods), keys: settings.partyKeys[0], boostKey: 'Space', bot },
        { events: notes(levels[1]), windowMs: windowFor(levels[1], setup.mods), keys: settings.partyKeys[1], boostKey: 'Enter', bot: setup.party.cpu ?? bot },
      ];
    }
    return [{ events: notes(setup.difficulty), windowMs: windowFor(setup.difficulty, setup.mods), keys: settings.keys, boostKey: 'Space', bot }];
  }, [chart, setup, typing, settings.keys, settings.partyKeys, bot]);

  const guitarName = useGuitarName();
  // With one guitar it takes player 2; with two, both seats.
  const guitarSeats = !guitarName ? [] : !setup.party ? (pads().some(looksLikeGuitar) ? [0] : []) : pads().length > 1 ? [0, 1] : [1];
  const layouts = useMemo<LaneLayout[]>(() => players.map((player, index) => typing
    ? typingLayout(player.keys)
    : laneLayout(player.keys, laneColors(settings), !setup.party && (setup.difficulty === 'beginner' || !!setup.tutorial),
      guitarSeats.includes(index))),
  [players, typing, settings, setup.party, guitarSeats.join()]);

  const session = useRef<GameSession>(null);
  const renderer = useRef<StageRenderer>(null);
  const handler = useRef<(event: SessionEvent) => void>(() => {});
  const shown = useRef<number[]>([]);
  const typingState = useRef({ index: 0, word: -1 });
  const troubles = useRef<RunResult['troubles']>([]);
  const boostWasOn = useRef<boolean[]>([]);

  const callout = useCallback((text: string, kind = '', player = -1) => {
    huds.current.forEach((hud, index) => { if (player < 0 || player === index) hud?.callout(text, kind); });
  }, []);

  // Session lifecycle.
  useEffect(() => {
    const current = new GameSession({
      chart, audio: recording.audio, leadAudio: recording.leadAudio, players,
      calibration: settings.calibration, canFail: canFail[setup.difficulty] && !setup.typing && !setup.tutorial,
      sudden: setup.mods.includes('sudden'), musicVolume: settings.musicVolume,
      openLead: !!typing || !!setup.party, rate: setup.practice?.rate ?? playbackRate(setup.mods), range: setup.practice, match: () => matchRef.current,
      strayCodes: typing ? new Set(ALL_TYPING_KEYS.filter(code => !typing.keys.some(key => baseKey(key) === code))) : undefined,
      onEvent: event => handler.current(event),
    });
    session.current = current;
    shown.current = players.map(() => 0);
    typingState.current = { index: 0, word: -1 };
    boostWasOn.current = players.map(() => false);
    setState('ready');
    setResult(undefined);
    setCount(null);
    setTip(-1);
    return () => { current.dispose(); sfx.stopCrowd(); };
    // Settings that change mid-run are applied without rebuilding the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, recording, players, setup]);

  useEffect(() => { session.current?.setMusicVolume(settings.musicVolume); }, [settings.musicVolume]);
  const waiting = !!typing && settings.typingWait && bot === undefined;
  useEffect(() => { if (session.current && session.current.state !== 'playing') session.current.wait = waiting; }, [waiting, state]);
  // A new timing offset applies from the next resume or replay, never in the middle of playing.
  useEffect(() => { if (session.current && session.current.state !== 'playing') session.current.calibration = settings.calibration; }, [settings.calibration, state]);
  useEffect(() => {
    sfx.volume = settings.sfxVolume;
    sfx.hitSounds = settings.hitSounds === 'on' || (settings.hitSounds === 'auto' && (!recording.leadAudio || !!typing));
  }, [settings.sfxVolume, settings.hitSounds, recording.leadAudio, typing]);

  // Renderer and frame loop.
  useEffect(() => {
    if (!canvas.current || !session.current) return;
    const stageRenderer = new StageRenderer(canvas.current);
    stageRenderer.calm = settings.calm;
    const plainHits = !!typing && settings.typingWait;
    renderer.current = stageRenderer;
    const speed = settings.speed * (setup.mods.includes('hyperspeed') ? 0.58 : 1) * (typing ? 1.15 : 1);
    const game = session.current;
    stageRenderer.setHighways(players.map((player, index) => new Highway(game.scorings[index], player.events, layouts[index], {
      theme: save.equipped.highway, gem: save.equipped.gem, fx: save.equipped.fx, lookahead: speed,
      hidden: setup.mods.includes('hidden'), calm: settings.calm, plainHits,
    })));
    const place = () => {
      stageRenderer.resize();
      stageRenderer.highways.forEach((highway, index) => huds.current[index]?.place(highway.x, highway.w));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(canvas.current);
    let frame = 0;
    let lastStars = -1;
    // Controllers: one plays the only neck; in party mode one controller takes player 2 and a second takes player 1.
    const readers = new Map<number, PadReader>();
    const sounding = new Map<number, Set<number>>();
    const readPads = (current: GameSession) => {
      const connected = typing ? [] : pads();
      padFocus.playing = current.state === 'playing' && connected.length > 0;
      if (!connected.length) return;
      const map = settingsStore.get().pad;
      connected.slice(0, players.length).forEach((pad, order) => {
        const player = players.length === 1 ? 0 : connected.length === 1 ? 1 : order;
        if (players[player].bot !== undefined) return;
        let reader = readers.get(pad.index);
        if (!reader) readers.set(pad.index, reader = new PadReader(pad.index));
        const input = reader.poll(map);
        if (!input) return;
        if (input.pause && !matchRef.current) {
          if (current.state === 'playing') current.pause();
          else if (current.state === 'paused' || current.state === 'ready') void current.start();
          return;
        }
        if (current.state !== 'playing') return;
        let lanes = sounding.get(pad.index);
        if (!lanes) sounding.set(pad.index, lanes = new Set());
        if (map.mode === 'tap') {
          for (const lane of input.pressed) current.laneInput(player, lane, true, input.at);
          for (const lane of input.released) current.laneInput(player, lane, false, input.at);
        } else {
          for (const lane of input.released) {
            if (lanes.delete(lane)) current.laneInput(player, lane, false, input.at);
          }
          if (input.strum) {
            for (const lane of lanes) current.laneInput(player, lane, false, input.at);
            lanes.clear();
            const held = input.frets.flatMap((down, lane) => down ? [lane] : []);
            for (const lane of current.strumLanes(player, held, input.at)) {
              current.laneInput(player, lane, true, input.at);
              lanes.add(lane);
            }
          }
        }
        if (input.overdrive) current.boost(player, input.at);
        if (player === 0) current.whammy(input.whammy);
        const highway = stageRenderer.highways[player];
        if (highway) highway.whammy = input.whammy;
      });
    };
    const loop = () => {
      const current = session.current;
      if (!current) return;
      readPads(current);
      current.frame();
      const time = current.time();
      stageRenderer.highways.forEach((highway, index) => {
        if (highway.scoring !== current.scorings[index]) highway.reset(current.scorings[index], players[index].events);
        const scoring = current.scorings[index];
        const target = finalScore(scoring.score, setup.mods);
        shown.current[index] += (target - shown.current[index]) * 0.22;
        if (Math.abs(target - shown.current[index]) < 1) shown.current[index] = target;
        huds.current[index]?.update(scoring, time, shown.current[index]);
        const boosting = scoring.boosting(time);
        if (boostWasOn.current[index] && !boosting && current.state === 'playing') sfx.play('boost-off');
        boostWasOn.current[index] = boosting;
        // In a duel, the other player's boost shakes your neck.
        const attacked = setup.party && !setup.party.coop ? current.scorings[1 - index]?.boosting(time)
          : !!opponentBoost.current && time < opponentBoost.current && time > 0;
        highway.wobble += ((attacked ? 1 : 0) - highway.wobble) * 0.12;
      });
      stageRenderer.mood += (current.scorings[0].crowd / 100 - stageRenderer.mood) * 0.05;
      stageRenderer.draw(chart, time);
      const lead = current.scorings[0];
      if (stage.current) {
        const boosting = lead.boosting(time);
        if ((stage.current.dataset.boost === 'on') !== boosting) stage.current.dataset.boost = boosting ? 'on' : 'off';
        const heat = lead.combo >= 30 ? 'max' : lead.combo >= 10 ? 'warm' : 'cool';
        if (stage.current.dataset.heat !== heat) stage.current.dataset.heat = heat;
      }
      const stars = starProgress(players.length > 1 && setup.party?.coop
        ? (current.scorings[0].rating + current.scorings[1].rating) / 2 : lead.rating);
      if (Math.abs(stars - lastStars) > 0.004) {
        if (Math.floor(stars) > Math.floor(lastStars) && lastStars >= 0 && current.state === 'playing' && !setup.practice) {
          sfx.play('star', { pitch: Math.floor(stars) * 2 });
          callout(`${Math.floor(stars)} ${Math.floor(stars) === 1 ? 'star' : 'stars'}`, 'star');
        }
        lastStars = stars;
        starFills.current.forEach((fill, index) => fill?.style.setProperty('--fill', String(Math.max(0, Math.min(1, stars - index)))));
      }
      if (stage.current && !settings.calm) stage.current.style.setProperty('--beat', beatPulse(chart, time).toFixed(2));
      if (progress.current) progress.current.style.setProperty('--progress', String(Math.max(0, Math.min(1, current.rawTime() / chart.durationMs))));
      if (versus.current && current.scorings[1]) {
        const byRating = !!setup.party?.difficulties && setup.party.difficulties[0] !== setup.party.difficulties[1];
        const a = byRating ? current.scorings[0].liveRating : current.scorings[0].score;
        const b = byRating ? current.scorings[1].liveRating : current.scorings[1].score;
        versus.current.style.setProperty('--lead', String(a + b ? a / (a + b) : 0.5));
      }
      if (typing) {
        const tracker = typingState.current;
        while (tracker.index < typing.events.length && lead.consumed.has(typing.events[tracker.index].id)) tracker.index++;
        const upcoming = typing.events[tracker.index];
        keyboard.current?.setNext(upcoming && upcoming.timeMs - time < 2500 ? typing.keys[upcoming.lanes[0]] : null);
        const word = typing.words.findIndex(item => tracker.index <= item.last);
        if (ribbon.current && (word !== tracker.word || ribbon.current.dataset.at !== String(tracker.index))) {
          tracker.word = word;
          ribbon.current.dataset.at = String(tracker.index);
          renderRibbon(ribbon.current, typing, lead, tracker.index, word);
        }
        if (liveWpm.current && typing.events.length && current.state === 'playing') {
          const elapsed = current.wait ? current.lastKeyAt - current.firstKeyAt : time - typing.events[0].timeMs;
          liveWpm.current.textContent = String(Math.round(wpm(lead.hits, Math.max(1000, elapsed))));
        }
      }
      if (setup.tutorial && current.state === 'playing') {
        let index = -1;
        TUTORIAL_TIPS.forEach(([at], i) => { if (current.rawTime() >= at) index = i; });
        setTip(previous => previous === index ? previous : index);
      }
      if (current.state === 'playing') sfx.crowd(Math.max(0, (lead.crowd - 55) / 45) * 0.5);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const handle = { session: game, chart, players, typing };
    (window as unknown as Record<string, unknown>).__shredder = handle;
    return () => {
      if ((window as unknown as Record<string, unknown>).__shredder === handle) delete (window as unknown as Record<string, unknown>).__shredder;
      cancelAnimationFrame(frame); observer.disconnect(); renderer.current = null; padFocus.playing = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, layouts, chart, save.equipped.highway, save.equipped.gem, save.equipped.fx, settings.speed, settings.calm, setup, typing]);

  const finish = useCallback((failed: boolean) => {
    const game = session.current;
    if (!game) return;
    const scoring = game.scorings[0];
    const tally = scoring.tally;
    const events = players[0].events;
    const offsets = [...scoring.hitOffsets.values()];
    const span = events.length ? events.at(-1)!.timeMs - events[0].timeMs : 0;
    let keyStats: KeyStats | undefined;
    if (typing) {
      keyStats = {};
      for (const event of events) {
        if (failed && !scoring.consumed.has(event.id)) continue;
        const code = baseKey(typing.keys[event.lanes[0]]);
        const stat = keyStats[code] ??= { attempts: 0, hits: 0, timingTotal: 0 };
        const offset = scoring.hitOffsets.get(event.id);
        stat.attempts++;
        if (offset !== undefined) { stat.hits++; stat.timingTotal += Math.abs(offset); }
      }
    }
    const fair = !!setup.party?.difficulties && setup.party.difficulties[0] !== setup.party.difficulties[1];
    const other = game.scorings[1];
    if (keyStats && typing) {
      for (const lane of game.confused) {
        const stat = keyStats[baseKey(typing.keys[lane])] ??= { attempts: 0, hits: 0, timingTotal: 0 };
        stat.attempts++;
      }
    }
    const partyWin = setup.party && !setup.party.coop && other ? (fair ? scoring.rating > other.rating : scoring.score > other.score) : undefined;
    const summary: RunSummary = {
      songId: song.id, mode: setup.mode, difficulty: setup.difficulty, mods: setup.mods,
      score: finalScore(scoring.score, setup.mods), rating: scoring.rating, stars: failed ? 0 : starsFor(tally), grade: gradeFor(tally, failed),
      perfects: scoring.perfects, greats: scoring.greats, goods: scoring.goods, misses: scoring.misses, wrongKeys: scoring.wrongKeys,
      totalNotes: events.length, bestCombo: scoring.bestCombo, fullCombo: !failed && isFullCombo(tally), failed,
      boostsUsed: scoring.boostsUsed, durationMs: Math.max(0, Math.min(chart.durationMs, game.rawTime())),
      // In wait mode speed is the learner's own: letters after the first, over the time from first key to last.
      // Party rewards belong to the profile that is signed in on this device, so a win only counts when that player sat in seat 1.
      won: partyWin && setup.party && !setup.party.seats && setup.party.names[0] !== (save.name || 'Player 1') ? false : partyWin,
      wpm: typing ? (game.wait ? wpm(Math.max(0, scoring.hits - 1), Math.max(1000, game.lastKeyAt - game.firstKeyAt)) : wpm(scoring.hits, Math.max(1000, span))) : undefined, lessonId: setup.typing?.lesson?.id, genre: song.genre,
    };
    // One decimal, rounded down, so 100% is only ever shown for a clean passage.
    const attempts = scoring.hits + scoring.misses + scoring.wrongKeys;
    const typingAccuracy = typing ? (attempts ? Math.floor(1000 * scoring.hits / attempts) / 10 : 0) : undefined;
    // Slow-mo is practice: it earns nothing and leaves records alone.
    const counted = bot === undefined && !matchRef.current && !setup.practice && playbackRate(setup.mods) === 1;
    // In party mode each saved player is credited on their own profile. The active profile's result fills the XP panel.
    const seats = setup.party?.seats;
    const seatSummary = (index: number): RunSummary => {
      if (index === 0 || !other) return { ...summary, won: partyWin };
      const theirs = other.tally;
      return { ...summary, difficulty: setup.party?.difficulties?.[1] ?? setup.difficulty, score: finalScore(other.score, setup.mods), rating: other.rating,
        stars: starsFor(theirs), grade: gradeFor(theirs, false), perfects: other.perfects, greats: other.greats, goods: other.goods, misses: other.misses,
        wrongKeys: other.wrongKeys, totalNotes: players[1].events.length, bestCombo: other.bestCombo, fullCombo: isFullCombo(theirs), boostsUsed: other.boostsUsed,
        won: partyWin === undefined ? undefined : fair ? other.rating > scoring.rating : other.score > scoring.score };
    };
    const credited: { name: string; xp: number }[] = [];
    const activeSeat = seats ? seats.indexOf(currentPlayer) : 0;
    if (seats && counted) {
      seats.forEach((id, index) => {
        if (id === null || id === currentPlayer) return;
        const xp = creditPlayer(id, seatSummary(index));
        if (xp !== null) credited.push({ name: setup.party!.names[index], xp });
      });
    }
    const outcome = counted && activeSeat >= 0 ? completeRun(seats ? seatSummary(activeSeat) : summary, {
      tourAccuracy: setup.tour ? Math.floor(100 * scoring.hits / Math.max(1, events.length + scoring.wrongKeys)) : undefined,
      lesson: setup.typing?.lesson, typingAccuracy, keyStats, daily: setup.daily,
    }) : { save, xp: { total: 0, parts: [] }, levelBefore: 0, levelAfter: 0, unlocked: [], achievements: [], newBest: false, firstClear: false,
      previousBest: 0, streak: { days: save.streak.days, extended: false } } as Outcome;
    setResult({ summary, outcome, log: game.logs[0], scorings: [...game.scorings], events, keyStats, typing, typingAccuracy,
      hitOffsetMs: offsets.length >= 20 ? median(offsets) : null, offsets, windowMs: players[0].windowMs, paused: game.paused, waited: game.wait, troubles: [...troubles.current], credited, spectator: !!seats && activeSeat < 0 });
  }, [players, typing, setup, song, chart.durationMs, bot, save]);

  // Session events: sound, callouts and state.
  handler.current = event => {
    const game = session.current;
    if (!game) return;
    if (event.type === 'state') {
      setState(event.state);
      if (event.state === 'playing') { setError(''); if (game.rawTime() <= (setup.practice?.startMs ?? 0)) troubles.current = []; }
      if (event.state === 'finished') {
        sfx.stopCrowd();
        if (setup.practice) {
          // Practice loops the section, with a short breath between passes.
          const done = game.scorings[0];
          const pass = { hits: done.hits, total: players[0].events.length, rating: done.rating, drops: troubles.current.filter(item => item.kind === 'drop').length };
          setPasses(previous => ({ last: pass, count: (previous?.count ?? 0) + 1,
            best: previous && (previous.best.hits > pass.hits || (previous.best.hits === pass.hits && (previous.best.rating > pass.rating || (previous.best.rating === pass.rating && previous.best.drops <= pass.drops)))) ? previous.best : pass }));
          setTimeout(() => { if (session.current === game) void game.start(true, 2); }, 900);
        } else if (!matchRef.current) {
          const clean = isFullCombo(game.scorings[0].tally);
          sfx.play(clean ? 'crowd-roar' : 'crowd-cheer');
          sfx.play('crowd-clap');
          if (clean) { callout('Full combo!', 'mega'); renderer.current?.highways[0]?.celebrate(1); }
          setTimeout(() => finish(false), clean ? 1500 : 700);
        }
      }
      if (event.state === 'failed') {
        sfx.stopCrowd();
        sfx.play('fail');
        sfx.play('crowd-boo');
        setTimeout(() => finish(true), 1500);
      }
      if (event.state === 'paused') { sfx.stopCrowd(); setPauseIndex(0); }
      return;
    }
    if (event.type === 'error') { setError(event.message); return; }
    if (event.type === 'countin') {
      setCount(event.beat > 0 ? Math.min(3, event.beat) : 0);
      if (event.beat > 0 && event.beat <= 3) sfx.play('count-tick');
      if (event.beat === 0) { sfx.play('count-go'); setTimeout(() => setCount(null), 600); }
      return;
    }
    const highway = renderer.current?.highways[event.player];
    const now = performance.now();
    if (event.type === 'press') {
      highway?.press(event.lane, now);
      if (typing) keyboard.current?.flash(typing.keys[event.lane], true);
      return;
    }
    highway?.onScore(event.event, now);
    if (event.player === 0 && (event.event.type === 'miss' || event.event.type === 'wrong' || event.event.type === 'drop')) {
      const at = event.event.type === 'wrong' ? event.event.timeMs : event.event.event.timeMs;
      troubles.current.push({ timeMs: at, kind: event.event.type === 'wrong' ? 'stray' : event.event.type, streak: event.event.brokeCombo });
    }
    score(event.player, event.event, game.scorings[event.player]);
  };

  function score(player: number, event: ScoreEvent, scoring: Scoring) {
    const pan = players.length > 1 ? (player ? 0.5 : -0.5) : 0;
    if (event.type === 'hit') {
      sfx.play(event.judgement === 'Perfect' ? 'hit-perfect' : event.judgement === 'Great' ? 'hit-great' : 'hit-good',
        { lane: layouts[player].column(event.lanes[0]) < 0 ? 0 : layouts[player].column(event.lanes[0]), pan });
      const combo = event.combo;
      // Practice names what just worked, so a chord and a paid-out hold each get their own word.
      if (setup.practice && event.lanes.length > 1) callout('Chord landed', 'note', player);
      if (combo === 10 || combo === 20 || combo === 30) sfx.play('mult-up', { pitch: combo / 10 * 3, pan });
      if (combo === 25 || combo === 50 || (combo >= 100 && combo % 50 === 0)) {
        sfx.play('combo-milestone', { intensity: Math.min(1, combo / 200), pan });
        if (combo >= 50) sfx.play('crowd-cheer', { intensity: 0.6 });
        callout(`${combo} note streak!`, combo >= 100 ? 'mega' : 'streak', player);
        if (combo >= 100) renderer.current?.highways[player]?.celebrate(Math.min(1, combo / 300));
      }
      if (typing && player === 0) {
        const index = typing.events.indexOf(event.event);
        const word = typing.words.find(item => item.last === index);
        if (word && word.text.length > 1 && typing.events.slice(word.first, word.last + 1).every(item => scoring.hitOffsets.has(item.id))) {
          sfx.play('word-complete');
        }
      }
    } else if (event.type === 'drop') {
      sfx.play('wrong', { pan });
    } else if (event.type === 'miss') {
      sfx.play('miss', { pan });
      if (event.brokeCombo >= 10) {
        sfx.play('combo-break', { intensity: Math.min(1, event.brokeCombo / 100), pan });
        if (event.brokeCombo >= 50) callout('Streak lost', 'lost', player);
      }
      if (typing) keyboard.current?.flash(typing.keys[event.lanes[0]], false);
    } else if (event.type === 'wrong') {
      sfx.play('wrong', { pan });
      if (typing) {
        const upcoming = typing.events.find(item => !scoring.consumed.has(item.id));
        if (upcoming && typing.keys[upcoming.lanes[0]].startsWith('Shift+')) callout('Hold Shift for capitals', 'lost', player);
      }
    } else if (event.type === 'sustain') {
      if (setup.practice) callout(`Hold paid +${event.points}`, 'note', player);
      sfx.play('sustain-end', { pan });
    } else if (event.type === 'charged') {
      sfx.play('boost-ready', { pan });
    } else if (event.type === 'boost') {
      sfx.play('boost-on', { pan });
      sfx.play('crowd-roar', { intensity: 0.8 });
      if (setup.party && !setup.party.coop) callout('Overdrive attack!', 'boost', player);
      if (setup.party && !setup.party.coop) sfx.play('attack', { pan: -pan });
    }
  }

  const start = useCallback((replay = false) => {
    sfx.play('ui-select');
    if (replay) {
      if (typing) { setAttempt(value => value + 1); return; }
      // A party rematch gives each player their own last streak to beat.
      const previous = setup.party && bot === undefined ? session.current?.scorings.map(scoring => scoring.bestCombo) : undefined;
      if (previous) setTimeout(() => previous.forEach((streak, index) => {
        if (index === 1 && setup.party!.cpu !== undefined) return;
        callout(streak >= players[index].events.length && streak > 0 ? 'Match your full combo' : streak > 0 ? `Beat your ${streak} streak` : 'Land your first streak', 'streak', index);
      }), 3600);
      setResult(undefined);
    }
    // A song counts as recently played once it starts, not when its ready card opens.
    if (!replay && setup.mode === 'quickplay' && !setup.practice && bot === undefined) {
      try {
        const key = `ks:recent:${currentPlayer}`;
        const recent: string[] = JSON.parse(localStorage.getItem(key) || '[]');
        localStorage.setItem(key, JSON.stringify([song.id, ...recent.filter(id => id !== song.id)].slice(0, 6)));
      } catch { /* optional */ }
    }
    void session.current?.start(replay);
  }, [typing, setup.party, setup.mode, setup.practice, bot, callout, players, song.id]);

  // A fresh typing chart after "Play again" starts on its own.
  const autostart = useRef(false);
  useEffect(() => {
    if (attempt > 0) autostart.current = true;
  }, [attempt]);
  useEffect(() => {
    if (autostart.current && state === 'ready' && session.current) {
      autostart.current = false;
      void session.current.start();
    }
  }, [state, players]);

  // An online match starts when the server schedules it.
  const joined = useRef<number | null>(null);
  useEffect(() => {
    // One automatic try per scheduled start. If the browser blocks audio, the Join button takes over.
    if (!match?.startAt || state !== 'ready' || joined.current === match.startAt) return;
    joined.current = match.startAt;
    void session.current?.start();
  }, [match?.startAt, state]);

  const pauseItems = useMemo(() => [
    { label: 'Resume', icon: Play, run: () => void session.current?.start() },
    { label: 'Restart', icon: RotateCcw, run: () => start(true) },
    { label: 'Quit', icon: LogOut, run: onExit },
  ], [start, onExit]);

  // Keyboard.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const game = session.current;
      if (!game || result) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (game.state === 'playing') {
        if (event.code === 'Escape') { event.preventDefault(); game.pause(); return; }
        if (game.keyDown(event)) event.preventDefault();
        else if (event.code === 'Space' || event.code === 'Tab' || event.code === 'Quote' || event.code === 'Slash') event.preventDefault();
        return;
      }
      if (event.repeat) return;
      // A focused button handles its own Enter and Space.
      if ((event.code === 'Enter' || event.code === 'Space') && event.target instanceof HTMLButtonElement) return;
      if (game.state === 'ready' && (event.code === 'Enter' || event.code === 'Space')) {
        event.preventDefault();
        // In party mode Space and Enter are the overdrive keys players are trying out, so only the button starts.
        if (setup.party) return;
        if (!(matchRef.current?.ready && matchRef.current.startAt === null)) start();
      } else if (game.state === 'ready' && event.code === 'Escape' && !matchRef.current) {
        onExit();
      } else if (game.state === 'paused') {
        if (event.code === 'Escape') { event.preventDefault(); void game.start(); }
        else if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
          event.preventDefault();
          sfx.play('ui-move');
          setPauseIndex(index => (index + (event.code === 'ArrowDown' ? 1 : pauseItems.length - 1)) % pauseItems.length);
        } else if (event.code === 'Enter' || event.code === 'Space') {
          event.preventDefault();
          pauseItems[pauseIndex].run();
        } else if (event.code === 'KeyR') start(true);
      }
    };
    const up = (event: KeyboardEvent) => session.current?.keyUp(event);
    const blur = () => session.current?.pause();
    const visibility = () => { if (document.hidden) session.current?.pause(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [result, start, onExit, pauseItems, pauseIndex]);

  const guitar = guitarName;
  const usedLanes = useMemo(() => new Set(players[0].events.flatMap(event => event.lanes)), [players]);
  // Keys light up on the ready card, so players can check their hands are in the right place.
  const [lit, setLit] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (state !== 'ready') { setLit(new Set()); return; }
    const change = (down: boolean) => (event: KeyboardEvent) => setLit(previous => {
      if (previous.has(event.code) === down) return previous;
      const next = new Set(previous);
      if (down) next.add(event.code); else next.delete(event.code);
      return next;
    });
    const press = change(true);
    const release = change(false);
    window.addEventListener('keydown', press);
    window.addEventListener('keyup', release);
    return () => { window.removeEventListener('keydown', press); window.removeEventListener('keyup', release); };
  }, [state]);
  const mixed = setup.party?.difficulties && setup.party.difficulties[0] !== setup.party.difficulties[1] ? setup.party.difficulties : undefined;
  const modeLine = [typing ? setup.typing?.lesson?.title ?? 'Free typing' : mixed ? `${difficultyNames[mixed[0]]} vs ${difficultyNames[mixed[1]]}` : difficultyNames[setup.difficulty],
    ...setup.mods.map(id => MODS[id].name), ...(setup.practice ? [setup.practice.endMs - setup.practice.startMs >= chart.durationMs - 1 ? 'Whole song' : Math.abs(setup.practice.endMs - setup.practice.startMs - chart.durationMs / SECTIONS) > 5 || (setup.practice.startMs % (chart.durationMs / SECTIONS)) > 5 ? `${fineClock(setup.practice.startMs)} to ${fineClock(setup.practice.endMs)}` : names[Math.round(setup.practice.startMs / (chart.durationMs / SECTIONS))], `${setup.practice.rate * 100}% speed`, 'looping'] : [])].join(' · ');
  const single = players.length === 1;
  const waitingForMatch = !!match && match.ready && match.startAt === null;
  const startLabel = state === 'starting' ? 'Loading audio…' : match ? match.startAt ? 'Join playback' : match.ready ? 'Ready' : 'Ready up' : 'Start';

  // Practice spells out the first two-key move in the loop, so a player new to chords knows what to try.
  const firstMove = useMemo(() => {
    if (!setup.practice) return '';
    const events = players[0].events;
    const chord = events.find(event => event.lanes.length > 1);
    if (!chord) return '';
    const label = (lane: number) => layouts[0].targets[lane]?.label ?? keyLabel(players[0].keys[lane]);
    const keys = chord.lanes.map(label).join(' and ');
    const over = chord.durationMs > 0 ? events.find(event => event.timeMs > chord.timeMs && event.timeMs < chord.timeMs + chord.durationMs) : undefined;
    return `First chord: land ${keys} together${over ? `, then keep them held while you hit ${over.lanes.map(label).join(' and ')}` : ''}.`;
  }, [setup.practice, players, layouts]);
  const practicePick = setup.practice && retune ? <div className="practice-pick">
          <div className="segments" role="group" aria-label="Section">
            {Array.from({ length: SECTIONS }, (_, index) => {
              const size = chart.durationMs / SECTIONS;
              const on = setup.practice!.startMs < (index + 1) * size - 1 && setup.practice!.endMs > index * size + 1;
              return <button key={index} type="button" className={on ? 'on' : ''} aria-pressed={on}
                title={names[index]} aria-label={`Section ${index + 1}, ${names[index]}`}
                onClick={event => { event.currentTarget.blur(); retune({ ...setup, practice: { ...setup.practice!, startMs: Math.round(index * size), endMs: Math.round((index + 1) * size) } }); }}>{index + 1}<small>{names[index]}</small></button>;
            })}
            <button type="button" className={setup.practice.startMs === 0 && setup.practice.endMs >= chart.durationMs ? 'on' : ''}
              onClick={event => { event.currentTarget.blur(); retune({ ...setup, practice: { ...setup.practice!, startMs: 0, endMs: chart.durationMs } }); }}>All</button>
          </div>
          {(() => {
            const beat = 60000 / chart.bpm;
            const { startMs, endMs } = setup.practice;
            const move = (from: number, to: number) => {
              const start = Math.max(0, Math.min(Math.round(from), chart.durationMs - 4 * beat));
              const end = Math.max(start + 4 * beat, Math.min(Math.round(to), chart.durationMs));
              retune({ ...setup, practice: { ...setup.practice!, startMs: Math.round(start), endMs: Math.round(end) } });
            };
            const step = (label: string, title: string, run: () => void) => <button type="button" aria-label={title} title={title}
              onClick={event => { event.currentTarget.blur(); run(); }}>{label}</button>;
            return <div className="range-pick" role="group" aria-label="Loop range">
              <span>Start</span>{step('−', 'Start one beat earlier', () => move(startMs - beat, endMs))}<b>{fineClock(startMs)}</b>{step('+', 'Start one beat later', () => move(Math.min(startMs + beat, endMs - 4 * beat), endMs))}
              <span>End</span>{step('−', 'End one beat earlier', () => move(startMs, Math.max(endMs - beat, startMs + 4 * beat)))}<b>{fineClock(endMs)}</b>{step('+', 'End one beat later', () => move(startMs, endMs + beat))}
            </div>;
          })()}
          <div className="segments" role="group" aria-label="Speed">
            {[0.5, 0.75, 1].map(rate => <button key={rate} type="button" className={setup.practice!.rate === rate ? 'on' : ''} aria-pressed={setup.practice!.rate === rate}
              onClick={event => { event.currentTarget.blur(); retune({ ...setup, practice: { ...setup.practice!, rate } }); }}>{rate * 100}% speed</button>)}
          </div>
          <p className="muted">The section loops until you stop. Practice scores are shown for feedback only: nothing is saved or ranked. A full combo means every note hit and no stray press. A hold let go early keeps the combo but loses its bonus.</p>
          {firstMove && <p className="ready-goal">{firstMove}</p>}
        </div> : null;
  // The stage never scrolls. Focus moving to an off-screen control can still scroll a hidden-overflow box, which would push the results heading out of view.
  return <section className="stage" ref={stage} onScroll={event => { if (event.target === event.currentTarget) event.currentTarget.scrollTo(0, 0); }} data-state={state} data-boost="off" data-heat="cool" data-players={players.length}
    data-typing={typing ? 'true' : undefined} data-practice={setup.practice ? 'true' : undefined} data-calm={settings.calm ? 'true' : undefined} data-duel={match ? 'true' : undefined}
    style={artwork ? { '--art': `url("${artwork}")` } as CSSProperties : undefined}>
    <div className="stage-art" aria-hidden="true" />
    <div className="stage-lights" aria-hidden="true"><i /><i /><i /><i /></div>
    <canvas ref={canvas} className="stage-canvas" aria-hidden="true" />
    <header className="stage-top">
      <div className="now-playing"><h1>{song.title}</h1><p>{song.credit ? `${song.credit.artist} · ` : ''}{modeLine}</p></div>
      <div className="star-meter" ref={progress} role="img" aria-label="Star progress">
        <div className="star-row">{Array.from({ length: 5 }, (_, index) => <span key={index} className="star-slot"
          ref={node => { starFills.current[index] = node; }}><Star aria-hidden="true" /><Star aria-hidden="true" className="lit" /></span>)}</div>
        <div className="song-progress"><i /></div>
      </div>
      <div className="stage-actions">
        {typing && <div className="live-wpm"><strong ref={liveWpm}>0</strong><span>WPM</span></div>}
        {state === 'playing' && !match && <button className="icon-button" aria-label="Pause" onClick={() => session.current?.pause()}><Pause aria-hidden="true" /></button>}
        {match && <button onClick={onExit}>Leave</button>}
      </div>
    </header>
    {setup.challenge && <div className="challenge-banner">Beat {setup.challenge.name}: <strong>{setup.challenge.score.toLocaleString()}</strong></div>}
    {players.map((player, index) => <PlayerHud key={index} ref={node => { huds.current[index] = node; }}
      label={setup.party ? setup.party.names[index] : undefined} showScore={!match} byRating={!!setup.party && !setup.party.coop && !!setup.party.difficulties && setup.party.difficulties[0] !== setup.party.difficulties[1]}
      boostKey={guitar && !typing && (players.length === 1 || index === 1) ? 'Select' : player.boostKey === 'Enter' ? 'Enter' : 'Space'} />)}
    {setup.party && !setup.party.coop && <div className="versus-bar" ref={versus} aria-hidden="true"><i /></div>}
    {typing && <div className="word-ribbon" ref={ribbon} aria-hidden="true" />}
    {typing && settings.showKeyboard && <KeyboardGuide ref={keyboard} active={typing.keys} compact shift={typing.keys.some(code => code.startsWith('Shift+'))} />}
    {setup.tutorial && tip >= 0 && state === 'playing' && <div className="coach" key={`tip-${tip}`} role="status">{TUTORIAL_TIPS[tip][1]}</div>}
    {count !== null && state === 'playing' && <div className="count-in" key={`count-${count}`} data-go={count === 0 ? 'true' : undefined}>
      <strong>{count === 0 ? (typing ? 'Type!' : 'Rock!') : count}</strong>
    </div>}

    {(state === 'ready' || state === 'starting') && !result && <div className="stage-cover">
      <div className="ready-card">
        <p className="eyebrow">{setup.set ? `${setup.set.name} · song ${setup.set.index + 1} of ${setup.set.ids.length}` : setup.practice ? 'Section practice' : setup.challenge ? 'Challenge' : setup.tutorial ? 'Warm-up' : setup.daily ? 'Daily challenge'
          : setup.party ? (setup.party.coop ? 'Party co-op' : 'Party battle')
          : typing ? 'Typing academy' : setup.tour ? 'Tour' : match ? 'Online' : 'Quick play'}</p>
        <h2>{song.title}</h2>
        {setup.set && setup.set.index > 0 && <p className="ready-challenge">Set total so far: <strong>{setup.set.score.toLocaleString()}</strong></p>}
        {setup.set && setup.set.index === 0 && <p className="ready-goal">A headline set: {setup.set.ids.length} songs back to back, one running score. Average an 80% timing rating for a gold record. Extra goal: 85% or better on every song for a platinum record. Hit at least 60% of the notes in each song, or the set ends there.</p>}
        {setup.challenge && <p className="ready-challenge">Beat {setup.challenge.name}: <strong>{setup.challenge.score.toLocaleString()}</strong></p>}
        <p className="ready-mode">{modeLine} · {chart.bpm} BPM</p>
        <p className="ready-counts">{players.map((player, index) => {
          const chords = player.events.filter(event => event.lanes.length > 1).length;
          const holds = player.events.filter(event => event.durationMs > 0).length;
          return <span key={index}>{players.length > 1 ? `${setup.party!.names[index]}: ` : ''}{player.events.length} {player.events.length === 1 ? 'note' : 'notes'}
            {chords ? ` · ${chords} ${chords === 1 ? 'chord' : 'chords'}` : ''}{holds ? ` · ${holds} ${holds === 1 ? 'hold' : 'holds'}` : ''}</span>;
        })}</p>
        {practicePick}
        {typing ? <>
          <p>Type each letter as its gem reaches the ring. Keep your fingers on the home row and use the finger with the matching color.</p>
          {setup.typing?.lesson && setup.typing.lesson.unit === 1 && <HomePosition />}
          {setup.typing?.lesson?.id === 'vim-moves' && <p className="ready-goal">In Vim: H left, J down, K up, L right. W next word, B back a word, E end of word, G G top of file.</p>}
          {bot === undefined && <div className="segments" role="group" aria-label="Pace">
            <button type="button" className={settings.typingWait ? 'on' : ''} aria-pressed={settings.typingWait}
              onClick={event => { event.currentTarget.blur(); settingsStore.set(previous => ({ ...previous, typingWait: true })); }}>The song waits for me</button>
            <button type="button" className={settings.typingWait ? '' : 'on'} aria-pressed={!settings.typingWait}
              onClick={event => { event.currentTarget.blur(); settingsStore.set(previous => ({ ...previous, typingWait: false })); }}>Keep the beat</button>
          </div>}
          <p className="muted">{settings.typingWait ? 'Each letter waits at the ring until you type it. Take your time: only wrong keys count against you.' : 'Letters do not wait. Type each one as it reaches the ring.'}</p>
          {setup.typing?.lesson && <p className="ready-goal">{setup.typing.lesson.blurb} Pass with {setup.typing.lesson.goal.accuracy}% accuracy.</p>}
        </> : setup.party ? <>
          <div className="ready-party">
            {players.map((player, index) => <div key={index}><strong>{setup.party!.names[index]}</strong>
              <div className="ready-keys">{player.keys.map((key, lane) => <kbd key={key} className={`${lit.has(key) ? 'lit' : ''}${player.events.some(event => event.lanes.includes(lane)) ? '' : ' unused'}`}
                style={{ '--lane': layouts[index].color(lane) } as CSSProperties}>{guitarSeats.includes(index) ? layouts[index].targets[lane].label : keyLabel(key)}</kbd>)}</div>
              <small>{setup.party!.difficulties ? `${difficultyNames[setup.party!.difficulties[index]]} · ` : ''}{guitarSeats.includes(index) ? 'Guitar: hold a fret and strum · Overdrive: Select or tilt' : `Overdrive: ${player.boostKey === 'Enter' ? 'Enter' : 'Space'}`}</small></div>)}
          </div>
          <p>Press your key when a gem reaches its ring, and hold long notes to the end of the tail. Try your keys now: they light up above.</p>
          {setup.party.difficulties && setup.party.difficulties[0] !== setup.party.difficulties[1] && !setup.party.coop &&
            <p className="ready-goal">Different difficulties: the winner is whoever plays their own chart more accurately.</p>}
        </> : <>
          <div className="ready-keys" aria-label="Lane keys">{players[0].keys.map((key, lane) =>
            <kbd key={key} className={`${lit.has(key) ? 'lit' : ''}${usedLanes.has(lane) ? '' : ' unused'}`}
              style={{ '--lane': layouts[0].color(lane) } as CSSProperties}>{guitarSeats.includes(0) ? layouts[0].targets[lane].label : keyLabel(key)}</kbd>)}</div>
          {guitarSeats.includes(0) ? <p>{settings.pad.mode === 'strum' ? 'Hold the fret and strum when a gem hits its ring.' : 'Press the fret when a gem hits its ring.'}
            {usedLanes.size < players[0].keys.length ? ` This chart only uses ${[...usedLanes].sort().map(lane => layouts[0].targets[lane].label).join(', ')}.` : ''}
            {' '}Keep the fret down for long notes. Fill the amp, then tilt the guitar or press <kbd>Select</kbd> for double points.</p>
          : <p><span className="keyboard-only">Press the key when a gem hits its ring. </span><span className="touch-only">Tap the pads as gems reach the rings. </span>
            {usedLanes.size < players[0].keys.length ? `This chart only uses ${[...usedLanes].sort().map(lane => keyLabel(players[0].keys[lane])).join(', ')}. ` : ''}
            Hold long notes. Fill the amp, then <span className="keyboard-only">press <kbd>Space</kbd></span><span className="touch-only">tap the lightning button</span> for double points.</p>}
          {canFail[setup.difficulty] && !setup.tutorial && !setup.practice && <p className="ready-goal">Keep the crowd happy. An empty crowd meter ends the set.</p>}
          {setup.mods.includes('sudden') && <p className="ready-goal">Sudden death: one missed note ends the set.</p>}
        </>}
        {guitar && !typing && <p className="ready-goal">{guitar} connected{setup.party ? ` and plays for ${setup.party.names[pads().length > 1 ? 0 : 1]}${pads().length > 1 ? ' and ' + setup.party.names[1] : ''}, in place of the keys shown` : ''}. {settings.pad.mode === 'strum' ? 'Hold the frets and strum on each note.' : 'Press a fret on each note.'} Tilt or press Select for overdrive.</p>}
        {readyExtra}
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary big" autoFocus={!setup.party} disabled={state === 'starting' || waitingForMatch} onClick={() => start()}>{startLabel}</button>
        {!match && <p className="hint keyboard-only">{setup.party ? 'Click Start when you are both ready' : <><kbd>Enter</kbd> start</>} · <kbd>Esc</kbd> back</p>}
        {!match && <button className="ghost" onClick={onExit}>{exitLabel}</button>}
      </div>
    </div>}

    {state === 'paused' && <div className="stage-cover">
      <div className="ready-card pause-card" role="dialog" aria-label="Paused">
        <h2>Paused</h2>
        {error && <p role="alert" className="error">{error}</p>}
        {(session.current?.scorings[0].sustaining.size ?? 0) > 0 && <p>Hold the sustain keys again as playback resumes.</p>}
        <div className="menu-list">{pauseItems.map((item, index) => <button key={item.label} className={index === pauseIndex ? 'primary' : ''}
          onMouseEnter={() => setPauseIndex(index)} onClick={item.run}><item.icon aria-hidden="true" size={18} />{item.label}</button>)}</div>
        <label className="pause-setting">Note speed
          <input type="range" min={800} max={2800} step={50} value={3600 - settings.speed}
            onChange={event => settingsStore.set(previous => ({ ...previous, speed: 3600 - Number(event.target.value) }))} /></label>
        <label className="pause-setting">Timing offset {settings.calibration} ms
          <input type="range" min={-250} max={250} step={5} value={settings.calibration}
            onChange={event => settingsStore.set(previous => ({ ...previous, calibration: Number(event.target.value) }))} /></label>
        {practicePick && <details className="pause-practice"><summary>Change the loop or speed</summary>{practicePick}</details>}
        <p className="hint"><kbd>Esc</kbd> resume · <kbd>R</kbd> restart</p>
      </div>
    </div>}

    {setup.practice && passes && state !== 'ready' && <div className="pass-panel" role="status">
      <span>Pass {passes.count}: <b>{passes.last.hits} of {passes.last.total}</b> hit · timing {passes.last.rating.toFixed(1)}% · holds dropped {passes.last.drops}</span>
      {passes.count > 1 && <span>Best: <b>{passes.best.hits} of {passes.best.total}</b> · timing {passes.best.rating.toFixed(1)}% · holds dropped {passes.best.drops}</span>}
    </div>}
    {state === 'failed' && <div className="fail-flash" aria-hidden="true" />}
    {state === 'finished' && match && <div className="stage-cover"><p role="status">Waiting for final scores…</p></div>}

    {state === 'playing' && single && !typing && <div className="touch-pads" aria-label="Touch fret pads">
      {players[0].keys.map((key, lane) => <button type="button" key={key} aria-label={`Play lane ${lane + 1}`}
        style={{ '--lane': layouts[0].color(lane) } as CSSProperties}
        onPointerDown={event => {
          if ([...touch.current.values()].includes(lane)) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          touch.current.set(event.pointerId, lane);
          session.current?.laneInput(0, lane, true, event.timeStamp);
        }}
        onLostPointerCapture={event => {
          if (!touch.current.delete(event.pointerId)) return;
          session.current?.laneInput(0, lane, false, event.timeStamp);
        }}><span>{keyLabel(key)}</span></button>)}
    </div>}
    {state === 'playing' && single && !typing && <button type="button" className="touch-boost" aria-label="Overdrive"
      onPointerDown={event => session.current?.boost(0, event.timeStamp)}>⚡</button>}
    {result && !match && <Results recording={recording} setup={setup} result={result} bot={bot !== undefined}
      onReplay={() => start(true)} onExit={onExit} exitLabel={exitLabel} next={next?.(result)}
      onPractice={retune ? practice => retune({ mode: 'quickplay', difficulty: setup.difficulty, mods: setup.mods.filter(id => id !== 'sudden' && id !== 'slow'), practice }) : undefined} />}
  </section>;
}

/** Name of the first connected controller, updated when one is plugged in or removed. */
export function useGuitarName() {
  const [name, setName] = useState(() => { const pad = pads()[0]; return pad ? padName(pad) : ''; });
  useEffect(() => {
    const update = () => { const pad = pads()[0]; setName(pad ? padName(pad) : ''); };
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    const timer = setInterval(update, 1500);
    return () => { window.removeEventListener('gamepadconnected', update); window.removeEventListener('gamepaddisconnected', update); clearInterval(timer); };
  }, []);
  return name;
}

/** Where the eight fingers rest. F and J have a small bump you can feel. */
function HomePosition() {
  const keys: [string, string][] = [['A', 'L-pinky'], ['S', 'L-ring'], ['D', 'L-middle'], ['F', 'L-index'], ['J', 'R-index'], ['K', 'R-middle'], ['L', 'R-ring'], [';', 'R-pinky']];
  return <figure className="home-position">
    <div>{keys.map(([label, finger], index) => <kbd key={label} className={label === 'F' || label === 'J' ? 'bump' : ''}
      style={{ '--lane': FINGER_COLORS[finger], marginRight: index === 3 ? '2.2rem' : undefined } as CSSProperties}>{label}</kbd>)}</div>
    <figcaption>Rest your left hand on A S D F and your right hand on J K L ;. Feel for the bumps on F and J. Thumbs rest on the space bar.</figcaption>
  </figure>;
}

function renderRibbon(host: HTMLElement, typing: TypingChart, scoring: Scoring, index: number, word: number) {
  host.textContent = '';
  if (word < 0) return;
  for (let offset = 0; offset < 4; offset++) {
    const item = typing.words[word + offset];
    if (!item) break;
    const span = document.createElement('span');
    span.className = offset === 0 ? 'word current' : 'word';
    for (let i = item.first; i <= item.last; i++) {
      const letter = document.createElement('b');
      const event = typing.events[i];
      letter.textContent = charFor(typing.keys[event.lanes[0]]);
      if (scoring.hitOffsets.has(event.id)) letter.className = 'ok';
      else if (scoring.consumed.has(event.id)) letter.className = 'no';
      else if (i === index) letter.className = 'at';
      span.append(letter);
    }
    host.append(span);
  }
}
