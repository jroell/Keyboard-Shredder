import { Check, LockKeyhole, MapPin, Music2, Play } from 'lucide-react';
import type { Difficulty } from '../../../shared/song';
import {
  isTourSongCleared, isTourSongUnlocked, TOUR_PASS_ACCURACY, TOUR_TRACKS, TOUR_VENUES, tourStart, type TourProgress,
} from '../../../shared/tour';
import '../../tour.css';

export default function Tour({ progress, difficulty, onDifficultyChange, onOpen, artForTrack, busy = false }: {
  progress: TourProgress;
  difficulty: Difficulty;
  onDifficultyChange: (difficulty: Difficulty) => void;
  onOpen: (trackId: string) => void;
  busy?: boolean;
  artForTrack?: (trackId: string) => string | undefined;
}) {
  const nextId = tourStart(progress);
  const next = TOUR_TRACKS.find(track => track.id === nextId);
  const heroArt = artForTrack?.(nextId ?? TOUR_TRACKS.at(-1)!.id);
  const cleared = TOUR_TRACKS.filter(track => isTourSongCleared(track.id, progress)).length;

  return (
    <section id="tour" className="panel tour" aria-labelledby="tour-heading">
      <header className="tour-hero" style={heroArt ? {
        backgroundImage: `linear-gradient(90deg, #140d1be8, #140d1b70 70%), url("${heroArt}")`,
      } : undefined}>
        <h2 id="tour-heading"><MapPin aria-hidden="true" /> Tour</h2>
        <p>Start at the switchyard, play the Skybridge Festival, and finish with a sunrise encore.</p>
      </header>
      <div className="tour-overview">
        <div>
          <strong>{cleared} of {TOUR_TRACKS.length} songs cleared</strong>
          <progress aria-label="Tour progress" value={cleared} max={TOUR_TRACKS.length} />
        </div>
        <label>
          Tour difficulty
          <select value={difficulty} onChange={event => onDifficultyChange(event.target.value as Difficulty)} disabled={busy}>
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
            <option value="hard">Hard</option>
          </select>
        </label>
      </div>
      <p>Earn {TOUR_PASS_ACCURACY}% accuracy to unlock the next song. Clear every song to move to the next venue.</p>
      {next ? (
        <div className="tour-call">
          <span>{cleared || progress[next.id] !== undefined ? 'Continue tour' : 'First show'}</span>
          <button className="primary tour-next" disabled={busy} onClick={() => onOpen(next.id)}>
            <Play size={15} aria-hidden="true" /> Play {next.title}
          </button>
        </div>
      ) : (
        <div className="tour-finale">
          <h3><Check size={18} aria-hidden="true" /> Tour complete</h3>
          <p>You made it from the switchyard to the sunrise encore. Revisit any song to improve your accuracy.</p>
        </div>
      )}
      <div className="tour-venues">
        {TOUR_VENUES.map((venue, index) => {
          const available = isTourSongUnlocked(venue.tracks[0].id, progress);
          const done = venue.tracks.every(track => isTourSongCleared(track.id, progress));
          const current = venue.tracks.some(track => track.id === nextId);
          const art = artForTrack?.(venue.tracks[0].id);
          return (
            <details key={venue.id} open={current}>
              <summary>
                <span className="tour-stop">{index + 1}</span>
                <span>{venue.name}</span>
                <span className="tour-state">
                  {!available ? <><LockKeyhole size={13} aria-hidden="true" /> Locked</>
                    : done ? <><Check size={13} aria-hidden="true" /> Cleared</> : 'Open'}
                </span>
              </summary>
              <div className={art ? 'tour-scene tour-scene-art' : 'tour-scene'}
                style={art ? { backgroundImage: `linear-gradient(90deg, #130b1bea, #130b1bae), url("${art}")` } : undefined}>
                <p>{venue.scene}</p>
                {done && <p>{venue.sendoff}</p>}
                {!available && <p>Clear every song at {TOUR_VENUES[index - 1]?.name} to play here.</p>}
              </div>
              <ol className="tour-tracks">
                {venue.tracks.map(track => {
                  const unlocked = isTourSongUnlocked(track.id, progress);
                  const accuracy = progress[track.id];
                  const passed = isTourSongCleared(track.id, progress);
                  return (
                    <li key={track.id}>
                      <Music2 size={15} aria-hidden="true" />
                      <div>
                        <strong>{track.title}</strong>
                        <small>{!unlocked ? 'Locked' : accuracy === undefined ? 'Ready'
                          : `Best ${accuracy}%${passed ? ' · Cleared' : ''}`}</small>
                      </div>
                      {unlocked && track.id !== nextId && <button type="button" disabled={busy}
                        aria-label={`Replay ${track.title}`} onClick={() => onOpen(track.id)}>Replay</button>}
                    </li>
                  );
                })}
              </ol>
            </details>
          );
        })}
      </div>
    </section>
  );
}
