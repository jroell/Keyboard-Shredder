import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Flame, Star } from 'lucide-react';
import { levelFor } from '../../shared/progression';
import { sfx } from '../game/sfx';
import { saveStore, useCell } from '../state/store';

/** Arrow keys move, Enter picks, Escape goes back. Typing in a field is left alone. */
export function useMenuKeys(options: { count: number; index: number; setIndex: (index: number) => void; onPick?: (index: number) => void;
  onBack?: () => void; horizontal?: boolean; columns?: number; enabled?: boolean; onSide?: (direction: -1 | 1) => void }) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const { count, index, setIndex, onPick, onBack, horizontal, columns = 1, enabled = true, onSide } = latest.current;
      if (!enabled || event.altKey || event.metaKey || event.ctrlKey) return;
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (event.code === 'Escape' && onBack) { event.preventDefault(); sfx.play('ui-back'); onBack(); return; }
      if (field) return;
      const step = (delta: number) => {
        event.preventDefault();
        if (!count) return;
        const target = Math.max(0, Math.min(count - 1, index + delta));
        if (target !== index) { sfx.play('ui-move'); setIndex(target); }
      };
      const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
      const backward = horizontal ? 'ArrowLeft' : 'ArrowUp';
      if (event.code === forward) step(columns > 1 && !horizontal ? columns : 1);
      else if (event.code === backward) step(columns > 1 && !horizontal ? -columns : -1);
      else if (columns > 1 && event.code === 'ArrowRight') step(1);
      else if (columns > 1 && event.code === 'ArrowLeft') step(-1);
      else if (onSide && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) { event.preventDefault(); onSide(event.code === 'ArrowLeft' ? -1 : 1); }
      else if (event.code === 'Enter' && onPick && !(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLAnchorElement)) {
        event.preventDefault();
        onPick(index);
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
}

export function PlayerChip({ onClick }: { onClick?: () => void }) {
  const save = useCell(saveStore);
  const level = levelFor(save.xp);
  return <button className="player-chip" onClick={onClick} aria-label={`${save.name || 'Player'}, level ${level.level}. Open locker`}>
    <span className="chip-level">{level.level}</span>
    <span className="chip-text"><strong>{save.name || 'New shredder'}</strong><small>{level.title}</small>
      <i className="chip-xp"><b style={{ width: `${level.progress * 100}%` }} /></i></span>
    {save.streak.days > 1 && <span className="chip-streak" title={`${save.streak.days} day streak`}><Flame aria-hidden="true" size={15} />{save.streak.days}</span>}
  </button>;
}

export function Screen({ title, eyebrow, onBack, children, actions, className = '' }: {
  title: string; eyebrow?: string; onBack: () => void; children: ReactNode; actions?: ReactNode; className?: string;
}) {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      sfx.play('ui-back');
      back.current();
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
  return <main className={`screen ${className}`}>
    <header className="screen-head">
      <button className="back" onClick={() => { sfx.play('ui-back'); onBack(); }}><ArrowLeft aria-hidden="true" size={18} />Back</button>
      <div className="screen-title">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1></div>
      <div className="screen-actions">{actions}</div>
    </header>
    {children}
  </main>;
}

export function Stars({ count, max = 5, size = 16 }: { count: number; max?: number; size?: number }) {
  return <span className="stars" data-gold={count > max ? 'true' : undefined} role="img" aria-label={`${Math.min(count, max)} of ${max} stars`}>
    {Array.from({ length: max }, (_, index) => <Star key={index} size={size} aria-hidden="true" className={index < count ? 'on' : ''} />)}
  </span>;
}

export function formatLength(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
