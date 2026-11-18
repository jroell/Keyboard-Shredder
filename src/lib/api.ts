import type { Difficulty, Song } from '../../shared/song';
import type { ModId } from '../../shared/modifiers';
import type { DailyChallenge } from '../../shared/daily';
import type { InputLog } from '../game/session';

export type ScoreEntry = { rank: number; name: string; score: number; rating: number; stars: number; combo: number; fullCombo: boolean; you: boolean };
export type Board = { entries: ScoreEntry[]; you: { rank: number; score: number } | null; total: number };
export type Daily = DailyChallenge & Board & { title: string; genre: string };
export type Submitted = { score: number; rating: number; stars: number; rank: number; best: boolean; previous: number | null; daily?: { rank: number; best: boolean } };

let tokenSource: () => Promise<string | undefined> = async () => guestToken();

export function setTokenSource(source: () => Promise<string | undefined>) {
  tokenSource = source;
}

let memoryToken = '';

export function guestToken() {
  // Kept in memory too, so a browser that blocks storage still has one identity for the whole visit.
  if (memoryToken) return memoryToken;
  try {
    const saved = localStorage.getItem('ks:guest');
    if (saved && /^guest-[a-f0-9]{32}$/.test(saved)) return memoryToken = saved;
  } catch { /* Storage is optional. */ }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = 'guest-' + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem('ks:guest', token); } catch { /* Storage is optional. */ }
  return memoryToken = token;
}

export const token = () => tokenSource();

export async function call(path: string, options: RequestInit = {}) {
  const bearer = await tokenSource();
  const response = await fetch('/api' + path, {
    ...options, headers: { ...options.headers, Authorization: `Bearer ${bearer || ''}` }, signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (HTTP ${response.status}). Try again.`);
  }
  return response;
}

const json = { 'Content-Type': 'application/json' };

export function fetchSongs() {
  return call('/songs').then(response => response.json() as Promise<Song[]>);
}

export function fetchBoard(songId: string, difficulty: Difficulty, mods: ModId[] = []) {
  const query = mods.length ? `?mods=${encodeURIComponent(mods.join('+'))}` : '';
  return call(`/scores/${songId}/${difficulty}${query}`).then(response => response.json() as Promise<Board>);
}

export type VenueBoard = { entries: { rank: number; name: string; score: number; you: boolean }[]; you: { rank: number; score: number } | null; total: number };
export function fetchVenueBoard(venueId: string, difficulty: Difficulty) {
  return call(`/venues/${venueId}/${difficulty}`).then(response => response.json() as Promise<VenueBoard>);
}

export function fetchDaily() {
  return call('/daily').then(response => response.json() as Promise<Daily>);
}

export function submitScore(run: { songId: string; difficulty: Difficulty; mods: ModId[]; daily?: string }, log: InputLog) {
  return call('/scores', { method: 'POST', headers: json, body: JSON.stringify({ ...run, inputs: log.inputs, boosts: log.boosts }) })
    .then(response => response.json() as Promise<Submitted>);
}
