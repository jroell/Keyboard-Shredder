import { useEffect, useRef, useState } from 'react';
import { keyLabel } from '../../shared/practice';
import { useApp } from '../App';
import { sfx } from '../game/sfx';
import { stopPreview } from '../lib/preview';
import { DEFAULT_SETTINGS, saveStore, settingsStore, useCell, type Settings } from '../state/store';
import { emptySave } from '../../shared/progression';
import AccountAccess from '../components/AccountAccess';
import { Screen } from './common';

const CODE = /^(Key[A-Z]|Digit[0-9]|Semicolon|Comma|Period|Slash|Quote|BracketLeft|BracketRight|Minus|Equal)$/;
type Target = { group: 'keys' | 'p1' | 'p2'; lane: number };

function TapTest({ onResult }: { onResult: (offset: number) => void }) {
  const [running, setRunning] = useState(false);
  const [taps, setTaps] = useState<number[]>([]);
  const context = useRef<AudioContext>(null);
  const start = useRef(0);
  const interval = 0.6;
  useEffect(() => {
    if (!running) return;
    const ctx = context.current ??= new AudioContext();
    void ctx.resume();
    start.current = ctx.currentTime + 0.6;
    for (let beat = 0; beat < 12; beat++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = beat % 4 === 0 ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, start.current + beat * interval);
      gain.gain.exponentialRampToValueAtTime(0.5, start.current + beat * interval + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start.current + beat * interval + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start.current + beat * interval);
      osc.stop(start.current + beat * interval + 0.1);
    }
    const collected: number[] = [];
    const tap = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      event.preventDefault();
      const latency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
      const now = ctx.currentTime - latency - (performance.now() - event.timeStamp) / 1000;
      const beat = Math.round((now - start.current) / interval);
      if (beat < 2 || beat > 11) return;
      collected.push((now - (start.current + beat * interval)) * 1000);
      setTaps([...collected]);
    };
    window.addEventListener('keydown', tap);
    const done = setTimeout(() => {
      setRunning(false);
      if (collected.length >= 5) {
        const sorted = [...collected].sort((a, b) => a - b);
        onResult(Math.round(sorted[sorted.length >> 1] / 5) * 5);
      }
    }, (0.6 + 12 * interval) * 1000 + 300);
    return () => { window.removeEventListener('keydown', tap); clearTimeout(done); };
  }, [running, onResult]);
  useEffect(() => () => { void context.current?.close().catch(() => {}); }, []);
  return <div className="tap-test">
    <button type="button" disabled={running} onClick={() => { stopPreview(); setTaps([]); setRunning(true); }}>{running ? 'Tap Space on every click…' : 'Run the tap test'}</button>
    <span role="status">{running ? `${taps.length} taps` : taps.length >= 5 ? 'Offset set from your taps.' : taps.length ? 'Not enough taps. Try again.' : 'Twelve clicks play. Tap Space in time with them.'}</span>
  </div>;
}

