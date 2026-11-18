import type { Difficulty, SongEvent } from './song';

export type PracticeTally = { attempts: number; hits: number; timingTotal: number };
export type PracticeRun = {
  playedAt: number;
  title: string;
  layout: string;
  difficulty: Difficulty;
  notes: PracticeTally;
  keys: Record<string, PracticeTally>;
  chords: Record<string, PracticeTally>;
};

const blankTally = (): PracticeTally => ({ attempts: 0, hits: 0, timingTotal: 0 });

export function summarizePractice(
  track: Pick<PracticeRun, 'title' | 'layout' | 'difficulty'>,
  keys: readonly string[],
  events: readonly SongEvent[],
  hitOffsets: ReadonlyMap<string, number>,
): PracticeRun {
  const run: PracticeRun = { ...track, playedAt: Date.now(), notes: blankTally(), keys: {}, chords: {} };
  for (const event of events) {
    const labels = event.lanes.map(lane => keys[lane]);
    const offset = hitOffsets.get(event.id);
    const target = labels.length > 1
      ? run.chords[labels.sort().join('+')] ??= blankTally()
      : run.keys[labels[0]] ??= blankTally();
    const tallies = [run.notes, target];
    for (const tally of tallies) {
      tally.attempts++;
      if (offset !== undefined) {
        tally.hits++;
        tally.timingTotal += Math.abs(offset);
      }
    }
  }
  return run;
}

export function hitRate(tally: PracticeTally) {
  return tally.attempts ? Math.round(100 * tally.hits / tally.attempts) : 0;
}

export function rateChange(current: PracticeTally, prior: PracticeTally) {
  return Math.round(100 * (current.hits / current.attempts - prior.hits / prior.attempts));
}

export function combineTallies(tallies: readonly PracticeTally[]) {
  return tallies.reduce((result, tally) => {
    result.attempts += tally.attempts;
    result.hits += tally.hits;
    result.timingTotal += tally.timingTotal;
    return result;
  }, blankTally());
}

export function practiceWindows(runs: readonly PracticeRun[]) {
  const size = Math.max(1, Math.min(5, Math.floor(runs.length / 2)));
  return { recent: runs.slice(0, size), previous: runs.slice(size, size * 2) };
}

export function practiceRows(recent: readonly PracticeRun[], previous: readonly PracticeRun[], group: 'keys' | 'chords') {
  const names = [...new Set(recent.flatMap(run => Object.keys(run[group])))];
  return names.map(name => {
    const tally = (selected: readonly PracticeRun[]) =>
      combineTallies(selected.flatMap(run => run[group][name] ? [run[group][name]] : []));
    const current = tally(recent);
    const prior = tally(previous);
    return { name, ...current, change: prior.attempts ? rateChange(current, prior) : null };
  }).sort((a, b) =>
    a.hits / a.attempts - b.hits / b.attempts || b.attempts - a.attempts || a.name.localeCompare(b.name));
}
