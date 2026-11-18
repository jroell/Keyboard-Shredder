import type { Chart, Difficulty, SongEvent } from './song';

export const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert'];
export const difficultyNames: Record<Difficulty, string> = {
  beginner: 'Beginner', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert',
};
export const difficultyBlurbs: Record<Difficulty, string> = {
  beginner: 'Three keys, one note per beat. Nobody gets booed off.',
  easy: 'Five keys, single notes, relaxed timing.',
  medium: 'Faster riffs and a few two-key chords.',
  hard: 'Full riffs with chords. A bad set can lose the crowd.',
  expert: 'Every note of the solo. Tight timing. No mercy.',
};
export const hitWindows: Record<Difficulty, number> = { beginner: 160, easy: 135, medium: 115, hard: 100, expert: 85 };
/** Difficulties where an empty crowd meter ends the song. */
export const canFail: Record<Difficulty, boolean> = { beginner: false, easy: false, medium: false, hard: true, expert: true };

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}

export function easyChart(chart: Chart): SongEvent[] {
  const events: SongEvent[] = [];
  const spacing = Math.max(300, Math.min(600, 45_000 / chart.bpm));
  for (const note of chart.events.normal) {
    if (note.timeMs - (events.at(-1)?.timeMs ?? -Infinity) < spacing) continue;
    events.push({ ...note, id: `easy-${events.length}`, lanes: [note.lanes.at(-1)!] });
  }
  return events;
}

/** Three centre lanes, at most one note per beat, no chords. */
export function beginnerChart(chart: Chart): SongEvent[] {
  const events: SongEvent[] = [];
  const beat = 60_000 / Math.max(40, chart.bpm);
  const spacing = Math.max(480, Math.min(900, beat));
  const centre = [1, 1, 2, 3, 3];
  for (const note of chart.events.easy ?? easyChart(chart)) {
    const previous = events.at(-1);
    if (previous && note.timeMs - previous.timeMs < spacing) continue;
    const durationMs = note.durationMs >= 400 ? Math.min(note.durationMs, Math.round(beat * 2)) : 0;
    events.push({ id: `beginner-${events.length}`, timeMs: note.timeMs, lanes: [centre[note.lanes[0]] ?? 2], durationMs });
  }
  for (let i = 0; i < events.length - 1; i++) {
    const room = events[i + 1].timeMs - events[i].timeMs - 160;
    if (events[i].durationMs > room) events[i].durationMs = room >= 400 ? room : 0;
  }
  return events;
}

/** The normal chart with most chords thinned to single notes. */
export function mediumChart(chart: Chart): SongEvent[] {
  const source = chart.events.normal;
  let chords = 0;
  return source.map((note, index) => {
    if (note.lanes.length < 2) return { ...note, id: `medium-${index}` };
    const before = note.timeMs - (source[index - 1]?.timeMs ?? -Infinity);
    const after = (source[index + 1]?.timeMs ?? Infinity) - note.timeMs;
    const span = note.lanes.at(-1)! - note.lanes[0];
    const keep = span <= 2 && before >= 300 && after >= 240 && chords++ % 2 === 0;
    return { ...note, id: `medium-${index}`, lanes: keep ? note.lanes.slice(0, 2) : [note.lanes[index % 2 ? note.lanes.length - 1 : 0]] };
  });
}

const cache = new WeakMap<Chart, Partial<Record<Difficulty, SongEvent[]>>>();

export function notesFor(chart: Chart, difficulty: Difficulty): SongEvent[] {
  let entry = cache.get(chart);
  if (!entry) cache.set(chart, entry = {});
  return entry[difficulty] ??= difficulty === 'beginner' ? beginnerChart(chart)
    : difficulty === 'easy' ? chart.events.easy ?? easyChart(chart)
    : difficulty === 'medium' ? mediumChart(chart)
    : difficulty === 'hard' ? chart.events.normal
    : chart.events.hard;
}
