/// <reference types="vite/client" />

const stages = import.meta.glob('../assets/stages/*.webp', { import: 'default', query: '?url', eager: true }) as Record<string, string>;

export function stageArt(songId: string) {
  return stages[`../assets/stages/${songId}.webp`];
}
