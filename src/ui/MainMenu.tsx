import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Globe, GraduationCap, Guitar, MapPin, Music2, Play, Settings, Shirt, Trophy, Users } from 'lucide-react';
import { difficultyNames } from '../../shared/difficulty';
import { MODS } from '../../shared/modifiers';
import { isTourSongCleared, TOUR_TRACKS } from '../../shared/tour';
import { lessonStatus, TYPING_LESSONS } from '../../shared/typing';
import { useApp, type Route } from '../App';
import { fetchDaily, type Daily } from '../lib/api';
import { stageArt } from '../lib/stage-art';
import { sfx } from '../game/sfx';
import { currentPlayer, lessonStore, listPlayers, saveStore, settingsStore, switchPlayer, tourStore, useCell } from '../state/store';
import { PlayerChip, useMenuKeys } from './common';
import cover from '../assets/arcade-cover.webp';
import band from '../assets/warehouse-band.webp';
import stage from '../assets/concert-stage.webp';

export default function MainMenu() {
  const app = useApp();
  const save = useCell(saveStore);
  const tour = useCell(tourStore);
  const lessons = useCell(lessonStore);
  // A player who came to learn typing lands on the academy until the first lesson is passed.
  const learner = (() => { try { return localStorage.getItem(`ks:learner:${currentPlayer}`) === '1'; } catch { return false; } })();
  const [index, setIndex] = useState(() => learner && TYPING_LESSONS.every(lesson => lessonStatus(lesson.id, lessonStore.get()) !== 'passed') ? 2 : 0);
  const [switching, setSwitching] = useState(false);
  const [daily, setDaily] = useState<Daily>();
  const [welcome, setWelcome] = useState(!save.seenTutorial && !save.name);
  const [name, setName] = useState(save.name);
  const tourCleared = TOUR_TRACKS.filter(track => isTourSongCleared(track.id, tour)).length;
  const nextTourId = TOUR_TRACKS.find(track => !isTourSongCleared(track.id, tour))?.id;
  const nextTour = app.songs.find(song => song.id === nextTourId)?.title;
  const lessonsPassed = TYPING_LESSONS.filter(lesson => lessonStatus(lesson.id, lessons) === 'passed').length;
  const starTotal = Object.values(save.records).reduce((total, record) => total + Math.min(5, record.stars), 0);

  useEffect(() => {
    if (!app.config) return;
    let active = true;
    fetchDaily().then(value => { if (active) setDaily(value); }).catch(() => {});
    return () => { active = false; };
  }, [app.config, app.user]);

  const dailyDone = daily ? save.daily[daily.dateKey] : undefined;
  const playDaily = () => {
    if (!daily) return;
    void app.launch(daily.songId, { mode: 'daily', difficulty: daily.difficulty, mods: daily.mods, daily: daily.dateKey }, { name: 'menu' });
  };

  const items = useMemo(() => {
    const go = (route: Route) => () => app.go(route);
    return [
      { id: 'songs', label: 'Quick play', icon: Play, blurb: 'Pick a song, pick a difficulty, chase five stars.', detail: `${app.songs.length || 37} songs · ${starTotal} stars earned`, art: cover, run: go({ name: 'songs' }) },
      { id: 'tour', label: 'World tour', icon: MapPin, blurb: 'Start in a workshop. End on the festival main stage.', detail: `${tourCleared} of ${TOUR_TRACKS.length} songs cleared${nextTour ? ` · next up: ${nextTour}` : ''}`, art: stageArt('voltage-parade') ?? stage, run: go({ name: 'tour' }) },
      { id: 'academy', label: 'Typing academy', icon: GraduationCap, blurb: 'Learn touch typing one key at a time, to real music.', detail: `${lessonsPassed} of ${TYPING_LESSONS.length} lessons passed${save.totals.bestWpm ? ` · best ${Math.round(save.totals.bestWpm)} WPM` : ''}`, art: stageArt('paper-antenna') ?? stage, run: go({ name: 'academy' }) },
      { id: 'party', label: 'Party mode', icon: Users, blurb: 'Two players, one keyboard. Battle or team up.', detail: 'Or battle the computer on your own', art: band, run: go({ name: 'party' }) },
      { id: 'online', label: 'Play online', icon: Globe, blurb: 'Send a link. Duel a friend or tour together.', detail: app.profile ? `${app.profile.wins} wins · ${app.profile.played} duels` : 'Head-to-head or co-op', art: stageArt('neon-afterhours') ?? stage, run: go({ name: 'online', invite: '', coop: false }) },
      { id: 'daily', label: 'Daily challenge', icon: CalendarDays, blurb: daily ? `${daily.title} on ${difficultyNames[daily.difficulty]}${daily.mods.length ? ` with ${daily.mods.map(id => MODS[id].name).join(' and ')}` : ''}.` : 'One song, one shot at the daily board.', detail: dailyDone ? `Your best today: ${dailyDone.score.toLocaleString()}. Play again to beat it before the day ends.` : `${daily?.total ?? 0} players on the board today`, art: daily ? stageArt(daily.songId) ?? stage : stage, run: playDaily },
      { id: 'locker', label: 'Locker', icon: Shirt, blurb: 'Necks, gems, hit effects, achievements and stats.', detail: `${Object.keys(save.achievements).length} achievements`, art: stageArt('mirrorball-static') ?? stage, run: go({ name: 'locker' }) },
      ...(app.config?.musicEnabled ? [{ id: 'create', label: 'Create a track', icon: Music2, blurb: 'Describe any style of music. Play it a minute later.', detail: app.user || app.config.localTest ? 'Any genre you can describe' : 'Sign in to compose', art: stageArt('glass-circuit') ?? stage, run: go({ name: 'create' }) }] : []),
      { id: 'settings', label: 'Settings', icon: Settings, blurb: 'Keys, note speed, timing, sound and your account.', detail: '', art: stageArt('arc-lights') ?? stage, run: go({ name: 'settings' }) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.songs.length, app.config, app.user, app.profile, daily, dailyDone, tourCleared, nextTour, lessonsPassed, starTotal, save.achievements, save.totals.bestWpm]);

  useMenuKeys({ count: items.length, index, setIndex, enabled: !welcome && !switching, onPick: picked => { sfx.play('ui-select'); items[picked].run(); } });
  const current = items[Math.min(index, items.length - 1)];

  const finishWelcome = (tutorial: boolean) => (event?: FormEvent) => {
    event?.preventDefault();
    const clean = name.trim().slice(0, 24) || 'Shredder';
    saveStore.set(previous => ({ ...previous, name: clean, seenTutorial: true }));
    if (app.profile) void app.saveProfile({ ...app.profile, name: clean }).catch(() => {});
    setWelcome(false);
    sfx.play('ui-select');
    if (tutorial) void app.launch('river-amp', { mode: 'tutorial', difficulty: 'beginner', mods: [], tutorial: true }, { name: 'menu' });
  };

  return <main className="menu-screen" style={{ '--art': `url("${current.art}")` } as React.CSSProperties}>
    <div className="menu-art" key={current.id} aria-hidden="true" />
    <header className="menu-head">
      <div className="brand"><Guitar aria-hidden="true" /><span>Keyboard Shredder</span></div>
      <div className="menu-player">
        <button className="ghost" aria-expanded={switching} onClick={() => setSwitching(open => !open)}>Switch player</button>
        {switching && <div className="player-menu" role="menu" aria-label="Players on this device">
          {listPlayers().map(player => <button key={player.id} role="menuitem" disabled={player.id === currentPlayer} onClick={() => switchPlayer(player.id)}>
            <span className="chip-level">{player.level}</span><strong>{player.name}</strong>
            <em>{player.id === currentPlayer ? 'Playing now' : player.bestWpm ? `best ${player.bestWpm} WPM` : 'no typing yet'}</em></button>)}
          <button role="menuitem" onClick={() => { try { sessionStorage.setItem('ks:lockerTab', 'Profile'); } catch { /* optional */ } app.go({ name: 'locker' }); }}>Add or manage players</button>
        </div>}
        <PlayerChip onClick={() => app.go({ name: 'locker' })} />
      </div>
    </header>
    <nav className="menu-list" aria-label="Main menu">
      {items.map((item, itemIndex) => <button key={item.id} className={itemIndex === index ? 'active' : ''}
        onMouseEnter={() => { if (itemIndex !== index) { setIndex(itemIndex); sfx.play('ui-move'); } }} onFocus={() => setIndex(itemIndex)}
        onClick={() => { sfx.play('ui-select'); item.run(); }}>
        <item.icon aria-hidden="true" size={22} /><span>{item.label}</span>
        {item.id === 'daily' && !dailyDone && daily && <em>New</em>}
      </button>)}
    </nav>
    <aside className="menu-preview" aria-live="polite">
      <p className="eyebrow">{current.label}</p>
      <h2>{current.blurb}</h2>
      {current.detail && <p>{current.detail}</p>}
      {current.id === 'daily' && daily && daily.entries.length > 0 && <ol className="mini-board">
        {daily.entries.slice(0, 5).map(entry => <li key={entry.rank + entry.name} className={entry.you ? 'you' : ''}>
          <span>{entry.rank}</span><strong>{entry.name}</strong><em>{entry.score.toLocaleString()}</em></li>)}
      </ol>}
      {save.streak.days > 0 && current.id === 'songs' && <p className="streak-line"><Trophy aria-hidden="true" size={16} /> {save.streak.days} day streak · best {save.streak.best}</p>}
    </aside>
    <footer className="menu-foot"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> play</footer>

    {welcome && <div className="modal-veil">
      <form className="modal welcome" onSubmit={finishWelcome(true)} role="dialog" aria-labelledby="welcome-title">
        <p className="eyebrow">Welcome to the band</p>
        <h2 id="welcome-title">What should the crowd call you?</h2>
        <label className="field">Stage name<input autoFocus maxLength={24} value={name} placeholder="Shredder" onChange={event => setName(event.target.value)} /></label>
        <p>The warm-up takes half a minute and shows you how to play. You can skip it and jump straight in.</p>
        <div className="modal-actions">
          <button type="submit" className="primary big">Play the warm-up</button>
          <button type="button" onClick={() => {
            try { localStorage.setItem(`ks:learner:${currentPlayer}`, '1'); } catch { /* optional */ }
            // A new typist who later tries a song should start on the gentlest chart.
            settingsStore.set(previous => ({ ...previous, difficulty: 'beginner' }));
            finishWelcome(false)(); app.go({ name: 'academy' });
          }}>I am here to learn typing</button>
          <button type="button" onClick={() => finishWelcome(false)()}>Skip to the menu</button>
        </div>
      </form>
    </div>}
  </main>;
}
