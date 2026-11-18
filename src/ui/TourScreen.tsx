import { Check, LockKeyhole, Play, Users } from 'lucide-react';
import { DIFFICULTIES, difficultyNames } from '../../shared/difficulty';
import { recordKey } from '../../shared/progression';
import { isTourSongCleared, isTourSongUnlocked, TOUR_PASS_ACCURACY, TOUR_TRACKS, TOUR_VENUES, tourStart } from '../../shared/tour';
import type { Difficulty } from '../../shared/song';
import { useApp } from '../App';
import { stageArt } from '../lib/stage-art';
import { sfx } from '../game/sfx';
import { saveStore, setStore, settingsStore, tourStore, useCell } from '../state/store';
import { Disc3 } from 'lucide-react';
import { Screen, Stars } from './common';

export default function TourScreen() {
  const app = useApp();
  const progress = useCell(tourStore);
  const settings = useCell(settingsStore);
  const save = useCell(saveStore);
  const sets = useCell(setStore);
  const headline = (name: string, ids: string[]) => {
    sfx.play('ui-select');
    void app.launch(ids[0], { mode: 'tour', difficulty: settings.difficulty, mods: [], tour: true, set: { name, ids, index: 0, score: 0, ratings: [] } }, { name: 'tour' });
  };
  const nextId = tourStart(progress);
  const next = TOUR_TRACKS.find(track => track.id === nextId);
  const cleared = TOUR_TRACKS.filter(track => isTourSongCleared(track.id, progress)).length;
  const open = (id: string) => {
    if (!isTourSongUnlocked(id, progress)) { sfx.play('ui-error'); return; }
    sfx.play('ui-select');
    void app.launch(id, { mode: 'tour', difficulty: settings.difficulty, mods: [], tour: true }, { name: 'tour' });
  };
  return <Screen title="World tour" eyebrow={`${cleared} of ${TOUR_TRACKS.length} songs cleared`} onBack={() => app.go({ name: 'menu' })} className="tour-screen"
    actions={<>
      <label className="inline-field">Difficulty<select value={settings.difficulty}
        onChange={event => settingsStore.set(previous => ({ ...previous, difficulty: event.target.value as Difficulty }))}>
        {DIFFICULTIES.map(level => <option key={level} value={level}>{difficultyNames[level]}</option>)}</select></label>
      <button onClick={() => app.go({ name: 'online', invite: '', coop: true })}><Users aria-hidden="true" size={16} />Tour with a friend</button>
    </>}>
    <div className="tour-progress"><i style={{ width: `${100 * cleared / TOUR_TRACKS.length}%` }} /></div>
    {next ? <div className="tour-next">
      <div><p className="eyebrow">{cleared ? 'Next show' : 'First show'}</p><h2>{next.title}</h2>
        <p>Hit {TOUR_PASS_ACCURACY}% of the notes to clear a song. Clear every song to move to the next venue.</p></div>
      <button className="primary big" autoFocus onClick={() => open(next.id)}><Play aria-hidden="true" />Play {next.title}</button>
    </div> : <div className="tour-next done">
      <div><p className="eyebrow">Tour complete</p><h2>The whole city is listening</h2><p>You made it from the workshop to the sunrise encore. Replay any show to chase more stars.</p></div>
    </div>}
    <ol className="venues">
      {TOUR_VENUES.map((venue, index) => {
        const available = isTourSongUnlocked(venue.tracks[0].id, progress);
        const done = venue.tracks.every(track => isTourSongCleared(track.id, progress));
        const art = stageArt(venue.tracks[0].id);
        const best = sets[`${venue.name}:${settings.difficulty}`];
        return <li key={venue.id} className={`venue${available ? '' : ' locked'}${done ? ' done' : ''}`}>
          <div className="venue-art" style={art ? { backgroundImage: `url("${art}")` } : undefined}>
            <span className="venue-stop">{index + 1}</span>
            <h3>{venue.name}</h3>
            <span className="venue-state">{!available ? <><LockKeyhole size={13} aria-hidden="true" /> Locked</> : done ? <><Check size={13} aria-hidden="true" /> Cleared</> : 'Open'}</span>
          </div>
          <p className="venue-scene">{available ? done ? venue.sendoff : venue.scene : `Clear every song at ${TOUR_VENUES[index - 1]?.name} to play here.`}</p>
          <ul className="venue-tracks">
            {venue.tracks.map(track => {
              const unlocked = isTourSongUnlocked(track.id, progress);
              const passed = isTourSongCleared(track.id, progress);
              const record = save.records[recordKey(track.id, settings.difficulty)];
              return <li key={track.id}>
                <button disabled={!unlocked} className={track.id === nextId ? 'current' : ''} onClick={() => open(track.id)}
                  aria-label={`${unlocked ? 'Play' : 'Locked:'} ${track.title}`}>
                  {unlocked ? passed ? <Check size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}
                  <span>{track.title}</span>
                  {record ? <Stars count={record.stars} size={11} /> : passed ? <small>{progress[track.id]}%</small> : null}
                </button>
              </li>;
            })}
          </ul>
          {venue.tracks.length > 1 && <div className="venue-set">
            <button disabled={!done} onClick={() => headline(venue.name, venue.tracks.map(track => track.id))}
              title={done ? 'Play every song here back to back for one score' : 'Clear every song here to unlock the headline set'}>
              <Disc3 size={15} aria-hidden="true" />Headline set</button>
            {best ? <span className={best.platinum ? 'gold platinum' : best.rating >= 80 ? 'gold' : ''}>{best.platinum ? 'Platinum record · ' : best.rating >= 80 ? 'Gold record · ' : ''}{best.score.toLocaleString()} on {difficultyNames[settings.difficulty]}</span>
              : <span>{done ? `${venue.tracks.length} songs, one score. A record for each difficulty.` : 'Clear the venue to unlock'}</span>}
            {best && <small className="venue-set-note">{best.rating.toFixed(1)}% average timing
              {best.platinum ? '' : best.rating >= 80 ? ' · platinum needs 85% on every song' : ` · ${(80 - best.rating).toFixed(1)} short of gold`}</small>}
          </div>}
        </li>;
      })}
    </ol>
  </Screen>;
}
