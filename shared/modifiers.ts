import { hitWindows } from './difficulty';
import type { Difficulty, SongEvent } from './song';

export const MODS = {
  slow: { name: 'Slow-mo', blurb: 'The song plays at three-quarter speed for practice. Scores are not ranked.', bonus: -0.5 },
  hyperspeed: { name: 'Hyperspeed', blurb: 'Notes fly down the neck almost twice as fast.', bonus: 0.1 },
  mirror: { name: 'Mirror', blurb: 'The chart flips left to right.', bonus: 0 },
  hidden: { name: 'Fade out', blurb: 'Notes vanish before they reach the strike line.', bonus: 0.15 },
  precision: { name: 'Precision', blurb: 'Timing windows shrink by a third.', bonus: 0.2 },
  sudden: { name: 'Sudden death', blurb: 'One miss ends the set.', bonus: 0.25 },
} as const;
export type ModId = keyof typeof MODS;
export const MOD_IDS = Object.keys(MODS) as ModId[];

export function normalizeMods(value: unknown): ModId[] {
  if (!Array.isArray(value)) return [];
  return MOD_IDS.filter(id => value.includes(id));
}

export function modMultiplier(mods: readonly ModId[]) {
  return Math.round(100 * (1 + mods.reduce((total, id) => total + MODS[id].bonus, 0))) / 100;
}

export function windowFor(difficulty: Difficulty, mods: readonly ModId[] = []) {
  return Math.round(hitWindows[difficulty] * (mods.includes('precision') ? 2 / 3 : 1));
}

export function applyMods(events: SongEvent[], mods: readonly ModId[], laneCount = 5): SongEvent[] {
  if (!mods.includes('mirror')) return events;
  return events.map(event => ({ ...event, lanes: event.lanes.map(lane => laneCount - 1 - lane).sort((a, b) => a - b) }));
}

/** Playback speed for a set of modifiers. */
export function playbackRate(mods: readonly ModId[]) {
  return mods.includes('slow') ? 0.75 : 1;
}

/** Runs with these modifiers stay off the leaderboards. */
export function isRanked(mods: readonly ModId[]) {
  return !mods.includes('slow');
}

export function finalScore(score: number, mods: readonly ModId[]) {
  return Math.round(score * modMultiplier(mods));
}
