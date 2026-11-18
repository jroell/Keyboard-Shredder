import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Play, Trophy } from 'lucide-react';
import { DIFFICULTIES, difficultyBlurbs, difficultyNames } from '../../shared/difficulty';
import { isRanked, MOD_IDS, MODS, modMultiplier, type ModId } from '../../shared/modifiers';
import { recordKey } from '../../shared/progression';
import { useApp } from '../App';
import { call, fetchBoard, type Board } from '../lib/api';
import { notesFor } from '../../shared/difficulty';
import type { Chart, Difficulty } from '../../shared/song';
import { previewSong, stopPreview } from '../lib/preview';
import { stageArt } from '../lib/stage-art';
import { sfx } from '../game/sfx';
import { currentPlayer, saveStore, settingsStore, useCell } from '../state/store';
import { formatLength, Screen, Stars, useMenuKeys } from './common';
import fallbackArt from '../assets/concert-stage.webp';

export const count = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;
const charts = new Map<string, Chart>();
/** The song last highlighted, so coming back from a run lands on it. */
const last = { songId: '', genre: 'All' };

export default function SongSelect() {
  const app = useApp();
  const save = useCell(saveStore);
  const settings = useCell(settingsStore);
  const [genre, setGenre] = useState(last.genre);
  const [index, setIndex] = useState(0);
  const restored = useRef(false);
  const [mods, setMods] = useState<ModId[]>([]);
  const [board, setBoard] = useState<Board>();
  const list = useRef<HTMLUListElement>(null);
  const difficulty = settings.difficulty;
  // The last few songs this player started, newest first, so a returning player is one press from their song.
  const recent = useMemo<string[]>(() => { try { return JSON.parse(localStorage.getItem(`ks:recent:${currentPlayer}`) || '[]'); } catch { return []; } }, []);
  const genres = useMemo(() => ['All', ...(recent.some(id => app.songs.some(song => song.id === id)) ? ['Recent'] : []), ...new Set(app.songs.map(song => song.genre || 'My tracks'))], [app.songs, recent]);
  const songs = useMemo(() => genre === 'Recent' ? recent.flatMap(id => app.songs.filter(song => song.id === id))
    : app.songs.filter(song => genre === 'All' || (song.genre || 'My tracks') === genre), [app.songs, genre, recent]);
  const song = songs[Math.min(index, songs.length - 1)];
  const record = song ? save.records[recordKey(song.id, difficulty)] : undefined;

  const setDifficulty = (direction: -1 | 1) => {
    const next = DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, DIFFICULTIES.indexOf(difficulty) + direction))];
    if (next === difficulty) return;
    sfx.play('ui-toggle');
    settingsStore.set(previous => ({ ...previous, difficulty: next }));
  };
  const play = () => {
    if (!song) return;
    sfx.play('ui-select');
    stopPreview();
    try { localStorage.setItem(`ks:recent:${currentPlayer}`, JSON.stringify([song.id, ...recent.filter(id => id !== song.id)].slice(0, 6))); } catch { /* optional */ }
    void app.launch(song.id, { mode: 'quickplay', difficulty, mods }, { name: 'songs' });
  };
  useMenuKeys({ count: songs.length, index, setIndex, onPick: play, onSide: setDifficulty });

  useEffect(() => {
    if (!restored.current && songs.length) {
      restored.current = true;
      const found = songs.findIndex(item => item.id === last.songId);
      if (found >= 0) { setIndex(found); return; }
    }
    if (restored.current && last.genre !== genre) setIndex(0);
    last.genre = genre;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genre, songs.length]);
  useEffect(() => { if (song && restored.current) last.songId = song.id; }, [song?.id]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, songs]);

  useEffect(() => {
    if (!song) return;
    const timer = setTimeout(() => previewSong(song.id, settings.musicVolume), 380);
    return () => clearTimeout(timer);
  }, [song?.id, settings.musicVolume]);
  useEffect(() => stopPreview, []);

  useEffect(() => {
    setBoard(undefined);
    if (!song || song.model !== 'starter-setlist' || !isRanked(mods)) return;
    let active = true;
    const timer = setTimeout(() => {
      fetchBoard(song.id, difficulty, mods).then(next => { if (active) setBoard(next); }).catch(() => {});
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [song?.id, song?.model, difficulty, mods]);

  // The chart for the highlighted song, to show how busy this difficulty is before you commit.
  const [chart, setChart] = useState<Chart>();
  useEffect(() => {
    if (!song) return;
    setChart(charts.get(song.id));
    if (charts.has(song.id)) return;
    let active = true;
    const timer = setTimeout(() => {
      call(`/songs/${song.id}`).then(response => response.json()).then((body: { chart: Chart }) => {
        charts.set(song.id, body.chart);
        if (active) setChart(body.chart);
      }).catch(() => {});
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [song?.id]);
  const counts = useMemo(() => {
    if (!chart) return null;
    const events = notesFor(chart, difficulty);
    return { notes: events.length, chords: events.filter(event => event.lanes.length > 1).length, holds: events.filter(event => event.durationMs > 0).length };
  }, [chart, difficulty]);
  const practice = (drill = false, level: Difficulty = difficulty) => {
    if (!song) return;
    sfx.play('ui-select');
    stopPreview();
    // The drill opens on the section with the most chords and holds.
    const size = song.durationMs / 8;
    const events = chart && drill ? notesFor(chart, level) : [];
    const weight = Array.from({ length: 8 }, (_, index) => events.filter(event => event.timeMs >= index * size && event.timeMs < (index + 1) * size)
      .reduce((total, event) => total + (event.lanes.length > 1 ? 1 : 0) + (event.durationMs > 0 ? 1 : 0), 0));
    const section = drill ? weight.indexOf(Math.max(...weight)) : 0;
    void app.launch(song.id, { mode: 'quickplay', difficulty: level, mods: mods.filter(id => id !== 'sudden' && id !== 'slow'),
      practice: { startMs: Math.round(section * size), endMs: Math.round((section + 1) * size), rate: 0.75 } }, { name: 'songs' });
  };

  const art = song ? stageArt(song.id) ?? fallbackArt : fallbackArt;
  return <Screen title="Quick play" eyebrow="Choose your song" onBack={() => { stopPreview(); app.go({ name: 'menu' }); }} className="songs-screen">
    <div className="songs-backdrop" key={art} style={{ backgroundImage: `url("${art}")` }} aria-hidden="true" />
    <label className="field genre-select">Genre<select value={genre} onChange={event => setGenre(event.target.value)}>
      {genres.map(name => <option key={name}>{name}</option>)}</select></label>
    <div className="chips genre-chips" role="tablist" aria-label="Genre">
      {genres.map(name => <button key={name} role="tab" aria-selected={genre === name} className={genre === name ? 'on' : ''}
        onClick={event => { event.currentTarget.blur(); sfx.play('ui-toggle'); setGenre(name); }}>{name}</button>)}
    </div>
    <div className="songs-layout">
      <ul className="song-list" ref={list} role="listbox" aria-label="Songs">
        {songs.map((item, itemIndex) => {
          const best = save.records[recordKey(item.id, difficulty)];
          return <li key={item.id} role="option" aria-selected={itemIndex === index} className={itemIndex === index ? 'active' : ''}
            onClick={() => { if (itemIndex === index) play(); else { sfx.play('ui-move'); setIndex(itemIndex); } }}
            onDoubleClick={play}>
            <span className="song-thumb" style={{ backgroundImage: `url("${stageArt(item.id) ?? fallbackArt}")` }} aria-hidden="true" />
            <span className="song-text"><strong>{item.title}</strong><small>{item.credit ? `${item.credit.artist} · ` : ''}{item.genre || 'My tracks'} · {formatLength(item.durationMs)}
              {item.intensity ? <span className="intensity" title={`Intensity ${item.intensity} of 5`} aria-label={`Intensity ${item.intensity} of 5`}>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < item.intensity! ? 'on' : ''} />)}</span> : null}</small></span>
            {best ? <span className="song-best"><Stars count={best.stars} size={12} /><b data-grade={best.grade[0]}>{best.grade}</b></span>
              : <span className="song-best unplayed" aria-label="Not played yet">–</span>}
          </li>;
        })}
        {!songs.length && <li className="empty">{app.songs.length ? 'No songs in this genre yet.' : 'Loading the setlist…'}</li>}
      </ul>
      {song && <section className="song-panel" aria-label={`${song.title} details`}>
        <div className="song-cover" style={{ backgroundImage: `url("${art}")` }}>
          <div><p className="eyebrow">{song.genre || 'My tracks'} · {formatLength(song.durationMs)}{song.bpm ? ` · ${song.bpm} BPM` : ''}</p><h2>{song.title}</h2>
            <p>{song.credit ? <>{song.credit.artist} · <a href={song.credit.source} target="_blank" rel="noreferrer">Source</a> · <a href={song.credit.licenseUrl} target="_blank" rel="noreferrer">{song.credit.license}</a></>
              : song.model === 'starter-setlist' ? 'Keyboard Shredder original' : 'Your track'}</p></div>
        </div>
        <div className="difficulty-pick" role="group" aria-label="Difficulty">
          <button className="icon-button" aria-label="Easier" disabled={difficulty === DIFFICULTIES[0]} onClick={event => { event.currentTarget.blur(); setDifficulty(-1); }}><ChevronLeft aria-hidden="true" /></button>
          <div className="difficulty-name" data-level={difficulty}>
            <strong>{difficultyNames[difficulty]}</strong>
            <span className="difficulty-pips" aria-hidden="true">{DIFFICULTIES.map((level, i) => <i key={level} className={i <= DIFFICULTIES.indexOf(difficulty) ? 'on' : ''} />)}</span>
            <small>{difficultyBlurbs[difficulty]}</small>
            <small className="chart-counts">{counts ? [count(counts.notes, 'note'), count(counts.chords, 'chord'), count(counts.holds, 'hold')].join(' · ') : '\u00a0'}</small>
          </div>
          <button className="icon-button" aria-label="Harder" disabled={difficulty === DIFFICULTIES.at(-1)} onClick={event => { event.currentTarget.blur(); setDifficulty(1); }}><ChevronRight aria-hidden="true" /></button>
        </div>
        <div className="mods" role="group" aria-label="Modifiers">
          {MOD_IDS.map(id => <button key={id} className={mods.includes(id) ? 'on' : ''} aria-pressed={mods.includes(id)} title={MODS[id].blurb}
            onClick={event => { event.currentTarget.blur(); sfx.play('ui-toggle'); setMods(previous => previous.includes(id) ? previous.filter(mod => mod !== id) : MOD_IDS.filter(mod => mod === id || previous.includes(mod))); }}>
            {MODS[id].name}{MODS[id].bonus ? <em>{MODS[id].bonus > 0 ? '+' : ''}{Math.round(MODS[id].bonus * 100)}%</em> : null}</button>)}
          {mods.length > 0 && <p className="mods-note">{mods.map(id => MODS[id].blurb).join(' ')} Score ×{modMultiplier(mods).toFixed(2)}.</p>}
        </div>
        <div className="song-record">
          {record ? <><Stars count={record.stars} size={20} /><strong>{record.score.toLocaleString()}</strong>
            <span className="grade small" data-grade={record.grade[0]}>{record.grade}</span>{record.fullCombo && <em>Full combo</em>}</>
            : <span className="muted">No score yet on {difficultyNames[difficulty]}. Set the first one.</span>}
        </div>
        <div className="song-actions">
          <button className="primary big play-song" onClick={play} style={{ '--pulse': '1' } as CSSProperties}><Play aria-hidden="true" />Play</button>
          <button onClick={() => practice()} title="Loop one section at a slower speed. Nothing is saved or ranked.">Practice</button>
        </div>
        {!record && counts && counts.chords + counts.holds > 0 && ['medium', 'hard', 'expert'].includes(difficulty) &&
          <p className="drill-hint">New to chords and holds? <button className="link" onClick={() => practice(true)}>Drill the busiest part at 75% speed</button></p>}
        {chart && ['beginner', 'easy'].includes(difficulty) && notesFor(chart, 'medium').some(event => event.lanes.length > 1) &&
          <p className="drill-hint">Ready for two keys at once? <button className="link" onClick={() => practice(true, 'medium')}>Try a slow chord drill from Medium</button></p>}
        {song.model === 'starter-setlist' && <div className="mini-board-wrap">
          <h3><Trophy aria-hidden="true" size={15} /> Leaderboard</h3>
          {!isRanked(mods) ? <p className="muted">Slow-mo runs are for practice and stay off the board.</p> : board ? board.entries.length ? <ol className="mini-board">{board.entries.slice(0, 5).map(entry =>
            <li key={entry.rank + entry.name} className={entry.you ? 'you' : ''}><span>{entry.rank}</span><strong>{entry.name}</strong><em>{entry.score.toLocaleString()}</em></li>)}
            {board.you && board.you.rank > 5 && <li className="you"><span>{board.you.rank}</span><strong>You</strong><em>{board.you.score.toLocaleString()}</em></li>}</ol>
            : <p className="muted">Nobody has posted a score here. Be the first.</p> : <p className="muted">Loading scores…</p>}
        </div>}
      </section>}
    </div>
    <footer className="menu-foot"><kbd>↑</kbd><kbd>↓</kbd> song · <kbd>←</kbd><kbd>→</kbd> difficulty · <kbd>Enter</kbd> play · <kbd>Esc</kbd> back</footer>
  </Screen>;
}
