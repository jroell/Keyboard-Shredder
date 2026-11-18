import { useState } from 'react';
import { Bot, Handshake, Play, Swords } from 'lucide-react';
import { DIFFICULTIES, difficultyNames } from '../../shared/difficulty';
import { keyLabel } from '../../shared/practice';
import type { Difficulty } from '../../shared/song';
import { useApp } from '../App';
import { sfx } from '../game/sfx';
import { laneColors, saveStore, settingsStore, useCell } from '../state/store';
import { formatLength, Screen } from './common';

const CPU = [
  { id: 'off', label: 'A friend', skill: undefined as number | undefined },
  { id: 'rookie', label: 'Computer: rookie', skill: 0.55 },
  { id: 'pro', label: 'Computer: pro', skill: 0.8 },
  { id: 'legend', label: 'Computer: legend', skill: 0.96 },
];

export default function PartySetup() {
  const app = useApp();
  const settings = useCell(settingsStore);
  const save = useCell(saveStore);
  const [coop, setCoop] = useState(false);
  const [songId, setSongId] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>(settings.difficulty);
  const [rival, setRival] = useState('off');
  const [names, setNames] = useState<[string, string]>([save.name || 'Player 1', 'Player 2']);
  const colors = laneColors(settings);
  const songs = app.songs;
  const chosen = songId || songs[0]?.id || '';
  const cpu = CPU.find(option => option.id === rival)!;
  const second = cpu.skill === undefined ? names[1] : cpu.label.replace('Computer: ', 'CPU ');
  const start = () => {
    if (!chosen) return;
    sfx.play('ui-select');
    void app.launch(chosen, { mode: 'party', difficulty, mods: [], party: { coop, cpu: cpu.skill, names: [names[0].trim() || 'Player 1', second.trim() || 'Player 2'] } }, { name: 'party' });
  };
  return <Screen title="Party mode" eyebrow="Two players, one keyboard" onBack={() => app.go({ name: 'menu' })} className="party-screen">
    <div className="party-modes" role="radiogroup" aria-label="Game type">
      <button role="radio" aria-checked={!coop} className={!coop ? 'on' : ''} onClick={() => { sfx.play('ui-toggle'); setCoop(false); }}>
        <Swords aria-hidden="true" /><strong>Battle</strong><span>Highest score wins. Fire your overdrive to shake the other player's neck.</span></button>
      <button role="radio" aria-checked={coop} className={coop ? 'on' : ''} onClick={() => { sfx.play('ui-toggle'); setCoop(true); }}>
        <Handshake aria-hidden="true" /><strong>Co-op</strong><span>Share the stage. Your scores add up to one team total.</span></button>
    </div>
    <div className="party-players">
      {[0, 1].map(index => <section key={index} className="panel">
        <label className="field">{index === 0 ? 'Player 1' : 'Player 2'}
          {index === 1 && cpu.skill !== undefined ? <input value={second} readOnly /> :
            <input maxLength={16} value={names[index]} onChange={event => setNames(previous => index === 0 ? [event.target.value, previous[1]] : [previous[0], event.target.value])} />}</label>
        {index === 1 && <label className="field"><span><Bot aria-hidden="true" size={14} /> Opponent</span><select value={rival} onChange={event => setRival(event.target.value)}>
          {CPU.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
        <div className="ready-keys">{settings.partyKeys[index].map((code, lane) => <kbd key={code} style={{ '--lane': colors[lane] } as React.CSSProperties}>{keyLabel(code)}</kbd>)}</div>
        <small>Overdrive: {index === 0 ? 'Space' : 'Enter'}</small>
      </section>)}
    </div>
    <div className="form-row party-song">
      <label className="field">Song<select value={chosen} onChange={event => setSongId(event.target.value)}>
        {songs.map(song => <option key={song.id} value={song.id}>{song.title} · {song.genre || 'My tracks'} · {formatLength(song.durationMs)}</option>)}</select></label>
      <label className="field">Difficulty<select value={difficulty} onChange={event => setDifficulty(event.target.value as Difficulty)}>
        {DIFFICULTIES.map(level => <option key={level} value={level}>{difficultyNames[level]}</option>)}</select></label>
      <button className="primary big" autoFocus disabled={!chosen} onClick={start}><Play aria-hidden="true" />Start</button>
    </div>
    <p className="muted">Sit side by side. Player 1 takes the left half of the home row, player 2 the right half. Change the keys in Settings.</p>
  </Screen>;
}
