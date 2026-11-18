import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Pause, Play, RotateCcw, Star, LogOut } from 'lucide-react';
import type { Difficulty, SongEvent } from '../../shared/song';
import { canFail, difficultyNames, notesFor } from '../../shared/difficulty';
import { applyMods, finalScore, MODS, windowFor, type ModId } from '../../shared/modifiers';
import { gradeFor, isFullCombo, starProgress, starsFor } from '../../shared/rating';
import type { RunMode, RunSummary } from '../../shared/progression';
import { buildTypingChart, charFor, wpm, type KeyStats, type TypingChart, type TypingLesson, type TypingOptions } from '../../shared/typing';
import { keyLabel } from '../../shared/practice';
import type { ScoreEvent, Scoring } from '../../shared/scoring';
import type { Recording } from '../lib/recording';
import { stageArt } from '../lib/stage-art';
import { GameSession, type InputLog, type Match, type PlayerSetup, type SessionEvent, type SessionState } from '../game/session';
import { beatPulse, Highway, StageRenderer, type LaneLayout } from '../game/renderer';
import { laneLayout, typingLayout } from '../game/layouts';
import { sfx } from '../game/sfx';
import { laneColors, saveStore, settingsStore, useCell } from '../state/store';
import { completeRun, type Outcome } from '../state/progress';
import PlayerHud, { type HudHandle } from './PlayerHud';
import KeyboardGuide, { type KeyboardHandle } from './KeyboardGuide';
import Results from './Results';

export type RunSetup = {
  mode: RunMode;
  difficulty: Difficulty;
  mods: ModId[];
  typing?: { options: TypingOptions; lesson?: TypingLesson };
  party?: { coop: boolean; cpu?: number; names: [string, string] };
  tour?: boolean;
  daily?: string;
  challenge?: { name: string; score: number };
  tutorial?: boolean;
};

export type RunResult = {
  summary: RunSummary; outcome: Outcome; log: InputLog; scorings: Scoring[]; events: SongEvent[];
  keyStats?: KeyStats; typing?: TypingChart; typingAccuracy?: number; hitOffsetMs: number | null;
  /** Signed timing of every hit in ms. Negative is early. */
  offsets: number[]; windowMs: number;
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
  /** Extra content on the ready card, such as an invite link. */
  readyExtra?: ReactNode;
};

const TUTORIAL_TIPS: [number, string][] = [
  [-4000, 'Gems slide down the neck. Press the matching key when a gem reaches its ring.'],
  [3500, 'Nice. Stay on the beat and the multiplier climbs: 2×, 3×, 4×.'],
  [9000, 'A long tail means hold the key until the tail ends.'],
  [15000, 'Good timing fills the amp. When it glows, press SPACE for double points.'],
  [22000, 'Watch the crowd meter. Clean playing keeps them cheering.'],
];

