import type { Chart, Difficulty, SongEvent } from './song';

export const difficultyNames: Record<Difficulty, string> = {
  easy: 'Easy', normal: 'Normal', hard: 'Hard',
};
export const hitWindows: Record<Difficulty, number> = { easy: 120, normal: 95, hard: 80 };

export function easyChart(chart: Chart): SongEvent[] {
  const events: SongEvent[] = [];
  const spacing = Math.max(300, Math.min(600, 45_000 / chart.bpm));
  for (const note of chart.events.normal) {
    if (note.timeMs - (events.at(-1)?.timeMs ?? -Infinity) < spacing) continue;
    events.push({ ...note, id: `easy-${events.length}`, lanes: [note.lanes.at(-1)!] });
  }
  return events;
}

export function notesFor(chart: Chart, difficulty: Difficulty) {
  return chart.events[difficulty] ?? easyChart(chart);
}
