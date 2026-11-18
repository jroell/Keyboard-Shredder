import { useSyncExternalStore } from 'react';
import { DEFAULT_KEYS } from '../../shared/scoring';
import { emptySave, levelFor, normalizeSave, type SaveData } from '../../shared/progression';
import { normalizeTourProgress, type TourProgress } from '../../shared/tour';
import type { KeyStats, LessonProgress } from '../../shared/typing';
import type { Difficulty } from '../../shared/song';
import { isDifficulty } from '../../shared/difficulty';
import { LANE_PALETTES } from '../game/themes';
import { DEFAULT_PAD, normalizePadMap, type PadMap } from '../game/gamepad';

export type Settings = {
  keys: string[];
  partyKeys: [string[], string[]];
  calibration: number;
  /** How long a note is visible before it reaches the strike line, in ms. Lower is faster. */
  speed: number;
  palette: string;
  musicVolume: number;
  sfxVolume: number;
  hitSounds: 'auto' | 'on' | 'off';
  calm: boolean;
  showKeyboard: boolean;
  /** Typing lessons wait at each letter until it is typed. */
  typingWait: boolean;
  difficulty: Difficulty;
  /** Guitar controller or gamepad mapping. */
  pad: PadMap;
};
export type WpmEntry = { at: number; wpm: number; accuracy: number; lesson: string };

export const DEFAULT_SETTINGS: Settings = {
  keys: DEFAULT_KEYS,
  partyKeys: [['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'], ['KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']],
  calibration: 0, speed: 1700, palette: 'Classic', musicVolume: 0.9, sfxVolume: 0.7,
  hitSounds: 'auto', calm: false, showKeyboard: true, typingWait: true, difficulty: 'easy', pad: DEFAULT_PAD,
};

const KEY_CODE = /^(Key[A-Z]|Digit[0-9]|Semicolon|Comma|Period|Slash|Quote|BracketLeft|BracketRight|Minus|Equal)$/;
function laneKeys(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.length === 5 && value.every(key => typeof key === 'string' && KEY_CODE.test(key)) &&
    new Set(value).size === 5 ? value as string[] : fallback;
}
const clamp = (value: unknown, low: number, high: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

export function normalizeSettings(value: unknown): Settings {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  const party = Array.isArray(input.partyKeys) ? input.partyKeys : [];
  const partyKeys: [string[], string[]] = [laneKeys(party[0], DEFAULT_SETTINGS.partyKeys[0]), laneKeys(party[1], DEFAULT_SETTINGS.partyKeys[1])];
  return {
    keys: laneKeys(input.keys, DEFAULT_KEYS),
    partyKeys: new Set([...partyKeys[0], ...partyKeys[1]]).size === 10 ? partyKeys : DEFAULT_SETTINGS.partyKeys,
    calibration: clamp(input.calibration, -250, 250, 0),
    speed: clamp(input.speed, 800, 2800, DEFAULT_SETTINGS.speed),
    palette: typeof input.palette === 'string' && input.palette in LANE_PALETTES ? input.palette : 'Classic',
    musicVolume: clamp(input.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clamp(input.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume),
    hitSounds: input.hitSounds === 'on' || input.hitSounds === 'off' ? input.hitSounds : 'auto',
    calm: input.calm === true,
    showKeyboard: input.showKeyboard !== false,
    typingWait: input.typingWait !== false,
    difficulty: isDifficulty(input.difficulty) ? input.difficulty : DEFAULT_SETTINGS.difficulty,
    pad: normalizePadMap(input.pad),
  };
}

/** Several people can share one browser. Each player keeps their own progress under their own keys. */
function activeProfile() {
  try { return (localStorage.getItem('ks:profile') || '').replace(/[^a-z0-9]/g, '').slice(0, 12); }
  catch { return ''; }
}
const profile = activeProfile();
const scoped = (key: string) => profile ? key.replace(/^ks:/, `ks:${profile}:`) : key;

export function listPlayers(): { id: string; name: string; level: number }[] {
  try {
    const ids: string[] = JSON.parse(localStorage.getItem('ks:profiles') || '[]');
    return ['', ...ids.filter(id => typeof id === 'string' && /^[a-z0-9]{1,12}$/.test(id))].map(id => {
      const raw = JSON.parse(localStorage.getItem(id ? `ks:${id}:save` : 'ks:save') || 'null');
      const save = raw ? normalizeSave(raw) : emptySave();
      return { id, name: save.name || (id ? 'New player' : 'Player 1'), level: levelFor(save.xp).level };
    });
  } catch { return [{ id: '', name: 'Player 1', level: 1 }]; }
}
export const currentPlayer = profile;
/** Switches the active player and reloads, so every screen reads that player's progress. */
export function switchPlayer(id: string) {
  try { localStorage.setItem('ks:profile', id); sessionStorage.setItem('ks:switched', '1'); } catch { return; }
  location.reload();
}
export function addPlayer(name: string) {
  const id = Math.random().toString(36).slice(2, 10);
  try {
    const ids: string[] = JSON.parse(localStorage.getItem('ks:profiles') || '[]');
    localStorage.setItem('ks:profiles', JSON.stringify([...ids, id].slice(-8)));
    localStorage.setItem(`ks:${id}:save`, JSON.stringify({ ...emptySave(), name: name.trim().slice(0, 24), seenTutorial: true }));
  } catch { return; }
  switchPlayer(id);
}

function read<T>(key: string, parse: (value: unknown) => T): T {
  try { return parse(JSON.parse(localStorage.getItem(key) ?? 'null')); }
  catch { return parse(null); }
}

function cell<T>(plainKey: string, parse: (value: unknown) => T) {
  const key = scoped(plainKey);
  let value = read(key, parse);
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((previous: T) => T)) {
      value = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ }
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const record = <T,>(valid: (entry: unknown) => entry is T) => (value: unknown): Record<string, T> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => valid(entry))) as Record<string, T>;
};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const settingsStore = cell('ks:settings', normalizeSettings);
export const saveStore = cell<SaveData>('ks:save', value => value ? normalizeSave(value) : emptySave());
export const tourStore = cell<TourProgress>('ks:tour', normalizeTourProgress);
export const lessonStore = cell<LessonProgress>('ks:lessons', record((entry): entry is LessonProgress[string] => {
  const item = entry as LessonProgress[string];
  return !!item && finite(item.bestAccuracy) && finite(item.bestWpm) && finite(item.stars) && finite(item.plays);
}));
export const keyStatsStore = cell<KeyStats>('ks:keystats', record((entry): entry is KeyStats[string] => {
  const item = entry as KeyStats[string];
  return !!item && finite(item.attempts) && finite(item.hits) && finite(item.timingTotal);
}));
/** Best result for each venue's headline set: total score and average timing rating. */
export const setStore = cell<Record<string, { score: number; rating: number; platinum?: boolean }>>('ks:sets', record((entry): entry is { score: number; rating: number; platinum?: boolean } => {
  const item = entry as { score: number; rating: number };
  return !!item && finite(item.score) && finite(item.rating);
}));
export const wpmStore = cell<WpmEntry[]>('ks:wpm', value => Array.isArray(value)
  ? value.filter(entry => entry && finite(entry.at) && finite(entry.wpm) && finite(entry.accuracy)).slice(-80) : []);

export function useCell<T>(store: { get: () => T; subscribe: (listener: () => void) => () => void }) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function laneColors(settings: Settings) {
  return LANE_PALETTES[settings.palette] ?? LANE_PALETTES.Classic;
}
