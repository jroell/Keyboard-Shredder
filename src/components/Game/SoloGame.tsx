import { useEffect, useRef, useState } from 'react';
import type { Chart, Difficulty, Song } from '../../../shared/song';
import { Scoring } from '../../lib/scoring';
import { Transport, withAudioDeadline } from '../../lib/transport';

const laneColors = ['#ff8757', '#ffc66b', '#87dcae', '#78b9ff', '#e0a2ff'];
const lookahead = 1900;

export default function SoloGame({ song, chart, difficulty, audio, keys, calibration, leave }: {
  song: Song; chart: Chart; difficulty: Difficulty; audio: ArrayBuffer; keys: string[];
  calibration: number; leave: () => void;
}) {
  const [state, setState] = useState<'ready' | 'playing' | 'paused' | 'results'>('ready');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const events = chart.events[difficulty];
  const scoring = useRef<Scoring>(null);
  scoring.current ??= new Scoring(events, difficulty === 'hard' ? 80 : 95);
  const context = useRef<AudioContext>(null);
  const transport = useRef<Transport>(null);
  const offset = useRef(0);
  const active = useRef(true);
  const pending = useRef(false);
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
      await transport.current.start(offset.current);
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
      offset.current = Math.min(playback.buffer.duration * 1000 - 1, Math.max(offset.current, playback.timeMs()));
      playback.stop();
      scoring.current.clearInput();
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
      if (!event.repeat) scoring.current.press(lane, playback.timeMs(event.timeStamp) - calibration);
    };
    const keyup = (event: KeyboardEvent) => {
      const lane = keys.indexOf(event.code);
      if (lane >= 0) scoring.current.release(lane, playback.timeMs(event.timeStamp) - calibration);
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
        scoring.current.clearInput();
        offset.current = Math.max(offset.current, now);
        setError('Audio stopped advancing. Press Resume to reconnect playback.');
        setState('paused');
        return;
      }
      scoring.current.tick(now - calibration);
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
  if (state === 'results') {
    const accuracy = Math.round(game.hits * 100 / events.length);
    return <section className="panel results">
      <h1>Track complete</h1><p>{song.title}</p>
      <dl><div><dt>Score</dt><dd>{game.score}</dd></div><div><dt>Accuracy</dt><dd>{accuracy}%</dd></div>
        <div><dt>Best combo</dt><dd>{game.bestCombo}</dd></div></dl>
      <p>{game.hits} hits · {game.misses} misses</p>
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={starting} onClick={() => void play(true)}>Replay</button>
      <button onClick={leave}>Back to studio</button>
    </section>;
  }

  return <section className="play">
    <header className="game-header"><div><h1>{song.title}</h1><p>{difficulty === 'normal' ? 'Normal' : 'Hard'} · {chart.bpm} BPM</p></div>
      <div className="game-actions">
        {state === 'playing' && <button onClick={() => pauseAction.current()}>Pause</button>}
        <button onClick={leave}>Exit track</button>
      </div></header>
    <div className="hud"><strong>Score {game.score}</strong><span>{game.judgement}</span><strong>{game.combo} combo</strong></div>
    <div className="board">
      <div aria-hidden="true">
      <div className="lanes">{keys.map((key, lane) => <div className="lane" key={key} style={{ color: laneColors[lane] }}>
        <span className={game.held.has(lane) ? 'target held' : 'target'}>{key.replace(/^(Key|Digit)/, '')}</span>
      </div>)}</div>
      {chart.beatsMs.filter(beat => beat >= time && beat <= time + lookahead).map(beat =>
        <div key={beat} className={chart.downbeatsMs.includes(beat) ? 'beat downbeat' : 'beat'} style={{ bottom: `${12 + (beat - time) * 75 / lookahead}%` }} />)}
      {events.filter(event => event.timeMs + event.durationMs > time - 130 && event.timeMs < time + lookahead &&
        (!game.consumed.has(event.id) || game.sustaining.has(event.id))).flatMap(event =>
        event.lanes.map(lane => <div className="note" key={event.id + ':' + lane} style={{
          left: `${lane * 20 + 10}%`, bottom: `${12 + Math.max(event.timeMs - time, -130) * 75 / lookahead}%`, color: laneColors[lane],
          height: `${Math.max(0, event.durationMs - Math.max(0, time - event.timeMs)) * 75 / lookahead}%`,
        }} />))}
      </div>
      {state !== 'playing' && <div className="board-cover">
        <p>{state === 'paused' ? 'Paused' : 'Press the lane keys when notes reach the line. Hold for long notes.'}</p>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={starting} onClick={() => void play()}>
          {starting ? 'Loading audio…' : state === 'paused' ? 'Resume' : 'Play'}
        </button>
      </div>}
      {state === 'playing' && time < offset.current && <div className="count-in">Get ready</div>}
    </div>
    <progress aria-label="Track progress" value={Math.max(0, time)} max={chart.durationMs} />
  </section>;
}