const botSkill = () => {
  const value = Number(new URLSearchParams(location.search).get('bot'));
  return Number.isFinite(value) && value > 0 ? Math.min(1, value) : undefined;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

export default function GameScreen({ recording, setup: latestSetup, match, opponentBoostUntil, onExit, next, exitLabel = 'Back to songs', readyExtra }: Props) {
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
    if (typing) return [{ events: typing.events, windowMs: windowFor(setup.difficulty, setup.mods) + 15, keys: typing.keys, boostKey: 'Enter', bot }];
    const events = applyMods(notesFor(chart, setup.difficulty), setup.mods);
    const windowMs = windowFor(setup.difficulty, setup.mods);
    if (setup.party) {
      return [
        { events, windowMs, keys: settings.partyKeys[0], boostKey: 'Space', bot },
        { events, windowMs, keys: settings.partyKeys[1], boostKey: 'Enter', bot: setup.party.cpu ?? bot },
      ];
    }
    return [{ events, windowMs, keys: settings.keys, boostKey: 'Space', bot }];
  }, [chart, setup, typing, settings.keys, settings.partyKeys, bot]);

  const layouts = useMemo<LaneLayout[]>(() => players.map((player, index) => typing
    ? typingLayout(player.keys)
    : laneLayout(player.keys, laneColors(settings), !setup.party && (setup.difficulty === 'beginner' || !!setup.tutorial))),
  [players, typing, settings, setup.party]);

  const session = useRef<GameSession>(null);
  const renderer = useRef<StageRenderer>(null);
  const handler = useRef<(event: SessionEvent) => void>(() => {});
  const shown = useRef<number[]>([]);
  const typingState = useRef({ index: 0, word: -1 });
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
      openLead: !!typing || !!setup.party, match: () => matchRef.current,
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
  useEffect(() => {
    sfx.volume = settings.sfxVolume;
    sfx.hitSounds = settings.hitSounds === 'on' || (settings.hitSounds === 'auto' && (!recording.leadAudio || !!typing));
  }, [settings.sfxVolume, settings.hitSounds, recording.leadAudio, typing]);

  // Renderer and frame loop.
  useEffect(() => {
    if (!canvas.current || !session.current) return;
    const stageRenderer = new StageRenderer(canvas.current);
    stageRenderer.calm = settings.calm;
    renderer.current = stageRenderer;
    const speed = settings.speed * (setup.mods.includes('hyperspeed') ? 0.58 : 1) * (typing ? 1.15 : 1);
    const game = session.current;
    stageRenderer.setHighways(players.map((player, index) => new Highway(game.scorings[index], player.events, layouts[index], {
      theme: save.equipped.highway, gem: save.equipped.gem, fx: save.equipped.fx, lookahead: speed,
      hidden: setup.mods.includes('hidden'), calm: settings.calm,
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
    const loop = () => {
      const current = session.current;
      if (!current) return;
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
        if (Math.floor(stars) > Math.floor(lastStars) && lastStars >= 0 && current.state === 'playing') {
          sfx.play('star', { pitch: Math.floor(stars) * 2 });
          callout(`${Math.floor(stars)} ${Math.floor(stars) === 1 ? 'star' : 'stars'}`, 'star');
        }
        lastStars = stars;
        starFills.current.forEach((fill, index) => fill?.style.setProperty('--fill', String(Math.max(0, Math.min(1, stars - index)))));
      }
      if (stage.current && !settings.calm) stage.current.style.setProperty('--beat', beatPulse(chart, time).toFixed(2));
      if (progress.current) progress.current.style.setProperty('--progress', String(Math.max(0, Math.min(1, current.rawTime() / chart.durationMs))));
      if (versus.current && current.scorings[1]) {
        const a = current.scorings[0].score;
        const b = current.scorings[1].score;
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
        if (liveWpm.current && typing.events.length) {
          const elapsed = time - typing.events[0].timeMs;
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
    (window as unknown as Record<string, unknown>).__shredder = { session: game, chart, players, typing };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.current = null; };
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
        const code = typing.keys[event.lanes[0]];
        const stat = keyStats[code] ??= { attempts: 0, hits: 0, timingTotal: 0 };
        const offset = scoring.hitOffsets.get(event.id);
        stat.attempts++;
        if (offset !== undefined) { stat.hits++; stat.timingTotal += Math.abs(offset); }
      }
    }
    const partyWin = setup.party && !setup.party.coop ? scoring.score >= (game.scorings[1]?.score ?? 0) : undefined;
    const summary: RunSummary = {
      songId: song.id, mode: setup.mode, difficulty: setup.difficulty, mods: setup.mods,
      score: finalScore(scoring.score, setup.mods), rating: scoring.rating, stars: failed ? 0 : starsFor(tally), grade: gradeFor(tally, failed),
      perfects: scoring.perfects, greats: scoring.greats, goods: scoring.goods, misses: scoring.misses, wrongKeys: scoring.wrongKeys,
      totalNotes: events.length, bestCombo: scoring.bestCombo, fullCombo: !failed && isFullCombo(tally), failed,
      boostsUsed: scoring.boostsUsed, durationMs: Math.max(0, Math.min(chart.durationMs, game.rawTime())),
      wpm: typing ? wpm(scoring.hits, Math.max(1000, span)) : undefined, won: partyWin, lessonId: setup.typing?.lesson?.id, genre: song.genre,
    };
    const typingAccuracy = typing ? scoring.accuracy : undefined;
    const counted = bot === undefined && !matchRef.current;
    const outcome = counted ? completeRun(summary, {
      tourAccuracy: setup.tour ? Math.floor(100 * scoring.hits / Math.max(1, events.length + scoring.wrongKeys)) : undefined,
      lesson: setup.typing?.lesson, typingAccuracy, keyStats, daily: setup.daily,
    }) : { save, xp: { total: 0, parts: [] }, levelBefore: 0, levelAfter: 0, unlocked: [], achievements: [], newBest: false, firstClear: false,
      previousBest: 0, streak: { days: save.streak.days, extended: false } } as Outcome;
    setResult({ summary, outcome, log: game.logs[0], scorings: [...game.scorings], events, keyStats, typing, typingAccuracy,
      hitOffsetMs: offsets.length >= 20 ? median(offsets) : null, offsets, windowMs: players[0].windowMs });
  }, [players, typing, setup, song, chart.durationMs, bot, save]);

  // Session events: sound, callouts and state.
  handler.current = event => {
    const game = session.current;
    if (!game) return;
    if (event.type === 'state') {
      setState(event.state);
      if (event.state === 'playing') { setError(''); if (game.audioContext) sfx.attach(game.audioContext); }
      if (event.state === 'finished') {
        sfx.stopCrowd();
        if (!matchRef.current) {
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
    score(event.player, event.event, game.scorings[event.player]);
  };

  function score(player: number, event: ScoreEvent, scoring: Scoring) {
    const pan = players.length > 1 ? (player ? 0.5 : -0.5) : 0;
    if (event.type === 'hit') {
      sfx.play(event.judgement === 'Perfect' ? 'hit-perfect' : event.judgement === 'Great' ? 'hit-great' : 'hit-good',
        { lane: layouts[player].column(event.lanes[0]) < 0 ? 0 : layouts[player].column(event.lanes[0]), pan });
      const combo = event.combo;
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
    } else if (event.type === 'miss' || event.type === 'drop') {
      sfx.play('miss', { pan });
      if (event.brokeCombo >= 10) {
        sfx.play('combo-break', { intensity: Math.min(1, event.brokeCombo / 100), pan });
        if (event.brokeCombo >= 50) callout('Streak lost', 'lost', player);
      }
      if (typing && event.type === 'miss') keyboard.current?.flash(typing.keys[event.lanes[0]], false);
    } else if (event.type === 'wrong') {
      sfx.play('wrong', { pan });
    } else if (event.type === 'sustain') {
      sfx.play('sustain-end', { pan });
    } else if (event.type === 'charged') {
      sfx.play('boost-ready', { pan });
      callout(`Amp charged! Press ${players[player].boostKey === 'Enter' ? 'Enter' : 'Space'}`, 'boost', player);
    } else if (event.type === 'boost') {
      sfx.play('boost-on', { pan });
      sfx.play('crowd-roar', { intensity: 0.8 });
      callout(setup.party && !setup.party.coop ? 'Overdrive attack!' : 'Overdrive! Double points', 'mega boost', player);
      if (setup.party && !setup.party.coop) sfx.play('attack', { pan: -pan });
    }
  }

  const start = useCallback((replay = false) => {
    sfx.play('ui-select');
    if (replay) {
      if (typing) { setAttempt(value => value + 1); return; }
      setResult(undefined);
    }
    void session.current?.start(replay);
  }, [typing]);

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
  useEffect(() => {
    if (!match?.startAt || state !== 'ready') return;
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
      if (game.state === 'ready' && (event.code === 'Enter' || event.code === 'Space')) {
        event.preventDefault();
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

  const modeLine = [typing ? setup.typing?.lesson?.title ?? 'Free typing' : difficultyNames[setup.difficulty],
    ...setup.mods.map(id => MODS[id].name)].join(' · ');
  const single = players.length === 1;
  const waitingForMatch = !!match && match.ready && match.startAt === null;
  const startLabel = state === 'starting' ? 'Loading audio…' : match ? match.startAt ? 'Join playback' : match.ready ? 'Ready' : 'Ready up' : 'Start';

  return <section className="stage" ref={stage} data-state={state} data-boost="off" data-heat="cool" data-players={players.length}
    data-typing={typing ? 'true' : undefined} data-calm={settings.calm ? 'true' : undefined} data-duel={match ? 'true' : undefined}
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
      label={setup.party ? setup.party.names[index] : undefined} showScore={!match}
      boostKey={player.boostKey === 'Enter' ? 'Enter' : 'Space'} />)}
    {setup.party && !setup.party.coop && <div className="versus-bar" ref={versus} aria-hidden="true"><i /></div>}
    {typing && <div className="word-ribbon" ref={ribbon} aria-hidden="true" />}
    {typing && settings.showKeyboard && <KeyboardGuide ref={keyboard} active={typing.keys} compact />}
    {setup.tutorial && tip >= 0 && state === 'playing' && <div className="coach" key={`tip-${tip}`} role="status">{TUTORIAL_TIPS[tip][1]}</div>}
    {count !== null && state === 'playing' && <div className="count-in" key={`count-${count}`} data-go={count === 0 ? 'true' : undefined}>
      <strong>{count === 0 ? (typing ? 'Type!' : 'Rock!') : count}</strong>
    </div>}

    {(state === 'ready' || state === 'starting') && !result && <div className="stage-cover">
      <div className="ready-card">
        <p className="eyebrow">{setup.tutorial ? 'Warm-up' : setup.daily ? 'Daily challenge' : setup.party ? (setup.party.coop ? 'Party co-op' : 'Party battle')
          : typing ? 'Typing academy' : setup.tour ? 'Tour' : match ? 'Online' : 'Quick play'}</p>
        <h2>{song.title}</h2>
        <p className="ready-mode">{modeLine} · {chart.bpm} BPM · {players[0].events.length} notes</p>
        {typing ? <>
          <p>Type each letter as its gem reaches the ring. Keep your fingers on the home row and use the finger with the matching colour.</p>
          {setup.typing?.lesson && <p className="ready-goal">{setup.typing.lesson.blurb} Pass with {setup.typing.lesson.goal.accuracy}% accuracy.</p>}
        </> : setup.party ? <div className="ready-party">
          {players.map((player, index) => <div key={index}><strong>{setup.party!.names[index]}</strong>
            <div className="ready-keys">{player.keys.map((key, lane) => <kbd key={key} style={{ '--lane': layouts[index].color(lane) } as CSSProperties}>{keyLabel(key)}</kbd>)}</div>
            <small>Overdrive: {player.boostKey === 'Enter' ? 'Enter' : 'Space'}</small></div>)}
        </div> : <>
          <div className="ready-keys" aria-label="Lane keys">{players[0].keys.map((key, lane) =>
            <kbd key={key} style={{ '--lane': layouts[0].color(lane) } as CSSProperties}>{keyLabel(key)}</kbd>)}</div>
          <p><span className="keyboard-only">Press the key when a gem hits its ring. </span><span className="touch-only">Tap the pads as gems reach the rings. </span>
            Hold long notes. Fill the amp, then press <kbd>Space</kbd> for double points.</p>
          {canFail[setup.difficulty] && !setup.tutorial && <p className="ready-goal">Keep the crowd happy. An empty crowd meter ends the set.</p>}
          {setup.mods.includes('sudden') && <p className="ready-goal">Sudden death: one missed note ends the set.</p>}
        </>}
        {readyExtra}
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary big" autoFocus disabled={state === 'starting' || waitingForMatch} onClick={() => start()}>{startLabel}</button>
        {!match && <p className="hint"><kbd>Enter</kbd> start · <kbd>Esc</kbd> back</p>}
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
        <p className="hint"><kbd>Esc</kbd> resume · <kbd>R</kbd> restart</p>
      </div>
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
      onReplay={() => start(true)} onExit={onExit} exitLabel={exitLabel} next={next?.(result)} />}
  </section>;
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
