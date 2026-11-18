import { useEffect, useRef } from 'react';
import type { Chart, SongEvent } from '../../shared/song';
import { Scoring } from '../../shared/scoring';
import { Highway, StageRenderer, type HighwayLook } from '../game/renderer';
import { botStep, newBot } from '../game/session';
import { laneLayout } from '../game/layouts';
import { DEFAULT_KEYS } from '../../shared/scoring';

const LOOP_MS = 48_000;

function demoChart(): { chart: Chart; events: SongEvent[] } {
  const beat = 500;
  const beatsMs = Array.from({ length: LOOP_MS / beat }, (_, index) => index * beat);
  const events: SongEvent[] = [];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let lane = 2;
  for (let time = 1500; time < LOOP_MS - 1500; time += random() < 0.3 ? 500 : 250) {
    lane = Math.max(0, Math.min(4, lane + Math.round(random() * 4 - 2)));
    const chord = random() < 0.16;
    const hold = !chord && random() < 0.1;
    events.push({ id: `demo-${events.length}`, timeMs: time, lanes: chord ? [...new Set([lane, (lane + 2) % 5])].sort((a, b) => a - b) : [lane], durationMs: hold ? 700 : 0 });
    if (hold) time += 750;
  }
  return { chart: { version: 1, durationMs: LOOP_MS, bpm: 120, beatsMs, downbeatsMs: beatsMs.filter((_, index) => index % 4 === 0), events: { normal: events, hard: events } }, events };
}

/** A highway that plays itself. Used on the title screen and to preview looks in the locker. */
export default function DemoHighway({ look, colors, skill = 0.97, crowd = false }: { look: Omit<HighwayLook, 'lookahead'>; colors: string[]; skill?: number; crowd?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const { chart, events } = demoChart();
    const renderer = new StageRenderer(canvas.current);
    renderer.showCrowd = crowd;
    renderer.mood = 0.9;
    let scoring = new Scoring(events, 110);
    let bot = newBot();
    const highway = new Highway(scoring, events, laneLayout(DEFAULT_KEYS, colors), { ...look, lookahead: 1700 });
    scoring.onEvent = event => highway.onScore(event, performance.now());
    renderer.setHighways([highway]);
    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe(canvas.current);
    const started = performance.now();
    let lap = 0;
    let frame = 0;
    const loop = () => {
      const elapsed = performance.now() - started;
      if (Math.floor(elapsed / LOOP_MS) !== lap) {
        lap = Math.floor(elapsed / LOOP_MS);
        scoring = new Scoring(events, 110);
        scoring.onEvent = event => highway.onScore(event, performance.now());
        bot = newBot();
        highway.reset(scoring, events);
      }
      const time = elapsed % LOOP_MS;
      botStep(scoring, events, bot, time, skill, lane => highway.press(lane, performance.now()));
      scoring.tick(time);
      renderer.draw(chart, time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [look.theme, look.gem, look.fx, look.hidden, look.calm, colors, skill, crowd]);
  return <canvas ref={canvas} className="demo-highway" aria-hidden="true" />;
}
