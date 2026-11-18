import { useEffect, useRef, useState } from 'react';
import { Guitar } from 'lucide-react';
import { sfx } from '../game/sfx';
import {
  active, canWakeGhl, changedControl, DEFAULT_PAD, describe, looksLikeGuitar, PAD_STEPS, padFocus, padName, pads, snapshot,
  wakeGhlDongle, type Binding, type PadMap,
} from '../game/gamepad';
import { laneColors, settingsStore, useCell } from '../state/store';

/** Settings panel for guitar controllers: live fret lights, play style, a mapping wizard and the Guitar Hero Live wake-up. */
export default function GuitarSetup() {
  const settings = useCell(settingsStore);
  const [name, setName] = useState('');
  const [guitar, setGuitar] = useState(false);
  const [lit, setLit] = useState<boolean[]>([]);
  const [step, setStep] = useState(-1);
  const [status, setStatus] = useState('');
  const draft = useRef<Binding[]>([]);
  const before = useRef<ReturnType<typeof snapshot> | null>(null);
  const settle = useRef(0);
  const colors = laneColors(settings);
  const map = settings.pad;
  const setMap = (patch: Partial<PadMap>) => settingsStore.set(previous => ({ ...previous, pad: { ...previous.pad, ...patch } }));

  useEffect(() => {
    let frame = 0;
    let last = '';
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const pad = pads()[0];
      setName(pad ? padName(pad) : '');
      setGuitar(!!pad && looksLikeGuitar(pad));
      if (!pad) return;
      const current = settingsStore.get().pad;
      const state = [...current.frets.map(binding => active(pad, binding)), active(pad, current.strumDown) || active(pad, current.strumUp),
        current.overdrive.some(binding => active(pad, binding))];
      if (state.join() !== last) { last = state.join(); setLit(state); }
      if (step < 0) return;
      // Wait for every control to be let go before listening for the next one.
      if (!before.current || performance.now() < settle.current) { before.current = snapshot(pad); return; }
      const found = changedControl(pad, before.current);
      if (!found) return;
      draft.current[step] = found;
      sfx.play('ui-select');
      settle.current = performance.now() + 450;
      before.current = null;
      if (step + 1 < PAD_STEPS.length) { setStep(step + 1); return; }
      const [g, r, y, b, o, down, up, drive, pause] = draft.current;
      settingsStore.set(previous => ({ ...previous, pad: { ...previous.pad, frets: [g, r, y, b, o], strumDown: down, strumUp: up, overdrive: [drive], pause } }));
      setStep(-1);
      setStatus('Controller mapped. Strum to try it.');
    };
    frame = requestAnimationFrame(loop);
    padFocus.mapping = step >= 0;
    return () => { cancelAnimationFrame(frame); padFocus.mapping = false; };
  }, [step]);

  const begin = () => { draft.current = []; before.current = null; settle.current = performance.now() + 300; setStatus(''); setStep(0); };
  const wake = () => {
    setStatus('Choose the dongle in the browser window.');
    void wakeGhlDongle().then(device => setStatus(`${device} is awake. Press a fret, then map the buttons below.`))
      .catch(reason => setStatus(reason instanceof Error ? reason.message : 'Could not reach the dongle.'));
  };

  return <section className="panel guitar-setup">
    <h2><Guitar aria-hidden="true" size={20} /> Guitar controller</h2>
    <p>Plug in a Guitar Hero or Rock Band guitar, or any gamepad, and press a button on it. Strum to move through menus, green to choose, red to go back.</p>
    <p role="status" className={name ? 'pad-status on' : 'pad-status'}>{name ? `Connected: ${name}${guitar ? '' : ' (gamepad)'}` : 'No controller found yet. Press any button on it.'}</p>
    {name && <div className="pad-test" aria-label="Controller test">
      {colors.map((color, lane) => <i key={lane} className={lit[lane] ? 'on' : ''} style={{ '--lane': color } as React.CSSProperties} />)}
      <span className={lit[5] ? 'on' : ''}>Strum</span><span className={lit[6] ? 'on' : ''}>Overdrive</span>
    </div>}
    <label className="field">Play style<select value={map.mode} onChange={event => setMap({ mode: event.target.value as PadMap['mode'] })}>
      <option value="strum">Strum: hold frets and strum each note</option>
      <option value="tap">Tap: pressing a fret plays the note</option>
    </select></label>
    {step >= 0 ? <div className="pad-wizard" role="status">
      <strong>Step {step + 1} of {PAD_STEPS.length}</strong>
      <p>Press: {PAD_STEPS[step]}</p>
      <button type="button" onClick={() => { setStep(-1); setStatus('Mapping canceled.'); }}>Cancel</button>
    </div> : <div className="confirm">
      <button type="button" disabled={!name} onClick={begin}>Map the buttons</button>
      <button type="button" onClick={() => { setMap(DEFAULT_PAD); setStatus('Default mapping restored.'); }}>Reset mapping</button>
    </div>}
    <p className="muted pad-map">Current mapping: {['Green', 'Red', 'Yellow', 'Blue', 'Orange'].map((name, lane) => `${name} fret is ${describe(map.frets[lane]).toLowerCase()}`).join(', ')}. Strum down is {describe(map.strumDown).toLowerCase()}, strum up is {describe(map.strumUp).toLowerCase()}. On this screen the red fret only lights its test lamp. Use the Back button or Escape to leave.</p>
    <details>
      <summary>Using a Guitar Hero Live guitar? Open this.</summary>
      <p>The six-button Guitar Hero Live guitar works through its USB dongle (PlayStation 3, Wii U or PlayStation 4 version) in Chrome or Edge. The dongle only sends button presses after the game wakes it up.</p>
      <p>Songs here use five lanes, so map five of the six buttons: the three black buttons and the first two white ones work well.</p>
      <button type="button" disabled={!canWakeGhl()} onClick={wake}>Wake the dongle</button>
      {!canWakeGhl() && <p className="muted">This browser cannot reach the dongle. Use Chrome or Edge on a computer.</p>}
    </details>
    <p role="status">{status}</p>
  </section>;
}
