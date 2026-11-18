import { useEffect, useMemo, useState } from 'react';
import { Guitar } from 'lucide-react';
import { sfx } from '../game/sfx';
import { laneColors, saveStore, settingsStore, useCell } from '../state/store';
import DemoHighway from './DemoHighway';
import cover from '../assets/arcade-cover.webp';

export default function Title({ ready, onStart }: { ready: boolean; onStart: () => void }) {
  const save = useCell(saveStore);
  const settings = useCell(settingsStore);
  const [leaving, setLeaving] = useState(false);
  const colors = useMemo(() => laneColors(settings), [settings]);
  const look = useMemo(() => ({ theme: save.equipped.highway, gem: save.equipped.gem, fx: save.equipped.fx, hidden: false, calm: settings.calm }),
    [save.equipped, settings.calm]);

  useEffect(() => {
    if (!ready || leaving) return;
    const start = (event: Event) => {
      if (event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey || event.altKey || event.code === 'Tab')) return;
      setLeaving(true);
      sfx.play('riff');
      setTimeout(onStart, 420);
    };
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
    return () => { window.removeEventListener('keydown', start); window.removeEventListener('pointerdown', start); };
  }, [ready, leaving, onStart]);

  return <main className="title-screen" data-leaving={leaving ? 'true' : undefined} style={{ '--cover': `url("${cover}")` } as React.CSSProperties}>
    <div className="title-art" aria-hidden="true" />
    <DemoHighway look={look} colors={colors} crowd />
    <div className="title-beams" aria-hidden="true"><i /><i /><i /></div>
    <div className="title-content">
      <p className="title-kicker"><Guitar aria-hidden="true" size={18} /> The rhythm game you play on your keyboard</p>
      <h1 className="logo" aria-label="Keyboard Shredder"><span>Keyboard</span><span>Shredder</span></h1>
      <p className="title-tag">Shred 25 songs. Battle your friends. Type faster without noticing.</p>
    </div>
    <button className="press-start" disabled={!ready}>{ready ? 'Press any key' : 'Plugging in…'}</button>
    <footer className="title-foot"><span>1 or 2 players</span><span>Keyboard or touch</span><span>Free to play</span></footer>
  </main>;
}
