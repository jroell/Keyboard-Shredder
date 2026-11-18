import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Play, Trophy } from 'lucide-react';
import { DIFFICULTIES, difficultyBlurbs, difficultyNames } from '../../shared/difficulty';
import { isRanked, MOD_IDS, MODS, modMultiplier, type ModId } from '../../shared/modifiers';
import { recordKey } from '../../shared/progression';
import { useApp } from '../App';
import { fetchBoard, type Board } from '../lib/api';
import { previewSong, stopPreview } from '../lib/preview';
import { stageArt } from '../lib/stage-art';
import { sfx } from '../game/sfx';
import { saveStore, settingsStore, useCell } from '../state/store';
import { formatLength, Screen, Stars, useMenuKeys } from './common';
import fallbackArt from '../assets/concert-stage.webp';

export default function SongSelect() {
  const app = useApp();
  const save = useCell(saveStore);
  const settings = useCell(settingsStore);
  const [genre, setGenre] = useState('All');
  const [index, setIndex] = useState(0);
  const [mods, setMods] = useState<ModId[]>([]);
  const [board, setBoard] = useState<Board>();
  const list = useRef<HTMLUListElement>(null);
  const difficulty = settings.difficulty;
  const genres = useMemo(() => ['All', ...new Set(app.songs.map(song => song.genre || 'My tracks'))], [app.songs]);
  const songs = useMemo(() => app.songs.filter(song => genre === 'All' || (song.genre || 'My tracks') === genre), [app.songs, genre]);
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
    void app.launch(song.id, { mode: 'quickplay', difficulty, mods }, { name: 'songs' });
  };
  useMenuKeys({ count: songs.length, index, setIndex, onPick: play, onSide: setDifficulty });

  useEffect(() => { setIndex(0); }, [genre]);
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

  const art = song ? stageArt(song.id) ?? fallbackArt : fallbackArt;
  return <Screen title="Quick play" eyebrow="Choose your song" onBack={() => { stopPreview(); app.go({ name: 'menu' }); }} className="songs-screen">
    <div className="songs-backdrop" key={art} style={{ backgroundImage: `url("${art}")` }} aria-hidden="true" />
    <div className="chips" role="tablist" aria-label="Genre">
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
              : <span className="song-best new">New</span>}
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
        <button className="primary big play-song" onClick={play} style={{ '--pulse': '1' } as CSSProperties}><Play aria-hidden="true" />Play</button>
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
