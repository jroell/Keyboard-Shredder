import type { SongEvent } from './song';

/** A song is split into this many parts for practice and for the results map. */
export const SECTION_COUNT = 8;

/**
 * Names each part of a song from its chart: the busiest middle part is the solo, the
 * quietest is the breakdown, and the rest are verses and choruses by how full they are.
 * Call it with one fixed chart level so a song has the same names on every difficulty.
 */
export function sectionNames(events: readonly SongEvent[], durationMs: number, count = SECTION_COUNT): string[] {
  const size = durationMs / count;
  const load = Array.from({ length: count }, (_, index) => events
    .filter(event => event.timeMs >= index * size && event.timeMs < (index + 1) * size)
    .reduce((total, event) => total + event.lanes.length + (event.durationMs > 0 ? 0.5 : 0), 0));
  const middle = load.slice(1, -1);
  const sorted = [...middle].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const solo = middle.length ? 1 + middle.indexOf(Math.max(...middle)) : -1;
  const quiet = middle.length ? 1 + middle.indexOf(Math.min(...middle)) : -1;
  const roles = load.map((value, index) => index === 0 ? 'Intro' : index === count - 1 ? 'Finale'
    : index === solo ? 'Solo' : index === quiet && value < median * 0.85 ? 'Breakdown'
    : index + 1 === solo && value < load[solo] * 0.8 ? 'Build' : value >= median ? 'Chorus' : 'Verse');
  const seen = new Map<string, number>();
  return roles.map(role => {
    const times = (seen.get(role) ?? 0) + 1;
    seen.set(role, times);
    return times > 1 ? `${role} ${times}` : role;
  });
}
