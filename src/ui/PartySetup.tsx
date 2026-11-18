import { useState } from 'react';
import { Bot, Handshake, Play, Swords } from 'lucide-react';
import { DIFFICULTIES, difficultyNames, isDifficulty } from '../../shared/difficulty';
import { keyLabel } from '../../shared/practice';
import type { Difficulty } from '../../shared/song';
import { useApp } from '../App';
import { sfx } from '../game/sfx';
import { currentPlayer, laneColors, listPlayers, saveStore, settingsStore, useCell } from '../state/store';
import { formatLength, Screen } from './common';

const CPU = [
  { id: 'off', label: 'A friend', skill: undefined as number | undefined },
  { id: 'rookie', label: 'Computer: rookie', skill: 0.55 },
  { id: 'pro', label: 'Computer: pro', skill: 0.8 },
  { id: 'legend', label: 'Computer: legend', skill: 0.96 },
];

/** The last setup, so a rematch with one change is two clicks away. */
const last: { coop?: boolean; songId?: string; levels?: [Difficulty, Difficulty]; rival?: string; names?: [string, string]; seats?: [string | null, string | null] } = {};

export default function PartySetup() {
  const app = useApp();
  const settings = useCell(settingsStore);
  const save = useCell(saveStore);
  const [coop, setCoop] = useState(last.coop ?? false);
  const [songId, setSongId] = useState(last.songId ?? '');
  const [levels, setLevels] = useState<[Difficulty, Difficulty]>(() => {
    // The warm-up sends a first-time pair here on Beginner.
    try {
      const preset = sessionStorage.getItem('ks:partyLevel');
      sessionStorage.removeItem('ks:partyLevel');
      if (preset && isDifficulty(preset)) return [preset, preset];
    } catch { /* optional */ }
    return last.levels ?? [settings.difficulty, settings.difficulty];
  });
  const [rival, setRival] = useState(last.rival ?? 'off');
  const [names, setNames] = useState<[string, string]>(last.names ?? [save.name || 'Player 1', 'Player 2']);
  // Each seat holds a saved player, who earns their own XP and stats, or a guest, who keeps nothing.
  const [seats, setSeats] = useState<[string | null, string | null]>(last.seats ?? [currentPlayer, null]);
  const saved = listPlayers();
  const seatName = (index: number) => seats[index] === null ? names[index] : saved.find(player => player.id === seats[index])?.name ?? names[index];
  const sit = (index: number, value: string) => {
    const id = value === 'guest' ? null : value;
    setSeats(previous => {
      const next: [string | null, string | null] = [previous[0], previous[1]];
      next[index] = id;
      // One saved player cannot sit in both seats.
      if (id !== null && next[1 - index] === id) next[1 - index] = null;
      return next;
    });
    if (id === null && (saved.some(player => player.name === names[index]) || !names[index].trim())) {
      setNames(previous => index === 0 ? ['Guest 1', previous[1]] : [previous[0], 'Guest 2']);
    }
  };
  const colors = laneColors(settings);
  const songs = app.songs;
  const chosen = songId || songs[0]?.id || '';
  const cpu = CPU.find(option => option.id === rival)!;
  const second = cpu.skill === undefined ? seatName(1) : cpu.label.replace('Computer: ', 'CPU ');
  const start = () => {
    if (!chosen) return;
    sfx.play('ui-select');
    Object.assign(last, { coop, songId: chosen, levels, rival, names, seats });
    void app.launch(chosen, { mode: 'party', difficulty: levels[0], mods: [],
      party: { coop, cpu: cpu.skill, names: [seatName(0).trim() || 'Player 1', second.trim() || 'Player 2'], difficulties: levels,
        seats: [seats[0], cpu.skill === undefined ? seats[1] : null] } }, { name: 'party' });
  };
  return <Screen title="Party mode" eyebrow="Two players, one keyboard" onBack={() => app.go({ name: 'menu' })} className="party-screen">
    <div className="party-modes" role="radiogroup" aria-label="Game type">
      <button role="radio" aria-checked={!coop} className={!coop ? 'on' : ''} onClick={() => { sfx.play('ui-toggle'); setCoop(false); }}>
        <Swords aria-hidden="true" /><strong>Battle</strong><span>{levels[0] === levels[1] ? 'Highest score wins.' : 'Best timing rating wins, so different difficulties are a fair fight.'} Fire your overdrive to shake the other player's neck.</span></button>
      <button role="radio" aria-checked={coop} className={coop ? 'on' : ''} onClick={() => { sfx.play('ui-toggle'); setCoop(true); }}>
        <Handshake aria-hidden="true" /><strong>Co-op</strong><span>Share the stage. Your scores add up to one team total.</span></button>
    </div>
    <div className="party-players">
      {[0, 1].map(index => <section key={index} className="panel">
        {index === 1 && cpu.skill !== undefined ? <label className="field">Player 2<input value={second} readOnly /></label> : <>
          <label className="field">{index === 0 ? 'Player 1' : 'Player 2'}
            <select aria-label={`Player ${index + 1} profile`} value={seats[index] ?? 'guest'} onChange={event => sit(index, event.target.value)}>
              {saved.map(player => <option key={player.id} value={player.id}>{player.name} · level {player.level}</option>)}
              <option value="guest">Guest</option>
            </select></label>
          {seats[index] === null
            ? <label className="field">Guest name<input maxLength={16} value={names[index]} onChange={event => setNames(previous => index === 0 ? [event.target.value, previous[1]] : [previous[0], event.target.value])} /></label>
            : <label className="field">Name on stage<input value={seatName(index)} readOnly /></label>}
          <small className="seat-note">{seats[index] === null ? 'Guests keep no progress. Add players in the Locker.' : `XP and stats go to ${seatName(index)}'s profile.`}</small>
        </>}
        <label className="field">Difficulty<select value={levels[index]}
          onChange={event => setLevels(previous => index === 0 ? [event.target.value as Difficulty, previous[1]] : [previous[0], event.target.value as Difficulty])}>
          {DIFFICULTIES.map(level => <option key={level} value={level}>{difficultyNames[level]}</option>)}</select></label>
        <div className="ready-keys">{settings.partyKeys[index].map((code, lane) => <kbd key={code} className={levels[index] === 'beginner' && (lane === 0 || lane === 4) && !(index === 1 && cpu.skill !== undefined) ? 'unused' : ''} style={{ '--lane': colors[lane] } as React.CSSProperties}>{keyLabel(code)}</kbd>)}</div>
        <small>Seat: {index === 0 ? 'left' : 'right'} half of the keyboard · Overdrive: {index === 0 ? 'Space' : 'Enter'}{levels[index] === 'beginner' ? ' · Beginner uses the three middle keys' : ''}</small>
      </section>)}
    </div>
    <div className="form-row party-song">
      <label className="field"><span><Bot aria-hidden="true" size={14} /> Who plays player 2</span>
        <select value={rival} onChange={event => setRival(event.target.value)}>
          {CPU.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label className="field">Song<select value={chosen} onChange={event => setSongId(event.target.value)}>
        {songs.map(song => <option key={song.id} value={song.id}>{song.title} · {song.genre || 'My tracks'} · {formatLength(song.durationMs)}</option>)}</select></label>
      <button className="primary big" autoFocus disabled={!chosen} onClick={start}><Play aria-hidden="true" />Start</button>
    </div>
    {levels[0] !== levels[1] && !coop && <p className="muted">With different difficulties, the battle goes to whoever plays their own chart more accurately. A beginner can beat an expert.</p>}
    <p className="muted">Sit side by side. Player 1 takes the left half of the home row, player 2 the right half. Change the keys in Settings.</p>
  </Screen>;
}
