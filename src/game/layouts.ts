import { keyLabel } from '../../shared/practice';
import { keyInfo, type Finger } from '../../shared/typing';
import { FINGER_COLORS } from './themes';
import type { LaneLayout } from './renderer';

export function laneLayout(keys: string[], colors: string[], lettered = false): LaneLayout {
  return {
    columns: keys.length,
    column: lane => lane,
    color: lane => colors[lane % colors.length],
    gemLabel: lane => lettered ? keyLabel(keys[lane]) : '',
    targets: keys.map((code, lane) => ({ label: keyLabel(code), color: colors[lane % colors.length] })),
  };
}

const COLUMN_FINGERS: Finger[] = ['L-pinky', 'L-ring', 'L-middle', 'L-index', 'L-index', 'R-index', 'R-index', 'R-middle', 'R-ring', 'R-pinky'];

/** Ten finger columns. Each gem carries its letter, and the space bar spans the neck. */
export function typingLayout(keys: string[]): LaneLayout {
  const info = keys.map(code => keyInfo(code));
  return {
    columns: 10,
    column: lane => info[lane]?.code === 'Space' ? -1 : Math.max(0, Math.min(9, Math.round(info[lane]?.column ?? 4))),
    color: lane => FINGER_COLORS[info[lane]?.finger ?? 'thumb'],
    gemLabel: lane => info[lane]?.code === 'Space' ? '' : (info[lane]?.label ?? '').toUpperCase(),
    targets: COLUMN_FINGERS.map(finger => ({ label: '', color: FINGER_COLORS[finger] })),
  };
}
