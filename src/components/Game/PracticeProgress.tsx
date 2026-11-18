import { useState } from 'react';
import { combineTallies, hitRate, practiceRows, rateChange, practiceWindows, type PracticeRun } from '../../../shared/practice-progress';
import { keyLabel } from '../../../shared/practice';
import { difficultyNames } from '../../../shared/difficulty';
import type { Difficulty } from '../../../shared/song';

const labels = (name: string) => name.split('+').map(keyLabel).join(' + ');
const formatChange = (change: number) => `${change > 0 ? '+' : ''}${change} pp`;

export default function PracticeProgress({ history }: { history: PracticeRun[] }) {
  const [group, setGroup] = useState<'keys' | 'chords'>('keys');
  const [difficulty, setDifficulty] = useState<Difficulty | 'latest'>('latest');
  const [layout, setLayout] = useState('');
  if (!history.length) return <p>Finish a solo track with practice keys to start tracking your progress.</p>;

  const selected = difficulty === 'latest' ? history[0].difficulty : difficulty;
  const layouts = [...new Set(history.map(run => run.layout))];
  const runs = history.filter(run => run.difficulty === selected && (!layout || run.layout === layout));
  const windows = practiceWindows(runs);
  const recent = combineTallies(windows.recent.map(run => run.notes));
  const prior = combineTallies(windows.previous.map(run => run.notes));
  const rows = practiceRows(windows.recent, windows.previous, group);
  const focus = rows.find(row => row.attempts >= 3 && row.hits < row.attempts);
  const strength = rows.filter(row => row !== focus && row.attempts >= 3 && hitRate(row) >= 80).at(-1);
  return <div className="practice-progress">
    <p>Saved in this browser. Compare up to five recent runs with the same number of earlier runs at the chosen difficulty.</p>
    <div className="practice-progress-controls">
      <label>Practice difficulty<select value={selected} onChange={event => setDifficulty(event.target.value as Difficulty)}>
        {Object.entries(difficultyNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      <label>Practice layout history<select value={layout} onChange={event => setLayout(event.target.value)}>
        <option value="">All layouts</option>
        {layouts.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label>Show<select value={group} onChange={event => setGroup(event.target.value as 'keys' | 'chords')}>
        <option value="keys">Keys</option><option value="chords">Chords</option>
      </select></label>
    </div>
    {!runs.length ? <p>No completed runs match these filters yet.</p> : <>
      <p><strong>{hitRate(recent)}% of notes hit</strong> in {windows.recent.length} recent {windows.recent.length === 1 ? 'run' : 'runs'}
        {prior.attempts > 0 && <> · {formatChange(rateChange(recent, prior))} versus earlier runs</>}</p>
      {focus && <p>Practice next <strong>{labels(focus.name)}</strong></p>}
      {strength && <p>Reliable <strong>{labels(strength.name)}</strong></p>}
      {rows.length ? <>
        <p>{group === 'keys' ? 'Key results use single notes. View Chords for combinations.' : 'A chord counts as a hit when every key lands together.'}
          {' '}Timing shows the average distance from the note’s target time on hits. pp means percentage points.</p>
        <ul className="practice-stat-list" aria-label={group === 'keys' ? 'Key accuracy' : 'Chord accuracy'}>
          {rows.map(row => <li key={row.name}>
            <strong>{labels(row.name)}</strong>
            <span>{hitRate(row)}% · {row.hits}/{row.attempts}</span>
            <span>{row.hits ? `${Math.round(row.timingTotal / row.hits)} ms` : 'No hits'}{row.change !== null && ` · ${formatChange(row.change)}`}</span>
          </li>)}
        </ul>
      </> : <p>{group === 'chords' ? 'No chords appeared in these runs. Try a denser chart.' : 'No single notes appeared in these runs.'}</p>}
      <details>
        <summary>Recent runs ({runs.length})</summary>
        <ul className="practice-stat-list" aria-label="Recent practice runs">
          {runs.map((run, index) => <li key={`${run.playedAt}-${index}`}>
            <strong>{run.title}</strong><span>{run.layout} · {hitRate(run.notes)}%</span>
            <time dateTime={new Date(run.playedAt).toISOString()}>{new Date(run.playedAt).toLocaleDateString()}</time>
          </li>)}
        </ul>
      </details>
    </>}
  </div>;
}
