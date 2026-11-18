import type { Difficulty, Song } from './song';

export const palettes = {
  Sunset: ['#ff8757', '#ffc66b', '#87dcae', '#78b9ff', '#e0a2ff'],
  Neon: ['#fb79d7', '#f9fa88', '#36f5c8', '#85adff', '#ff9e73'],
  Ice: ['#e5b8ff', '#faf5b7', '#a1ffee', '#89c7ff', '#ffbbcf'],
};
export const avatars = ['Guitar', 'Lightning', 'Star', 'Fire'] as const;
export const badgeNames = {
  debut: 'First duel',
  winner: 'Stage winner',
  precision: 'Precision player',
  streak: 'Combo master',
  veteran: 'Ten duels',
};
export type Badge = keyof typeof badgeNames;
export type Profile = {
  name: string; avatar: typeof avatars[number]; palette: keyof typeof palettes;
  speed: number; badge: Badge | null; badges: Badge[]; played: number; wins: number;
};
export type DuelPlayer = {
  slot: number; profile: Profile; connected: boolean; ready: boolean; score: number;
  combo: number; ampCharge: number; boostEndMs: number | null; frets: number[]; strike: { lanes: number[]; missed: boolean } | null; accuracy: number; hits: number; bestCombo: number;
};
export type Duel = {
  id: string; song: Song; difficulty: Difficulty; phase: 'lobby' | 'playing' | 'finished' | 'canceled';
  players: DuelPlayer[]; host: number; startAt: number | null; winner: number | null; reason?: string;
};
export type LaneInput = { lane: number; down: boolean; timeMs: number };
export type Reply = { error?: string; id?: string; slot?: number };
