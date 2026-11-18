export type Difficulty = 'easy' | 'normal' | 'hard';
export type SongEvent = { id: string; timeMs: number; lanes: number[]; durationMs: number };
export type Chart = {
  version: 1;
  durationMs: number;
  bpm: number;
  beatsMs: number[];
  downbeatsMs: number[];
  events: Record<Exclude<Difficulty, 'easy'>, SongEvent[]> & { easy?: SongEvent[] };
};
export type SongCredit = { artist: string; license: string; licenseUrl: string; source: string };
export type Song = { id: string; title: string; prompt: string; model: string; genre?: string; hasStemMix?: boolean; credit?: SongCredit; durationMs: number };
export type Stage = 'queued' | 'composing' | 'charting' | 'ready' | 'failed';
export type Job = { id: string; stage: Stage; error?: string; canRetryChart?: boolean };
