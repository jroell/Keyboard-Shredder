import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Star, Zap } from 'lucide-react';
import type { Chart, Difficulty, Song, SongEvent } from '../../../shared/song';
import { difficultyNames, hitWindows, notesFor } from '../../../shared/difficulty';
import { keyLabel, mapPracticeChart } from '../../../shared/practice';
import { Scoring } from '../../../shared/scoring';
import { palettes, type LaneInput, type Profile } from '../../../shared/duel';
import Highway from './Highway';
import { Transport, withAudioDeadline } from '../../lib/transport';

function storeBest(key: string, score: number) {
  try {
    const previous = Number(localStorage.getItem(key)) || 0;
    if (score > previous) localStorage.setItem(key, String(score));
    return { best: Math.max(previous, score), improved: score > previous };
  } catch {
    return { best: score, improved: false };
  }
}

type Match = {
  startAt: number | null; ready: boolean; ampCharge: number; boostEndMs: number | null; combo: number; onReady: () => Promise<void>; onInput: (input: LaneInput) => void; onBoost: (timeMs: number) => void;
};

export default function SoloGame({ song, chart, difficulty, audio, leadAudio, keys, calibration, leave, profile, match, practice }: {
  song: Song; chart: Chart; difficulty: Difficulty; audio: ArrayBuffer; leadAudio?: ArrayBuffer; keys: string[];
  calibration: number; leave: () => void; profile?: Profile; match?: Match; practice?: string;
}) {
  const [state, setState] = useState<'ready' | 'playing' | 'paused' | 'results'>('ready');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [record, setRecord] = useState({ best: 0, improved: false });
  const laneAction = useRef<(lane: number, down: boolean, timestamp: number) => void>(() => {});
  const boostAction = useRef<(timestamp: number) => void>(() => {});
  const touch = useRef(new Map<number, number>());
  const beatMs = Math.max(240, Math.min(850, 60_000 / chart.bpm));
  const events = useMemo(() => notesFor(practice ? mapPracticeChart(chart, keys) : chart, difficulty), [chart, difficulty, keys, practice]);
  const tapLengthMs = Math.max(460, Math.min(800, 60_000 / chart.bpm));
  const leadEnds = useMemo(() => new Map(events.map((event, index) => [
    event.id, Math.min(event.timeMs + (event.durationMs || tapLengthMs), events[index + 1]?.timeMs ?? chart.durationMs),
  ])), [events, tapLengthMs, chart.durationMs]);
  const palette = palettes[profile?.palette ?? 'Sunset'];
  const laneColors = keys.map((_, lane) => palette[lane % palette.length]);
  const trackMode = `${difficultyNames[difficulty]}${practice ? ` · ${practice}` : ''}`;
  const lookahead = profile?.speed ?? 1900;
  const matchRef = useRef(match);
  matchRef.current = match;
  const scoring = useRef<Scoring>(null);
  scoring.current ??= new Scoring(events, hitWindows[difficulty]);
  const context = useRef<AudioContext>(null);
  const transport = useRef<Transport>(null);
  const offset = useRef(0);
  const active = useRef(true);
  const pending = useRef(false);
  const primaryAction = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!match?.startAt || state !== 'ready' || !transport.current || pending.current) return;
    void play();
  }, [match?.startAt, state, starting]);

  useEffect(() => {
    if (state !== 'playing') primaryAction.current?.focus({ preventScroll: !!matchRef.current });
  }, [state]);
  const pauseAction = useRef<() => void>(() => {});

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      transport.current?.stop();
      if (context.current?.state !== 'closed') void context.current?.close().catch(() => {});
    };
  }, []);

  const play = async (replay = false) => {
    if (pending.current) return;
    pending.current = true;
    setStarting(true);
    setError('');
    try {
      if (!context.current) context.current = new AudioContext();
      const ctx = context.current;
      if (ctx.state !== 'running') {
        await withAudioDeadline(ctx.resume(), 'Audio did not start. Press Play to try again.');
      }
      if (!transport.current) {
        const [decoded, lead] = await withAudioDeadline(Promise.all([
          ctx.decodeAudioData(audio.slice(0)),
          leadAudio && ctx.decodeAudioData(leadAudio.slice(0)),
        ]), 'Audio could not be decoded. Press Play to try again.');
        transport.current = new Transport(ctx, decoded, lead);
      }
      if (!active.current) return;
      if (replay) {
        scoring.current = new Scoring(events, hitWindows[difficulty]);
        offset.current = 0;
        setTime(0);
      }
      const currentMatch = matchRef.current;
      if (currentMatch && currentMatch.startAt === null) {
        await currentMatch.onReady();
        return;
      }
      await transport.current.start(offset.current, beatMs * 3, currentMatch?.startAt ?? undefined);
      if (currentMatch && transport.current.timeMs() >= 150) {
        scoring.current.rejoin(transport.current.timeMs() - calibration, currentMatch.combo, currentMatch.ampCharge, currentMatch.boostEndMs);
      }
      if (active.current) setState('playing');
    } catch (reason) {
      transport.current?.stop();
      transport.current = null;
      if (context.current?.state !== 'closed') void context.current?.close().catch(() => {});
      context.current = null;
      if (active.current) setError(reason instanceof Error ? reason.message : 'Audio could not start.');
    } finally {
      pending.current = false;
      if (active.current) setStarting(false);
    }
  };

  useEffect(() => {
    if (state !== 'playing' || !transport.current) return;
    const playback = transport.current;
    let frame = 0;
    let leadEvent: SongEvent | undefined;
    const sound = (event: SongEvent, start = event.timeMs) => {
      if (leadEvent && event.timeMs < leadEvent.timeMs) return;
      playback.soundLead(start, leadEnds.get(event.id)!);
      leadEvent = event;
    };
    let lastAudioTime = playback.context.currentTime;
    let lastAudioUpdate = performance.now();
    const soundHeldSustain = (start: number) => {
      const held = [...scoring.current.sustaining.values()].find(event =>
        event !== leadEvent && event.lanes.every(lane => scoring.current.held.has(lane)));
      if (held) sound(held, start);
    };
    const pause = () => {
      if (matchRef.current) {
        playback.muteLead();
        const timeMs = Math.max(0, playback.inputTimeMs(performance.now()) - calibration);
        for (const lane of scoring.current.held) {
          scoring.current.release(lane, timeMs);
          matchRef.current.onInput({ lane, down: false, timeMs });
        }
        return;
      }
      offset.current = Math.min(playback.buffer.duration * 1000 - 1, Math.max(offset.current, playback.timeMs()));
      playback.stop();
      scoring.current.pause(offset.current - calibration);
      setState('paused');
    };
    pauseAction.current = pause;
    const laneInput = (lane: number, down: boolean, timestamp: number) => {
      const inputTime = playback.inputTimeMs(timestamp);
      const timeMs = inputTime - calibration;
      if (!down) {
        scoring.current.release(lane, timeMs);
        if (leadEvent?.durationMs && leadEvent.lanes.includes(lane) && inputTime < leadEnds.get(leadEvent.id)!) {
          playback.muteLead();
          leadEvent = undefined;
        }
        matchRef.current?.onInput({ lane, down: false, timeMs });
      } else if (inputTime >= offset.current) {
        const hit = scoring.current.press(lane, timeMs);
        if (hit) sound(hit);
        else soundHeldSustain(inputTime);
        matchRef.current?.onInput({ lane, down: true, timeMs });
      } else {
        scoring.current.regrip(lane);
        soundHeldSustain(offset.current);
      }
    };
    laneAction.current = laneInput;
    boostAction.current = timestamp => {
      const inputTime = playback.inputTimeMs(timestamp);
      if (inputTime < offset.current) return;
      const timeMs = inputTime - calibration;
      if (scoring.current.activateBoost(timeMs)) matchRef.current?.onBoost(timeMs);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        pause();
        return;
      }
      if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        if (!event.repeat) boostAction.current(event.timeStamp);
        return;
      }
      const lane = keys.indexOf(event.code);
      if (lane === -1 || event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      if (!event.repeat) laneInput(lane, true, event.timeStamp);
    };
    const keyup = (event: KeyboardEvent) => {
      const lane = keys.indexOf(event.code);
      if (lane >= 0) laneInput(lane, false, event.timeStamp);
    };
    const visibility = () => { if (document.hidden) pause(); };
    const animate = () => {
      const now = playback.timeMs();
      if (playback.context.currentTime > lastAudioTime) {
        lastAudioTime = playback.context.currentTime;
        lastAudioUpdate = performance.now();
      } else if (performance.now() - lastAudioUpdate > 3500) {
        playback.stop();
        void playback.context.close().catch(() => {});
        transport.current = null;
        context.current = null;
        if (matchRef.current) {
          for (const lane of scoring.current.held) {
            matchRef.current.onInput({ lane, down: false, timeMs: Math.max(0, now - calibration) });
          }
        }
        offset.current = matchRef.current ? 0 : Math.max(offset.current, now);
        scoring.current.pause(now - calibration);
        setError('Audio stopped advancing. Press Resume to reconnect playback.');
        setState('paused');
        return;
      }
      if (now >= offset.current) scoring.current.tick(now - calibration);
      setTime(now);
      if (now >= playback.buffer.duration * 1000 + Math.max(calibration, 0)) {
        scoring.current.finish();
        if (!matchRef.current) setRecord(storeBest(`shredder-best:${song.id}:${difficulty}${practice ? `:${keys.join(',')}` : ''}`, scoring.current.score));
        playback.stop();
        setState('results');
      } else frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    return () => {
      cancelAnimationFrame(frame);
      touch.current.clear();
      laneAction.current = () => {};
      boostAction.current = () => {};
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  }, [state, keys, calibration, song.id, difficulty, leadEnds, practice]);

  const game = scoring.current;
  const chartTime = time - calibration;
  const boosted = game.boosting(chartTime);
  const charge = boosted ? Math.min(100, game.boostRemaining(chartTime) / 60) : game.ampCharge;
  const feedback = state === 'playing' && game.feedback && chartTime - game.feedback.timeMs < 650
    ? game.feedback : null;
  const timing = feedback?.offsetMs
    ? `${Math.abs(feedback.offsetMs)} ms ${feedback.offsetMs < 0 ? 'early' : 'late'}`
    : feedback?.offsetMs === 0 ? 'On time' : '';
  const missed = feedback?.judgement === 'Miss' || feedback?.judgement === 'Sustain dropped' || feedback?.judgement === 'Wrong key';
  if (state === 'results') {
    if (match) return <p role="status">Waiting for final duel scores…</p>;
    const stars = [20, 40, 60, 80, 95].filter(threshold => game.accuracy >= threshold).length;
    const availableChords = events.filter(event => event.lanes.length > 1).length;
    const laneTotals = keys.map((_, lane) => events.filter(event => event.lanes.includes(lane)).length);
    return <section className="panel results stage-results finale">
      <header><h1>Track complete</h1><p>{song.title} · {trackMode}</p></header>
      <div className="finale-score">
        <div className="finale-stars" role="img" aria-label={`${stars} out of 5 stars`}>
          {Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true" size={30}
            className={index < stars ? 'earned' : ''} />)}
        </div>
        <span>Final score</span>
        <strong>{game.score.toLocaleString()}</strong>
        <p>{record.improved ? 'New personal best' : `Personal best ${record.best.toLocaleString()}`}</p>
      </div>
      <dl><div><dt>Accuracy</dt><dd>{game.hits > 0 && game.accuracy === 0 ? '<1' : game.accuracy}%</dd></div>
        <div><dt>Best combo</dt><dd>{game.bestCombo}</dd></div>
        <div><dt>Notes hit</dt><dd>{game.hits}/{events.length}</dd></div>
        {availableChords > 0 && <div><dt>Chords hit</dt><dd>{game.chordsHit}/{availableChords}</dd></div>}
        {game.boostHits > 0 && <div><dt>Boosted hits</dt><dd>{game.boostHits}</dd></div>}</dl>
      {practice && <section className="practice-breakdown" aria-label="Hits by key">
        <h2>Hits by key</h2>
        <ul>{keys.map((key, lane) => <li key={key}><kbd>{keyLabel(key)}</kbd>
          <span>{game.hitsByLane.get(lane) ?? 0}/{laneTotals[lane]}</span></li>)}</ul>
      </section>}
      {game.wrongKeys > 0 && <p>{game.wrongKeys} extra presses</p>}
      {error && <p role="alert">{error}</p>}
      <button ref={primaryAction} className="primary" disabled={starting} onClick={() => void play(true)}>Replay</button>
      <button onClick={leave}>Back to studio</button>
    </section>;
  }

  return <section className="play performance" data-practice={practice ? 'true' : undefined} data-duel={match ? 'true' : undefined} data-boost={boosted ? 'on' : undefined}>
    <header className="game-header"><div><h1>{song.title}</h1><p>{trackMode} · {chart.bpm} BPM</p></div>
      <div className="game-actions">
        {state === 'playing' && !match && <button onClick={() => pauseAction.current()}>Pause</button>}
        {!match && <button onClick={leave}>Exit track</button>}
      </div></header>
    <div className="hud">
      <div className="stage-score">
        {!match && <strong>Score {game.score.toLocaleString()}</strong>}
        <div className="stage-streak">
          {!match && <strong>{game.combo} combo</strong>}
          <span aria-label="Score multiplier">{game.multiplier(chartTime)}×</span>
        </div>
        <div className="crowd-console">
          <span>Crowd</span><meter aria-label="Crowd energy" min={0} max={100} value={game.crowd} />
        </div>
      </div>
    </div>
    <div className="board concert-board" data-combo={game.combo >= 25 ? 'high' : undefined}>
      <Highway chart={chart} events={events} time={chartTime} lookahead={lookahead}
        colors={laneColors} keys={keys} game={game} feedback={feedback} missed={missed} practice={!!practice} />
      {feedback && <div key={feedback.timeMs} data-judged-at={feedback.timeMs} className={`hit-callout${missed ? ' hit-callout-miss' : ''}`}>
        <strong>{feedback.judgement}{feedback.points ? ` +${feedback.points}` : ''}</strong>
        {timing && <small>{timing}</small>}
      </div>}
      {state !== 'playing' && <div className="board-cover">
        <div className="stage-prompt">
          <p>{state === 'paused' ? 'Paused' : <>
            <span className="keyboard-instructions">Press the lane keys at the line.</span>
            <span className="touch-instructions">Tap the pads as notes reach the line.</span>
            {' '}Press chords together and hold long notes. Fill the amp to boost your score.
          </>}</p>
          {state === 'ready' && <p>{leadAudio ? 'Hit notes to bring in the guitar.' : 'This recording plays as a full mix.'}</p>}
          {state === 'paused' && game.sustaining.size > 0 && <p>Hold the sustain keys again as playback resumes.</p>}
          {state === 'ready' && <div className="ready-keys" aria-label="Lane keys">{keys.map(key =>
            <kbd key={key}>{keyLabel(key)}</kbd>)}</div>}
          {error && <p role="alert">{error}</p>}
          <button ref={primaryAction} className="primary" disabled={starting || !!(match?.ready && match.startAt === null)} onClick={() => void play()}>
            {starting ? 'Loading audio…' : state === 'paused' ? 'Resume' : match ? match.startAt ? 'Join playback' : match.ready ? 'Ready' : 'Ready up' : 'Play'}
          </button>
        </div>
      </div>}
      {state === 'playing' && time < offset.current && <div className="count-in">
        <span>Get ready</span><strong>{Math.min(3, Math.max(1, Math.ceil((offset.current - time) / beatMs)))}</strong>
      </div>}
    </div>
    {state === 'playing' && <div className="touch-pads" aria-label="Touch fret pads"
      style={{ '--pad-columns': Math.min(keys.length, 6) } as CSSProperties}>
      {keys.map((key, lane) => <button type="button" key={key}
        aria-label={`Play lane ${lane + 1}`} className={game.held.has(lane) ? 'pressed' : ''} style={{ color: laneColors[lane] }}
        onPointerDown={event => {
          if ([...touch.current.values()].includes(lane)) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          touch.current.set(event.pointerId, lane);
          laneAction.current(lane, true, event.timeStamp);
        }}
        onLostPointerCapture={event => {
          if (!touch.current.delete(event.pointerId)) return;
          laneAction.current(lane, false, event.timeStamp);
        }}><span>{keyLabel(key)}</span></button>)}
    </div>}
    <div className="amp-console" data-charged={game.ampCharge === 100 ? 'true' : undefined}>
      <div className="amp-display">
        <span><Zap size={15} aria-hidden="true" /> {boosted ? 'Boost active' : 'Amp charge'}</span>
        <meter aria-label={boosted ? 'Boost remaining' : 'Amp charge'} min={0} max={100} value={charge} />
      </div>
      <button type="button" disabled={state !== 'playing' || game.ampCharge < 100 || boosted}
        onClick={event => boostAction.current(event.timeStamp)}>
        Boost <kbd>Space</kbd>
      </button>
    </div>
    <progress aria-label="Track progress" value={Math.max(0, time)} max={chart.durationMs} />
  </section>;
}