export default function SettingsScreen() {
  const app = useApp();
  const settings = useCell(settingsStore);
  const [target, setTarget] = useState<Target>();
  const [status, setStatus] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const update = (patch: Partial<Settings>) => settingsStore.set(previous => ({ ...previous, ...patch }));

  useEffect(() => {
    if (!target) return;
    const remap = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.stopPropagation(); event.preventDefault(); setTarget(undefined); setStatus('Key change canceled.'); return; }
      if (!CODE.test(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const current = settingsStore.get();
      const label = keyLabel(event.code);
      if (target.group === 'keys') {
        const conflict = current.keys.findIndex((key, lane) => lane !== target.lane && key === event.code);
        if (conflict >= 0) { setStatus(`${label} is already lane ${conflict + 1}. Choose another key.`); return; }
        update({ keys: current.keys.map((key, lane) => lane === target.lane ? event.code : key) });
      } else {
        const side = target.group === 'p1' ? 0 : 1;
        const all = [...current.partyKeys[0], ...current.partyKeys[1]];
        const mine = side * 5 + target.lane;
        if (all.some((key, index) => index !== mine && key === event.code)) { setStatus(`${label} is already used in party mode. Choose another key.`); return; }
        const next: [string[], string[]] = [[...current.partyKeys[0]], [...current.partyKeys[1]]];
        next[side][target.lane] = event.code;
        update({ partyKeys: next });
      }
      setStatus(`Lane ${target.lane + 1} now uses ${label}.`);
      setTarget(undefined);
      sfx.play('ui-select');
    };
    window.addEventListener('keydown', remap, true);
    return () => window.removeEventListener('keydown', remap, true);
  }, [target]);

  const keyRow = (group: Target['group'], keys: string[]) => <div className="key-settings">
    {keys.map((key, lane) => {
      const active = target?.group === group && target.lane === lane;
      return <button key={lane} type="button" aria-pressed={active} aria-label={`Remap lane ${lane + 1}, current key ${keyLabel(key)}`}
        onClick={() => { setTarget({ group, lane }); setStatus(`Press a new key for lane ${lane + 1}. Escape cancels.`); }}>{active ? '…' : keyLabel(key)}</button>;
    })}
  </div>;

  return <Screen title="Settings" onBack={() => app.go({ name: 'menu' })} className="settings-screen">
    <div className="settings-grid">
      <section className="panel">
        <h2>Controls</h2>
        <p>Pick a lane, then press the key you want. Space fires the amp.</p>
        <h3>Solo</h3>{keyRow('keys', settings.keys)}
        <h3>Party: player 1</h3>{keyRow('p1', settings.partyKeys[0])}
        <h3>Party: player 2</h3>{keyRow('p2', settings.partyKeys[1])}
        <p role="status">{status}</p>
        <button type="button" onClick={() => { update({ keys: DEFAULT_SETTINGS.keys, partyKeys: DEFAULT_SETTINGS.partyKeys }); setStatus('Default keys restored.'); }}>Reset keys</button>
      </section>
      <section className="panel">
        <h2>Timing and speed</h2>
        <label className="field">Note speed<input type="range" min={800} max={2800} step={50} value={3600 - settings.speed}
          onChange={event => update({ speed: 3600 - Number(event.target.value) })} /><small>{settings.speed <= 1200 ? 'Fast' : settings.speed <= 1900 ? 'Standard' : 'Relaxed'} · notes take {(settings.speed / 1000).toFixed(2)} s to reach the line</small></label>
        <label className="field">Timing offset (ms)<input type="number" min={-250} max={250} step={5} value={settings.calibration}
          onChange={event => update({ calibration: Math.max(-250, Math.min(250, Number(event.target.value) || 0)) })} />
          <small>Raise it if your hits register late, for example on Bluetooth speakers.</small></label>
        <TapTest onResult={offset => update({ calibration: Math.max(-250, Math.min(250, offset)) })} />
      </section>
      <section className="panel">
        <h2>Sound</h2>
        <label className="field">Music volume<input type="range" min={0} max={1} step={0.05} value={settings.musicVolume} onChange={event => update({ musicVolume: Number(event.target.value) })} /></label>
        <label className="field">Effects volume<input type="range" min={0} max={1} step={0.05} value={settings.sfxVolume}
          onChange={event => { update({ sfxVolume: Number(event.target.value) }); sfx.volume = Number(event.target.value); sfx.play('ui-select'); }} /></label>
        <label className="field">Hit sounds<select value={settings.hitSounds} onChange={event => update({ hitSounds: event.target.value as Settings['hitSounds'] })}>
          <option value="auto">Automatic (off when your hits play the guitar)</option><option value="on">Always on</option><option value="off">Off</option></select></label>
      </section>
      <section className="panel">
        <h2>Display</h2>
        <label className="check"><input type="checkbox" checked={settings.calm} onChange={event => update({ calm: event.target.checked })} /> Reduce flashes and screen shake</label>
        <label className="check"><input type="checkbox" checked={settings.showKeyboard} onChange={event => update({ showKeyboard: event.target.checked })} /> Show the finger guide keyboard in typing lessons</label>
      </section>
      <section className="panel">
        <h2>Account</h2>
        {app.user ? <>
          <p>Signed in as {app.user.email ?? 'your account'}. You can create your own tracks.</p>
          <button onClick={() => void import('firebase/auth').then(({ signOut }) => signOut(app.auth!))}>Sign out</button>
        </> : app.auth ? <>
          <p>You are playing as a guest. Sign in to create your own tracks with AI and keep them in your library.</p>
          <AccountAccess auth={app.auth} invite={false} />
        </> : <p>You are playing as a guest. Your progress is saved in this browser.</p>}
      </section>
      <section className="panel">
        <h2>Progress</h2>
        <p>Levels, stars, unlocks and typing history are stored in this browser.</p>
        {confirmReset ? <div className="confirm">
          <p>This erases your level, stars and unlocks on this device.</p>
          <button className="danger" onClick={() => { saveStore.set({ ...emptySave(), seenTutorial: true }); setConfirmReset(false); setStatus('Progress reset.'); }}>Erase my progress</button>
          <button onClick={() => setConfirmReset(false)}>Keep it</button>
        </div> : <button onClick={() => setConfirmReset(true)}>Reset progress…</button>}
        <button onClick={() => void app.launch('river-amp', { mode: 'tutorial', difficulty: 'beginner', mods: [], tutorial: true }, { name: 'settings' })}>Replay the warm-up</button>
      </section>
    </div>
  </Screen>;
}
