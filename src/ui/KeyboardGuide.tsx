import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { keyLabel, PRACTICE_ROWS } from '../../shared/practice';
import { keyInfo, type KeyStats } from '../../shared/typing';
import { FINGER_COLORS } from '../game/themes';

export type KeyboardHandle = { setNext: (code: string | null) => void; flash: (code: string, good: boolean) => void };

const FINGER_NAMES: Record<string, string> = {
  'L-pinky': 'left pinky', 'L-ring': 'left ring finger', 'L-middle': 'left middle finger', 'L-index': 'left index finger',
  'R-index': 'right index finger', 'R-middle': 'right middle finger', 'R-ring': 'right ring finger', 'R-pinky': 'right pinky', thumb: 'thumb',
};

export function fingerName(code: string) {
  return FINGER_NAMES[keyInfo(code)?.finger ?? 'thumb'];
}

/**
 * An on-screen keyboard coloured by finger. During play it lights the next key.
 * With `stats` it becomes a heat map: weak keys glow red, strong keys green.
 */
const KeyboardGuide = forwardRef<KeyboardHandle, { active?: readonly string[]; stats?: KeyStats; compact?: boolean }>(
  function KeyboardGuide({ active, stats, compact }, ref) {
    const root = useRef<HTMLDivElement>(null);
    const hint = useRef<HTMLParagraphElement>(null);
    const next = useRef<string | null>(null);
    const find = (code: string) => root.current?.querySelector<HTMLElement>(`[data-code="${code}"]`);
    useImperativeHandle(ref, () => ({
      setNext(code) {
        if (code === next.current) return;
        if (next.current) find(next.current)?.classList.remove('next');
        next.current = code;
        if (code) find(code)?.classList.add('next');
        if (hint.current) hint.current.textContent = code ? `${code === 'Space' ? 'Space' : keyLabel(code)} · ${fingerName(code)}` : '';
      },
      flash(code, good) {
        const key = find(code);
        if (!key) return;
        const name = good ? 'good' : 'bad';
        key.classList.remove('good', 'bad');
        void key.offsetWidth;
        key.classList.add(name);
      },
    }), []);
    const enabled = active ? new Set(active) : null;
    const heat = (code: string): CSSProperties | undefined => {
      const stat = stats?.[code];
      if (!stats) return { '--finger': FINGER_COLORS[keyInfo(code)?.finger ?? 'thumb'] } as CSSProperties;
      if (!stat || stat.attempts < 3) return { '--finger': '#4b4660' } as CSSProperties;
      const rate = stat.hits / stat.attempts;
      const hue = Math.round(Math.max(0, Math.min(1, (rate - 0.5) / 0.5)) * 130);
      return { '--finger': `hsl(${hue} 85% 55%)` } as CSSProperties;
    };
    return <div className={`kb${compact ? ' kb-compact' : ''}${stats ? ' kb-heat' : ''}`} ref={root} aria-hidden={stats ? undefined : true}>
      {PRACTICE_ROWS.map((row, index) => <div className="kb-row" key={row.name} style={{ '--indent': index } as CSSProperties}>
        {row.keys.map(code => {
          const stat = stats?.[code];
          return <span key={code} data-code={code} className={enabled && !enabled.has(code) ? 'off' : ''} style={heat(code)}
            title={stat && stat.attempts ? `${keyLabel(code)}: ${Math.round(100 * stat.hits / stat.attempts)}% of ${stat.attempts}` : undefined}>
            {keyLabel(code)}</span>;
        })}
      </div>)}
      <div className="kb-row kb-space"><span data-code="Space" className={enabled && !enabled.has('Space') ? 'off' : ''}
        style={{ '--finger': stats ? '#4b4660' : FINGER_COLORS.thumb } as CSSProperties}>space</span></div>
      {!stats && <p className="kb-hint" ref={hint} />}
    </div>;
  });

export default KeyboardGuide;
