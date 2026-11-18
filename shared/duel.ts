import type { Difficulty, Song } from './song';
import type { TourProgress } from './tour';

export const palettes = {
  Classic: ['#2fe36b', '#ff3b46', '#ffd91f', '#2f8bff', '#ff8a1f'],
  Sunset: ['#ff8757', '#ffc66b', '#87dcae', '#78b9ff', '#e0a2ff'],
  Neon: ['#fb79d7', '#f9fa88', '#36f5c8', '#85adff', '#ff9e73'],
  Ice: ['#e5b8ff', '#faf5b7', '#a1ffee', '#89c7ff', '#ffbbcf'],
  'Color safe': ['#0072b2', '#e69f00', '#f0e442', '#56b4e9', '#d55e00'],
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
  /** The chart this player chose. Players in one room may differ. */
  difficulty: Difficulty; rating: number;
  combo: number; ampCharge: number; boostEndMs: number | null; frets: number[]; strike: { lanes: number[]; missed: boolean } | null; accuracy: number; hits: number; bestCombo: number;
};
export type DuelMode = 'duel' | 'coop';
export type CoopStage = {
  progress: TourProgress;
  targetScore: number;
  teamScore: number;
  teamPassed: boolean | null;
  nextSongId: string | null;
};
export type Duel = {
  mode: DuelMode; round: string; coop?: CoopStage;
  id: string; song: Song; difficulty: Difficulty; phase: 'lobby' | 'playing' | 'finished' | 'canceled';
  players: DuelPlayer[]; host: number; startAt: number | null; winner: number | null; reason?: string;
};
export type LaneInput = { lane: number; down: boolean; timeMs: number };
export type Reply = { error?: string; id?: string; slot?: number; progress?: TourProgress };
