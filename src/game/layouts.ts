import { keyLabel } from '../../shared/practice';
import { keyInfo, type Finger } from '../../shared/typing';
import { FINGER_COLORS } from './themes';
import type { LaneLayout } from './renderer';

const FRETS = ['G', 'R', 'Y', 'B', 'O'];

export function laneLayout(keys: string[], colors: string[], lettered = false, guitar = false): LaneLayout {
  return {
    columns: keys.length,
    column: lane => lane,
    color: lane => colors[lane % colors.length],
    gemLabel: lane => lettered ? keyLabel(keys[lane]) : '',
    // A seat played on a guitar shows fret letters (green, red, yellow, blue, orange) in place of keys.
    targets: keys.map((code, lane) => ({ label: guitar ? FRETS[lane] ?? '' : keyLabel(code), color: colors[lane % colors.length] })),
  };
}

const HOME_ROW = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';'];
const COLUMN_FINGERS: Finger[] = ['L-pinky', 'L-ring', 'L-middle', 'L-index', 'L-index', 'R-index', 'R-index', 'R-middle', 'R-ring', 'R-pinky'];

/** Ten finger columns. Each gem carries its letter, and the space bar spans the neck. */
export function typingLayout(keys: string[]): LaneLayout {
  const info = keys.map(code => keyInfo(code));
  // Lessons with capitals show each letter in its real case. Earlier lessons show letters as printed on the keys.
  const cased = keys.some(code => code.startsWith('Shift+'));
  return {
    columns: 10,
    column: lane => info[lane]?.code === 'Space' ? -1 : Math.max(0, Math.min(9, Math.round(info[lane]?.column ?? 4))),
    color: lane => FINGER_COLORS[info[lane]?.finger ?? 'thumb'],
    gemLabel: lane => info[lane]?.code === 'Space' ? '' : cased ? info[lane]?.char ?? '' : (info[lane]?.label ?? '').toUpperCase(),
    // A lesson on two keys shows two bright rings, so a learner is not hunting among ten.
    targets: COLUMN_FINGERS.map((finger, column) => ({ label: HOME_ROW[column], color: FINGER_COLORS[finger],
      hidden: !info.some(key => key && key.code !== 'Space' && Math.max(0, Math.min(9, Math.round(key.column ?? 4))) === column) })),
  };
}
