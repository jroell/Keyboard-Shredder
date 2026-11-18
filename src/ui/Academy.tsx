import { useMemo, useState } from 'react';
import { Check, Dumbbell, Keyboard, LockKeyhole, Play, Star } from 'lucide-react';
import { keyLabel } from '../../shared/practice';
import { ALL_TYPING_KEYS, keyInfo, needsShift, lessonStatus, TYPING_LESSONS, weakestKeys, type LessonKind } from '../../shared/typing';
import type { Difficulty } from '../../shared/song';
import { DIFFICULTIES, difficultyNames } from '../../shared/difficulty';
import { useApp } from '../App';
import { sfx } from '../game/sfx';
import { keyStatsStore, lessonStore, saveStore, wpmStore, useCell } from '../state/store';
import { Screen } from './common';
import KeyboardGuide, { fingerName } from './KeyboardGuide';

const LETTERS = ALL_TYPING_KEYS.filter(code => /^Key[A-Z]$/.test(code));

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="muted">Finish two lessons to see your speed trend.</p>;
  const top = Math.max(...values, 10);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${40 - (value / top) * 36}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label={`Typing speed over your last ${values.length} runs, latest ${Math.round(values.at(-1)!)} words per minute`}>
    <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
  </svg>;
}

export default function Academy() {
  const app = useApp();
  const progress = useCell(lessonStore);
  const stats = useCell(keyStatsStore);
  const history = useCell(wpmStore);
  const save = useCell(saveStore);
  const [freeSong, setFreeSong] = useState('copper-moon');
  const [freeKind, setFreeKind] = useState<LessonKind>('words');
  const [freeLevel, setFreeLevel] = useState<Difficulty>('medium');
  const units = useMemo(() => [...new Set(TYPING_LESSONS.map(lesson => lesson.unit))].map(unit => ({
    unit, name: TYPING_LESSONS.find(lesson => lesson.unit === unit)!.unitName, lessons: TYPING_LESSONS.filter(lesson => lesson.unit === unit),
  })), []);
  const passed = TYPING_LESSONS.filter(lesson => lessonStatus(lesson.id, progress) === 'passed').length;
  const nextLesson = TYPING_LESSONS.find(lesson => lessonStatus(lesson.id, progress) === 'open');
  const weak = weakestKeys(stats, 4, 8).filter(code => stats[code].hits / stats[code].attempts < 0.92);
  const recent = history.slice(-12);
  const average = recent.length ? recent.reduce((total, entry) => total + entry.wpm, 0) / recent.length : 0;
  const songs = app.songs.filter(song => song.model === 'starter-setlist');

  const drill = () => {
    sfx.play('ui-select');
    const keys = [...new Set([...weak, 'KeyF', 'KeyJ', 'KeyD', 'KeyK', 'Space'])];
    void app.launch('neon-afterhours', { mode: 'typing', difficulty: 'easy', mods: [],
      typing: { options: { keys, focus: weak, kind: 'drill', difficulty: 'easy', seed: Date.now() % 100_000 } } }, { name: 'academy' });
  };
  const free = () => {
    sfx.play('ui-select');
    void app.launch(freeSong, { mode: 'typing', difficulty: freeLevel, mods: [],
      typing: { options: { keys: [...LETTERS, 'Space'], focus: weak, kind: freeKind, difficulty: freeLevel, seed: Date.now() % 100_000 } } }, { name: 'academy' });
  };

  return <Screen title="Typing academy" eyebrow={`${passed} of ${TYPING_LESSONS.length} lessons passed`} onBack={() => app.go({ name: 'menu' })} className="academy-screen">
    {typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches &&
      <p className="challenge-result lost" role="note">Typing lessons need a physical keyboard. Connect one, or open the academy on a computer.</p>}
    <div className="academy-top">
      <section className="panel academy-next">
        <p className="eyebrow">{passed ? 'Up next' : 'Start here'}</p>
        {nextLesson ? <>
          <h2>{nextLesson.title}</h2>
          <p>{nextLesson.blurb}</p>
          <div className="lesson-keys">{nextLesson.newKeys.length > 8 ? <><kbd>Shift</kbd><span>+ any letter</span></>
            : nextLesson.newKeys.map(code => <kbd key={code}>{code === 'Space' ? 'space' : needsShift(code) ? `Shift + ${keyInfo(code)?.label}` : keyLabel(code)}</kbd>)}</div>
          <button className="primary big" autoFocus onClick={() => { sfx.play('ui-select'); void app.startLesson(nextLesson); }}><Play aria-hidden="true" />Start lesson</button>
        </> : <><h2>You graduated</h2><p>Every lesson is passed. Keep your speed up with free typing on any song.</p></>}
      </section>
      <section className="panel academy-stats">
        <div className="stat-row">
          <div><strong>{Math.round(save.totals.bestWpm)}</strong><span>Best WPM</span></div>
          <div><strong>{Math.round(average)}</strong><span>Recent average</span></div>
          <div><strong>{history.length}</strong><span>Runs</span></div>
        </div>
        <Sparkline values={history.slice(-30).map(entry => entry.wpm)} />
      </section>
      <section className="panel academy-keys">
        <h2><Keyboard aria-hidden="true" size={18} /> Your keys</h2>
        <KeyboardGuide stats={stats} compact />
        {weak.length ? <>
          <p>Weakest: {weak.map(code => `${code === 'Space' ? 'Space' : keyLabel(code)} (${fingerName(code)})`).join(', ')}.</p>
          <button onClick={drill}><Dumbbell aria-hidden="true" size={16} />Drill my weak keys</button>
        </> : <p className="muted">{Object.keys(stats).length ? 'No weak keys right now. Green means solid.' : 'Play a lesson and this keyboard shows which keys need work.'}</p>}
      </section>
    </div>
    {units.map(group => <section key={group.unit} className="unit">
      <h2>Unit {group.unit}: {group.name}</h2>
      <ol className="lessons">
        {group.lessons.map(lesson => {
          const status = lessonStatus(lesson.id, progress);
          const best = progress[lesson.id];
          return <li key={lesson.id}>
            <button className={`lesson ${status}`} disabled={status === 'locked'} onClick={() => { sfx.play('ui-select'); void app.startLesson(lesson); }}
              aria-label={`${lesson.title}. ${status === 'locked' ? 'Locked' : status === 'passed' ? 'Passed' : 'Open'}`}>
              <span className="lesson-state">{status === 'locked' ? <LockKeyhole size={15} aria-hidden="true" /> : status === 'passed' ? <Check size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}</span>
              <strong>{lesson.title}</strong>
              <small>{lesson.kind === 'drill' ? 'Key drill' : lesson.kind === 'words' ? 'Words' : 'Sentences'}{best ? ` · ${Math.round(best.bestWpm)} WPM · ${Math.round(best.bestAccuracy)}%` : ''}</small>
              <span className="lesson-stars" aria-label={`${best?.stars ?? 0} of 3 stars`}>{[0, 1, 2].map(i => <Star key={i} size={13} aria-hidden="true" className={i < (best?.stars ?? 0) ? 'on' : ''} />)}</span>
            </button>
          </li>;
        })}
      </ol>
    </section>)}
    <section className="panel free-typing">
      <h2>Free typing</h2>
      <p>Type real words to any song in the setlist. Harder settings mean more letters per second.</p>
      <div className="form-row">
        <label className="field">Song<select value={freeSong} onChange={event => setFreeSong(event.target.value)}>
          {songs.map(song => <option key={song.id} value={song.id}>{song.title} · {song.genre}</option>)}</select></label>
        <label className="field">Text<select value={freeKind} onChange={event => setFreeKind(event.target.value as LessonKind)}>
          <option value="words">Common words</option><option value="sentences">Sentences</option></select></label>
        <label className="field">Speed<select value={freeLevel} onChange={event => setFreeLevel(event.target.value as Difficulty)}>
          {DIFFICULTIES.map(level => <option key={level} value={level}>{difficultyNames[level]}</option>)}</select></label>
        <button className="primary" onClick={free}><Play aria-hidden="true" size={16} />Type</button>
      </div>
    </section>
  </Screen>;
}
