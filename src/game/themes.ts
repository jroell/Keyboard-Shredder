import { palettes } from '../../shared/duel';

export type HighwayTheme = {
  bedFar: string; bedNear: string; lane: string; fret: string; downbeat: string; rail: string; glow: string;
  pattern: 'wood' | 'grid' | 'lava' | 'ice' | 'sun' | 'stars' | 'gold';
};

export const HIGHWAYS: Record<string, HighwayTheme> = {
  classic: { bedFar: '#1a0f0a', bedNear: '#2b1810', lane: '#ffffff22', fret: '#d8c3a52e', downbeat: '#f3e2c670', rail: '#c9a36a', glow: '#ffb45c', pattern: 'wood' },
  neon: { bedFar: '#05010f', bedNear: '#12032b', lane: '#ff4fd866', fret: '#35e7ff40', downbeat: '#35e7ffa0', rail: '#ff4fd8', glow: '#35e7ff', pattern: 'grid' },
  lava: { bedFar: '#120302', bedNear: '#2a0704', lane: '#ff6a1a40', fret: '#ff8a3c35', downbeat: '#ffc24a90', rail: '#ff5a1f', glow: '#ffb02e', pattern: 'lava' },
  ice: { bedFar: '#031019', bedNear: '#0a2636', lane: '#bdefff40', fret: '#bdefff30', downbeat: '#e9fbffa0', rail: '#9fe6ff', glow: '#d8f7ff', pattern: 'ice' },
  synthwave: { bedFar: '#1b0330', bedNear: '#090114', lane: '#ff5fbf70', fret: '#ff5fbf50', downbeat: '#ffd36eb0', rail: '#ffb347', glow: '#ff5fbf', pattern: 'sun' },
  void: { bedFar: '#000004', bedNear: '#070714', lane: '#8ea2ff38', fret: '#8ea2ff28', downbeat: '#c8d2ff90', rail: '#7d8dff', glow: '#b8c4ff', pattern: 'stars' },
  gold: { bedFar: '#1a1203', bedNear: '#3a2906', lane: '#ffe08a50', fret: '#ffe08a38', downbeat: '#fff3c4b0', rail: '#ffd24a', glow: '#fff0a8', pattern: 'gold' },
};

export const LANE_PALETTES: Record<string, string[]> = palettes;

/** One color per finger, left pinky to right pinky, then thumb. */
export const FINGER_COLORS: Record<string, string> = {
  'L-pinky': '#ff5d8f', 'L-ring': '#ff9a3c', 'L-middle': '#ffe14d', 'L-index': '#4be07f',
  'R-index': '#35d6e8', 'R-middle': '#5b8cff', 'R-ring': '#a779ff', 'R-pinky': '#ff6fe0', thumb: '#d9d2ff',
};

export function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(part => part + part).join('') : value;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function rgba(hex: string, alpha: number) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mix(hex: string, other: string, amount: number) {
  const a = rgb(hex);
  const b = rgb(other);
  const part = (i: number) => Math.round(a[i] + (b[i] - a[i]) * amount);
  return `rgb(${part(0)},${part(1)},${part(2)})`;
}
