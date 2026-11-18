import type { Difficulty } from './song';
import { normalizeMods, type ModId } from './modifiers';

export type DailyChallenge = { dateKey: string; songId: string; difficulty: Difficulty; mods: ModId[] };

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** YYYY-MM-DD in UTC, so every player gets the same challenge for the same 24 hours. */
export function dailyKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

const MOD_SETS: ModId[][] = [[], ['mirror'], ['hyperspeed'], ['hidden'], ['precision'], ['mirror', 'hyperspeed'], ['hidden', 'mirror'], []];
const LEVELS: Difficulty[] = ['medium', 'easy', 'medium', 'hard', 'medium', 'easy', 'hard'];

/** The same song, difficulty and modifiers for everyone on a given UTC day. */
export function dailyChallenge(dateKey: string, songIds: readonly string[]): DailyChallenge {
  const ids = [...songIds].sort();
  const seed = hash(`shredder-daily:${dateKey}`);
  return {
    dateKey,
    songId: ids[seed % Math.max(1, ids.length)] ?? '',
    difficulty: LEVELS[(seed >>> 8) % LEVELS.length],
    mods: normalizeMods(MOD_SETS[(seed >>> 16) % MOD_SETS.length]),
  };
}
