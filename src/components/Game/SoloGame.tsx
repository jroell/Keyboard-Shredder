import { useEffect, useRef, useState } from 'react';
import type { Chart, Difficulty, Song } from '../../../shared/song';
import { Scoring } from '../../../shared/scoring';
import { palettes, type LaneInput, type Profile } from '../../../shared/duel';
import { Transport, withAudioDeadline } from '../../lib/transport';

type Match = {
  startAt: number | null; ready: boolean; onReady: () => Promise<void>; onInput: (input: LaneInput) => void;
};

export default function SoloGame({ song, chart, difficulty, audio, keys, calibration, leave, profile, match }: {
  song: Song; chart: Chart; difficulty: Difficulty; audio: ArrayBuffer; keys: string[];
  calibration: number; leave: () => void; profile?: Profile; match?: Match;
}) {
  const [state, setState] = useState<'ready' | 'playing' | 'paused' | 'results'>('ready');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const events = chart.events[difficulty];
  const laneColors = palettes[profile?.palette ?? 'Sunset'];
  const lookahead = profile?.speed ?? 1900;
  const matchRef = useRef(match);
  matchRef.current = match;
  const scoring = useRef<Scoring>(null);
  scoring.current ??= new Scoring(events, difficulty === 'hard' ? 80 : 95);
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
    if (state !== 'playing') primaryAction.current?.focus();
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
        const decoded = await withAudioDeadline(ctx.decodeAudioData(audio.slice(0)), 'Audio could not be decoded. Press Play to try again.');
        transport.current = new Transport(ctx, decoded);
      }
      if (!active.current) return;
      if (replay) {
        scoring.current = new Scoring(events, difficulty === 'hard' ? 80 : 95);
        offset.current = 0;
        setTime(0);
      }
      const currentMatch = matchRef.current;
      if (currentMatch && currentMatch.startAt === null) {
        await currentMatch.onReady();
        return;
      }
      await transport.current.start(offset.current, 650, currentMatch?.startAt ?? undefined);
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
    let lastAudioTime = playback.context.currentTime;
    let lastAudioUpdate = performance.now();
    const pause = () => {
      if (matchRef.current) {
        const timeMs = Math.max(0, playback.timeMs() - calibration);
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
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        pause();
        return;
      }
      const lane = keys.indexOf(event.code);
      if (lane === -1 || event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      if (event.repeat) return;
      const inputTime = playback.timeMs(event.timeStamp);
      if (inputTime >= offset.current) {
        const timeMs = inputTime - calibration;
        scoring.current.press(lane, timeMs);
        matchRef.current?.onInput({ lane, down: true, timeMs });
      } else scoring.current.regrip(lane);
    };
    const keyup = (event: KeyboardEvent) => {
      const lane = keys.indexOf(event.code);
      if (lane >= 0) {
        const timeMs = playback.timeMs(event.timeStamp) - calibration;
        scoring.current.release(lane, timeMs);
        matchRef.current?.onInput({ lane, down: false, timeMs });
      }
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
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  }, [state, keys, calibration]);

  const game = scoring.current;
  const chartTime = time - calibration;
  const feedback = state === 'playing' && game.feedback && chartTime - game.feedback.timeMs < 650
    ? game.feedback : null;
  const timing = feedback?.offsetMs
    ? `${Math.abs(feedback.offsetMs)} ms ${feedback.offsetMs < 0 ? 'early' : 'late'}`
    : feedback?.offsetMs === 0 ? 'On time' : '';
  const missed = feedback?.judgement === 'Miss' || feedback?.judgement === 'Sustain dropped' || feedback?.judgement === 'Wrong key';
  if (state === 'results') {
    if (match) return <p role="status">Waiting for final duel scores…</p>;
    return <section className="panel results">
      <h1>Track complete</h1><p>{song.title}</p>
      <dl><div><dt>Score</dt><dd>{game.score}</dd></div><div><dt>Accuracy</dt><dd>{game.accuracy}%</dd></div>
        <div><dt>Best combo</dt><dd>{game.bestCombo}</dd></div></dl>
      <p>{game.hits} hits · {game.misses} misses{game.wrongKeys > 0 && ` · ${game.wrongKeys} extra presses`}</p>
      {error && <p role="alert">{error}</p>}
      <button ref={primaryAction} className="primary" disabled={starting} onClick={() => void play(true)}>Replay</button>
      <button onClick={leave}>Back to studio</button>
    </section>;
  }

  return <section className="play">
    <header className="game-header"><div><h1>{song.title}</h1><p>{difficulty === 'normal' ? 'Normal' : 'Hard'} · {chart.bpm} BPM</p></div>
      <div className="game-actions">
        {state === 'playing' && !match && <button onClick={() => pauseAction.current()}>Pause</button>}
        {!match && <button onClick={leave}>Exit track</button>}
      </div></header>
    <div className="hud"><strong>Score {game.score}</strong><span className="hit-feedback">{feedback?.judgement}{timing && <small>{timing}</small>}</span><strong>{game.combo} combo</strong></div>
    <div className="board">
      <div aria-hidden="true">
      <div className="strike-line" />
      <div className="lanes">{keys.map((key, lane) => <div className="lane" key={key} style={{ color: laneColors[lane] }}>
        <span className={`target${game.held.has(lane) ? ' held' : ''}${feedback?.lanes.includes(lane) ? missed ? ' missed' : ' hit' : ''}`}>{key.replace(/^(Key|Digit)/, '')}</span>
      </div>)}</div>
      {chart.beatsMs.filter(beat => beat >= chartTime && beat <= chartTime + lookahead).map(beat =>
        <div key={beat} className={chart.downbeatsMs.includes(beat) ? 'beat downbeat' : 'beat'} style={{ bottom: `${12 + (beat - chartTime) * 75 / lookahead}%` }} />)}
      {events.filter(event => event.timeMs + event.durationMs > chartTime - 130 && event.timeMs < chartTime + lookahead &&
        (!game.consumed.has(event.id) || game.sustaining.has(event.id))).flatMap(event =>
        event.lanes.map(lane => <div className="note" key={event.id + ':' + lane} style={{
          left: `${lane * 20 + 10}%`, bottom: `${12 + Math.max(event.timeMs - chartTime, -130) * 75 / lookahead}%`, color: laneColors[lane],
          height: `${Math.max(0, event.durationMs - Math.max(0, chartTime - event.timeMs)) * 75 / lookahead}%`,
        }} />))}
      </div>
      {state !== 'playing' && <div className="board-cover">
        <p>{state === 'paused' ? 'Paused' : 'Press the lane keys at the line. Press chords together and hold long notes.'}</p>
        {state === 'paused' && game.sustaining.size > 0 && <p>Hold the sustain keys again as playback resumes.</p>}
        {state === 'ready' && <div className="ready-keys" aria-label="Lane keys">{keys.map(key =>
          <kbd key={key}>{key.replace(/^(Key|Digit)/, '')}</kbd>)}</div>}
        {error && <p role="alert">{error}</p>}
        <button ref={primaryAction} className="primary" disabled={starting || !!(match?.ready && match.startAt === null)} onClick={() => void play()}>
          {starting ? 'Loading audio…' : state === 'paused' ? 'Resume' : match ? match.startAt ? 'Join playback' : match.ready ? 'Ready' : 'Ready up' : 'Play'}
        </button>
      </div>}
      {state === 'playing' && time < offset.current && <div className="count-in">Get ready</div>}
    </div>
    <progress aria-label="Track progress" value={Math.max(0, time)} max={chart.durationMs} />
  </section>;
}
