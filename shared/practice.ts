import type { Chart, SongEvent } from './song';

export type PracticePreset = 'home' | 'numbers' | 'vim' | 'touch' | 'custom';
export type PracticeConfig = { preset: PracticePreset; customKeys: string[] };

export const PRACTICE_ROWS = [
  { name: 'Number row', keys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'] },
  { name: 'Top row', keys: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'] },
  { name: 'Home row', keys: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'] },
  { name: 'Bottom row', keys: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'] },
] as const;

export const PRACTICE_PRESETS = {
  home: { label: 'Home row', description: 'Practice the resting positions for both hands.', keys: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'] },
  numbers: { label: 'Number row', description: 'Reach for the number keys above the letters.', keys: PRACTICE_ROWS[0].keys.slice(0, 10) },
  vim: { label: 'Vim navigation', description: 'Practice H J K L for left, down, up, and right. Use W B E for word movement and G as a navigation prefix.', keys: ['KeyW', 'KeyE', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'KeyB'] },
  touch: { label: 'Touch typing', description: 'Practice moving between the top, home, and bottom rows with both hands.', keys: ['KeyQ', 'KeyW', 'KeyO', 'KeyP', 'KeyA', 'KeyS', 'KeyK', 'KeyL', 'KeyZ', 'KeyX', 'KeyN', 'KeyM'] },
  custom: { label: 'Custom', description: 'Choose the physical keys you want to practice.', keys: [] },
} as const;

const symbols: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};

export const MIN_PRACTICE_KEYS = 5;
export const MAX_PRACTICE_KEYS = 12;
export const DEFAULT_PRACTICE: PracticeConfig = {
  preset: 'home',
  customKeys: [...PRACTICE_PRESETS.home.keys],
};

export function keyLabel(code: string) {
  return symbols[code] ?? code.replace(/^(Key|Digit)/, '');
}

export function normalizePracticeConfig(value: unknown): PracticeConfig {
  const input = value as Partial<PracticeConfig> | null;
  const preset = input?.preset && Object.hasOwn(PRACTICE_PRESETS, input.preset) ? input.preset : DEFAULT_PRACTICE.preset;
  const supported = new Set<string>(PRACTICE_ROWS.flatMap(row => [...row.keys]));
  const keys = Array.isArray(input?.customKeys) ? [...new Set(input.customKeys)]
    .filter(key => supported.has(key)).slice(0, MAX_PRACTICE_KEYS) : [];
  return { preset, customKeys: keys.length >= MIN_PRACTICE_KEYS ? keys : [...DEFAULT_PRACTICE.customKeys] };
}

export function practiceKeys(config: PracticeConfig): string[] {
  const { preset, customKeys } = normalizePracticeConfig(config);
  const selected = new Set<string>(preset === 'custom' ? customKeys : PRACTICE_PRESETS[preset].keys);
  return PRACTICE_ROWS.flatMap(row => row.keys.filter(key => selected.has(key)));
}

export function mapPracticeChart(chart: Chart, keys: readonly string[]): Chart {
  const mapEvents = (events: SongEvent[]) => {
    const nextRelease = keys.map(() => -Infinity);
    const usage = keys.map(() => 0);
    const laneNumbers = keys.map((_, index) => index);
    return events.map((event, index) => {
      const preferredLane = (index + (event.lanes[0] ?? 0)) % keys.length;
      const lanes = [...laneNumbers].sort((a, b) => {
        const blocked = Number(nextRelease[a] > event.timeMs) - Number(nextRelease[b] > event.timeMs);
        return blocked || usage[a] - usage[b] ||
          (a - preferredLane + keys.length) % keys.length - (b - preferredLane + keys.length) % keys.length;
      }).slice(0, Math.min(event.lanes.length, 2)).sort((a, b) => a - b);
      for (const lane of lanes) {
        usage[lane]++;
        nextRelease[lane] = Math.max(nextRelease[lane], event.timeMs + event.durationMs);
      }
      return { ...event, lanes };
    });
  };

  return {
    ...chart,
    events: {
      normal: mapEvents(chart.events.normal),
      hard: mapEvents(chart.events.hard),
      ...(chart.events.easy && { easy: mapEvents(chart.events.easy) }),
    },
  };
}
