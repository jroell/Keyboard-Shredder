import type { Chart, Difficulty, SongEvent } from '../shared/song';

export interface Analysis {
  durationMs: number;
  beatsMs: number[];
  downbeatsMs: number[];
  notes: { startMs: number; endMs: number; pitch: number; strength: number }[];
}

export function buildChart({ durationMs, beatsMs, downbeatsMs, notes }: Analysis): Chart {
  if (durationMs < 5_000 || durationMs > 180_000 || beatsMs.length < 4) {
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
  const events = (difficulty: Difficulty): SongEvent[] => {
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
  return {
    version: 1, durationMs, bpm: Math.round(60_000 / intervals[Math.floor(intervals.length / 2)]),
    beatsMs, downbeatsMs, events: { normal: events('normal'), hard: events('hard') },
  };
}
