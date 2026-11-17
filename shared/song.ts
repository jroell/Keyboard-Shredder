export type Difficulty = 'normal' | 'hard';
export type SongEvent = { id: string; timeMs: number; lanes: number[]; durationMs: number };
export type Chart = {
  version: 1;
  durationMs: number;
  bpm: number;
  beatsMs: number[];
  downbeatsMs: number[];
  events: Record<Difficulty, SongEvent[]>;
};
export type Song = { id: string; title: string; prompt: string; model: string; durationMs: number };
export type Stage = 'queued' | 'composing' | 'charting' | 'ready' | 'failed';
export type Job = { id: string; stage: Stage; error?: string; canRetryChart?: boolean };
