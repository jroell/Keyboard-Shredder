import { easyChart } from '../shared/difficulty';
import type { Chart, SongEvent } from '../shared/song';

export interface Analysis {
  durationMs: number;
  beatsMs: number[];
  downbeatsMs: number[];
  notes: { startMs: number; endMs: number; pitch: number; strength: number }[];
}

/**
 * A long run of one repeated shape reads as static. This varies such a run bar by bar: two bars as written,
 * one bar moved over a lane, then a bar that ends on the moved shape as an answer. Times and note counts stay the same.
 */
export function developRiffs(events: SongEvent[], downbeatsMs: readonly number[], minRun = 8): SongEvent[] {
  const result = events.map(event => ({ ...event, lanes: [...event.lanes] }));
  const same = (a: SongEvent, b: SongEvent) => a.lanes.length === b.lanes.length && a.lanes.every((lane, index) => lane === b.lanes[index]);
  const barOf = (timeMs: number) => {
    let bar = 0;
    while (bar + 1 < downbeatsMs.length && downbeatsMs[bar + 1] <= timeMs) bar++;
    return bar;
  };
  for (let start = 0; start < events.length;) {
    let end = start;
    while (end + 1 < events.length && same(events[end + 1], events[start])) end++;
    if (end - start + 1 >= minRun) {
      const lanes = events[start].lanes;
      const shift = lanes.at(-1)! < 4 ? 1 : -1;
      const moved = lanes.map(lane => lane + shift);
      const firstBar = barOf(events[start].timeMs);
      for (let index = start; index <= end; index++) {
        // Without downbeats, four notes stand in for a bar.
        const bar = downbeatsMs.length > 1 ? barOf(events[index].timeMs) - firstBar : Math.floor((index - start) / 4);
        const lastInBar = index === end || (downbeatsMs.length > 1 ? barOf(events[index + 1].timeMs) - firstBar !== bar : (index - start) % 4 === 3);
        if (bar % 4 === 2 || (bar % 4 === 3 && lastInBar)) result[index].lanes = [...moved];
      }
    }
    start = end + 1;
  }
  // A hold may not run into a later note on the same lane.
  for (let index = result.length - 1; index >= 0; index--) {
    const event = result[index];
    if (!event.durationMs) continue;
    const next = result.slice(index + 1).find(other => other.lanes.some(lane => event.lanes.includes(lane)));
    if (next) event.durationMs = Math.max(0, Math.min(event.durationMs, next.timeMs - event.timeMs - 70));
    if (event.durationMs < 240) event.durationMs = 0;
  }
  return result;
}

export function buildChart({ durationMs, beatsMs, downbeatsMs, notes }: Analysis): Chart {
  if (durationMs < 5_000 || durationMs > 240_000 || beatsMs.length < 4) {
    throw new Error('The recording did not contain enough usable rhythm information.');
  }
  const filtered = notes.filter(note => note.strength >= 0.25 &&
    note.startMs >= 0 && note.startMs < durationMs && note.endMs > note.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const pitches = [...new Set(filtered.map(note => note.pitch))].sort((a, b) => a - b);
  const groups: (typeof filtered)[] = [];
  for (const note of filtered) {
    const group = groups.at(-1);
    if (group && note.startMs - group[0].startMs <= 35) group.push(note);
    else groups.push([note]);
  }
  const grid = beatsMs.flatMap((beat, i) => {
    const next = beatsMs[i + 1];
    return next === undefined ? [beat] : [0, 1, 2, 3].map(n => beat + n * (next - beat) / 4);
  });
  const events = (difficulty: 'normal' | 'hard'): SongEvent[] => {
    const chart: SongEvent[] = [];
    const normal = difficulty === 'normal';
    for (const group of groups) {
      const strongest = [...group].sort((a, b) => b.strength - a.strength);
      const onset = group[0].startMs;
      const nearest = grid.reduce((best, next) => Math.abs(next - onset) < Math.abs(best - onset) ? next : best);
      const timeMs = Math.round(Math.abs(nearest - onset) <= 25 ? nearest : onset);
      if (timeMs >= durationMs || timeMs - (chart.at(-1)?.timeMs ?? -Infinity) < (normal ? 145 : 95)) continue;
      if (normal && strongest[0].strength < 0.32) continue;
      const laneFor = (pitch: number) => pitches.length === 1 ? 2 : Math.round(pitches.indexOf(pitch) * 4 / (pitches.length - 1));
      const available = [...new Set(strongest.map(note => laneFor(note.pitch)))];
      const lanes = available.slice(0, normal ? 2 : 3).sort((a, b) => a - b);
      if (lanes.length === 3 && (lanes[2] - lanes[0] > 3 || available.length > 3)) lanes.pop();
      const sustain = Math.min(durationMs, ...lanes.map(lane =>
        strongest.find(note => laneFor(note.pitch) === lane)!.endMs)) - timeMs;
      chart.push({ id: `${difficulty}-${chart.length}`, timeMs, lanes, durationMs: sustain >= 240 ? Math.round(sustain) : 0 });
    }
    for (let i = chart.length - 1; i >= 0; i--) {
      const event = chart[i];
      const next = chart.slice(i + 1).find(other => other.lanes.some(lane => event.lanes.includes(lane)));
      if (next && event.durationMs) event.durationMs = Math.max(0, Math.min(event.durationMs, next.timeMs - event.timeMs - 70));
      if (event.durationMs < 240) event.durationMs = 0;
    }
    if (chart.length < Math.max(8, Math.floor(durationMs / 3000))) {
      throw new Error('This recording has too few clear guitar attacks. Try a prompt with a stronger lead riff.');
    }
    return chart;
  };
  const intervals = beatsMs.slice(1).map((beat, i) => beat - beatsMs[i]).filter(value => value > 0).sort((a, b) => a - b);
  if (!intervals.length) throw new Error('The beat tracker did not return a usable tempo.');
  const chart: Chart = {
    version: 1, durationMs, bpm: Math.round(60_000 / intervals[Math.floor(intervals.length / 2)]),
    beatsMs, downbeatsMs, events: { normal: developRiffs(events('normal'), downbeatsMs), hard: developRiffs(events('hard'), downbeatsMs) },
  };
  chart.events.easy = easyChart(chart);
  return chart;
}
