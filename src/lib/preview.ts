import { call } from './api';

const cache = new Map<string, Promise<string>>();
let player: HTMLAudioElement | null = null;
let wanted = '';
let playing = '';
let fade = 0;

function load(id: string) {
  let entry = cache.get(id);
  if (!entry) {
    entry = call(`/songs/${id}/audio`).then(response => response.blob()).then(blob => URL.createObjectURL(blob));
    entry.catch(() => cache.delete(id));
    cache.set(id, entry);
    if (cache.size > 10) {
      const [oldest, url] = cache.entries().next().value!;
      cache.delete(oldest);
      void url.then(value => URL.revokeObjectURL(value)).catch(() => {});
    }
  }
  return entry;
}

/** Plays a looping excerpt of a song while it is highlighted in a list. */
export function previewSong(id: string, volume: number) {
  if (wanted === id && playing === id && player && !player.paused) {
    player.volume = volume * 0.55;
    return;
  }
  wanted = id;
  // The old song stops at once, even if the new one never loads.
  if (player && playing && playing !== id) { cancelAnimationFrame(fade); player.pause(); playing = ''; }
  void load(id).then(url => {
    if (wanted !== id) return;
    playing = id;
    player ??= new Audio();
    cancelAnimationFrame(fade);
    player.src = url;
    player.loop = true;
    player.volume = 0;
    const begin = () => {
      if (!player || wanted !== id) return;
      if (Number.isFinite(player.duration) && player.duration > 20) player.currentTime = player.duration * 0.3;
      void player.play().catch(() => {});
      const started = performance.now();
      const rise = () => {
        if (!player || wanted !== id) return;
        const level = Math.min(1, (performance.now() - started) / 700);
        player.volume = level * volume * 0.55;
        if (level < 1) fade = requestAnimationFrame(rise);
      };
      fade = requestAnimationFrame(rise);
    };
    if (player.readyState >= 1) begin();
    else player.addEventListener('loadedmetadata', begin, { once: true });
  }).catch(() => {});
}

export function stopPreview() {
  wanted = '';
  playing = '';
  cancelAnimationFrame(fade);
  if (!player) return;
  const current = player;
  const from = current.volume;
  const started = performance.now();
  const fall = () => {
    if (wanted) return;
    const level = 1 - Math.min(1, (performance.now() - started) / 250);
    current.volume = from * level;
    if (level > 0) fade = requestAnimationFrame(fall);
    else current.pause();
  };
  fade = requestAnimationFrame(fall);
}
