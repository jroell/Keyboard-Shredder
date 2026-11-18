import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Award, ChevronRight, Crown, RotateCcw, Share2, Star, Trophy, Unlock, Users } from 'lucide-react';
import { difficultyNames } from '../../shared/difficulty';
import { MODS, finalScore, isRanked } from '../../shared/modifiers';
import { levelFor } from '../../shared/progression';
import { STAR_RATINGS, starsFor } from '../../shared/rating';
import { sectionNames } from '../../shared/sections';
import { TOUR_TRACKS } from '../../shared/tour';
import { keyLabel } from '../../shared/practice';
import { weakestKeys } from '../../shared/typing';
import type { Recording } from '../lib/recording';
import { fetchBoard, submitScore, type Board, type Submitted } from '../lib/api';
import { sfx } from '../game/sfx';
import { saveStore, settingsStore, useCell } from '../state/store';
import { songCleared, useApp } from '../App';
import { clock, SECTIONS, type RunResult, type RunSetup } from './GameScreen';
import KeyboardGuide, { fingerName } from './KeyboardGuide';
import confetti from 'canvas-confetti';

type Props = {
  recording: Recording; setup: RunSetup; result: RunResult; bot: boolean;
  onReplay: () => void; onExit: () => void; exitLabel: string;
  next?: { label: string; run: () => void };
  /** Opens a section of this song in practice mode. */
  onPractice?: (practice: { startMs: number; endMs: number; rate: number }) => void;
};

function useCountUp(target: number, delay: number, duration = 1100) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    let ticks = 0;
    const begin = performance.now() + delay;
    const step = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - begin) / duration));
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress > 0 && progress < 1 && ticks++ % 3 === 0) sfx.play('score-tick');
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, delay, duration]);
  return value;
}

const songTitles: Record<string, string> = Object.fromEntries(TOUR_TRACKS.map(track => [track.id, track.title]));

export function challengeLink(songId: string, difficulty: string, score: number, name: string, mods: string[]) {
  const link = new URL(location.origin + location.pathname);
  link.searchParams.set('c', [songId, difficulty, score, name.slice(0, 24) || 'A friend', mods.join('+')].join('~'));
  return link.href;
}

/** How early or late each hit landed, so a player can see whether to press sooner or later. */
function TimingChart({ offsets, windowMs }: { offsets: number[]; windowMs: number }) {
  const bins = 21;
  const counts = Array.from({ length: bins }, () => 0);
  for (const offset of offsets) {
    const index = Math.round((Math.max(-windowMs, Math.min(windowMs, offset)) / windowMs + 1) / 2 * (bins - 1));
    counts[index]++;
  }
  const top = Math.max(...counts, 1);
  const mean = offsets.reduce((total, value) => total + value, 0) / offsets.length;
  const spread = Math.sqrt(offsets.reduce((total, value) => total + (value - mean) ** 2, 0) / offsets.length);
  const summary = Math.abs(mean) < 8 ? 'right on the beat' : `${Math.abs(Math.round(mean))} ms ${mean < 0 ? 'early' : 'late'} on average`;
  return <figure className="timing-chart">
    <figcaption><strong>Timing</strong> You were {summary}, give or take {Math.round(spread)} ms.</figcaption>
    <div className="timing-bars" role="img" aria-label={`Hit timing spread. ${summary}.`}>
      {counts.map((count, index) => {
        const centre = Math.abs(index - (bins - 1) / 2) / ((bins - 1) / 2) * windowMs;
        return <i key={index} data-tone={centre <= 45 ? 'perfect' : centre <= 80 ? 'great' : 'good'} style={{ height: `${Math.max(3, 100 * count / top)}%` }} />;
      })}
    </div>
    <div className="timing-axis" aria-hidden="true"><span>Early</span><span>On the beat</span><span>Late</span></div>
  </figure>;
}

/** The song cut into sections, colored by how many notes landed, with one click to practice a weak one. */
function Timeline({ result, durationMs, names, onPractice }: { result: RunResult; durationMs: number; names: string[]; onPractice: NonNullable<Props['onPractice']> }) {
  const size = durationMs / SECTIONS;
  const scoring = result.scorings[0];
  const sections = Array.from({ length: SECTIONS }, (_, index) => {
    const events = result.events.filter(event => event.timeMs >= index * size && event.timeMs < (index + 1) * size);
    const judged = events.filter(event => scoring.consumed.has(event.id));
    const hits = judged.filter(event => scoring.hitOffsets.has(event.id)).length;
    const slips = result.troubles.filter(item => item.kind !== 'miss' && item.timeMs >= index * size && item.timeMs < (index + 1) * size).length;
    return { total: events.length, judged: judged.length, hits, slips };
  });
  // The costliest moments: a broken streak first, then anything else, a few seconds apart.
  const spots = [...result.troubles].sort((a, b) => b.streak - a.streak || a.timeMs - b.timeMs)
    .filter((item, index, all) => all.findIndex(other => Math.abs(other.timeMs - item.timeMs) < 4000) === index).slice(0, 4).sort((a, b) => a.timeMs - b.timeMs);
  const label = { miss: 'missed note', stray: 'stray press', drop: 'hold let go early' };
  // Missed notes and slips both cost points, so the weakest section is the one with the most of either.
  const cost = (section: typeof sections[number]) => section.judged - section.hits + section.slips;
  const weakest = sections.reduce((worst, section, index) => cost(section) > cost(sections[worst]) ? index : worst, 0);
  const clean = sections.every(section => section.hits === section.judged && !section.slips);
  return <figure className="timeline">
    <figcaption><strong>Song map</strong> {clean ? 'No section gave you trouble.' : `${sections.every(section => cost(section) === cost(sections[0])) ? 'Every section cost you about the same.' : `The ${names[weakest]} (section ${weakest + 1}) cost you the most.`} `}
      {!clean && <><span className="keyboard-only">Click</span><span className="touch-only">Tap</span> any section to loop it slowly.</>}</figcaption>
    <div className="timeline-row">
      {sections.map((section, index) => {
        const rate = section.judged ? section.hits / section.judged : null;
        return <button key={index} type="button" data-tone={rate === null ? 'none' : rate >= 0.95 && !section.slips ? 'clean' : rate >= 0.75 ? 'ok' : 'rough'}
          title={section.judged ? `${names[index]}: ${section.hits} of ${section.judged} notes hit` : `${names[index]}: not reached`}
          aria-label={`Practice section ${index + 1}, ${names[index]}${section.judged ? `, ${section.hits} of ${section.judged} notes hit` : ''}`}
          onClick={() => onPractice({ startMs: Math.round(index * size), endMs: Math.round((index + 1) * size), rate: 0.75 })}>
          <b>{index + 1}</b><em>{names[index]}</em><small>{section.judged ? `${section.hits}/${section.judged}${section.slips ? ` +${section.slips}` : ''}` : '·'}</small>
        </button>;
      })}
    </div>
    {spots.length > 0 && <div className="trouble-spots">
      <span>Loop the exact spot:</span>
      {spots.map(spot => <button key={spot.timeMs} type="button" title="Loops six seconds around this moment at 75% speed"
        onClick={() => onPractice({ startMs: Math.max(0, Math.round(spot.timeMs - 3000)), endMs: Math.min(durationMs, Math.round(spot.timeMs + 3000)), rate: 0.75 })}>
        {clock(spot.timeMs)} {names[Math.min(names.length - 1, Math.floor(spot.timeMs / size))]}: {label[spot.kind]}{spot.streak >= 10 ? ` (ended a ${spot.streak} streak)` : ''}</button>)}
    </div>}
    <p className="timeline-key">Each box shows notes hit out of notes in that section. A plus counts stray presses and holds let go early.</p>
  </figure>;
}

export default function Results({ recording, setup, result, bot, onReplay, onExit, exitLabel, next, onPractice }: Props) {
  const { song } = recording;
  const { summary, outcome, scorings } = result;
  const app = useApp();
  const save = useCell(saveStore);
  const settings = useCell(settingsStore);
  const [board, setBoard] = useState<Board>();
  const [submitted, setSubmitted] = useState<Submitted>();
  const [shareStatus, setShareStatus] = useState('');
  const [postError, setPostError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [offsetApplied, setOffsetApplied] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const party = setup.party;
  const typing = !!result.typing;
  const failed = summary.failed;
  // The last song of a finished headline set shows the whole set: its total, and stars and grade from the average rating.
  const setDone = !!setup.set && !failed && songCleared(summary) && setup.set.index + 1 === setup.set.ids.length;
  const setAverage = setup.set ? [...setup.set.ratings, summary.rating].reduce((total, value) => total + value, 0) / (setup.set.ratings.length + 1) : 0;
  // A lesson is graded on its own three-star scale.
  const drillStars = (result.typingAccuracy ?? 0) >= 97 ? 3 : (result.typingAccuracy ?? 0) >= 92 ? 2 : (result.typingAccuracy ?? 0) >= 80 ? 1 : 0;
  const starSlots = typing ? 3 : 5;
  const stars = outcome.lesson ? outcome.lesson.stars : typing ? (failed ? 0 : drillStars)
    : party?.coop ? Math.min(5, Math.round((starsFor(scorings[0].tally) + starsFor(scorings[1].tally)) / 2))
    : setDone ? STAR_RATINGS.filter(threshold => setAverage >= threshold).length : summary.stars;
  const shownScore = useCountUp(party?.coop ? finalScore(scorings[0].score + scorings[1].score, setup.mods) : setDone ? setup.set!.score + summary.score : summary.score, 900);
  const before = useMemo(() => levelFor(outcome.save.xp - outcome.xp.total), [outcome]);
  const after = useMemo(() => levelFor(outcome.save.xp), [outcome]);
  const leveled = after.level > before.level;
  const [xpShown, setXpShown] = useState(before.progress);
  const rankable = !bot && !failed && !typing && !party && isRanked(setup.mods) && song.model === 'starter-setlist' && scorings[0].hits > 0 &&
    ['quickplay', 'tour', 'daily', 'challenge'].includes(setup.mode);
  const ranked = rankable && !result.paused;

  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
    document.querySelector('.results-layer')?.scrollTo(0, 0);
    document.querySelector('.stage')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, run: () => void) => timers.push(setTimeout(run, ms));
    if (!failed) {
      for (let index = 0; index < Math.min(starSlots, stars); index++) later(350 + index * 190, () => sfx.play('star', { pitch: index * 2 }));
      if (stars === 6) later(350 + 5 * 190, () => sfx.play('star-gold'));
    }
    later(2050, () => sfx.play('grade-stamp'));
    if (outcome.newBest && !failed && !outcome.firstClear) later(2300, () => sfx.play('new-record'));
    later(2500, () => setXpShown(leveled ? 1 : after.progress));
    if (leveled) {
      later(3300, () => {
        sfx.play('level-up');
        setXpShown(after.progress);
        if (!settings.calm) void confetti({ particleCount: 140, spread: 100, origin: { y: 0.65 }, disableForReducedMotion: true });
      });
    }
    outcome.achievements.forEach((_, index) => later(3000 + index * 450, () => sfx.play('achievement')));
    if (outcome.unlocked.length) later(3700, () => sfx.play('unlock'));
    if (!failed && (summary.fullCombo || summary.stars >= 5) && !settings.calm) {
      later(600, () => void confetti({ particleCount: 90, spread: 80, origin: { y: 0.3 }, disableForReducedMotion: true }));
    }
    return () => timers.forEach(clearTimeout);
    // The sequence plays once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  useEffect(() => {
    if (!ranked) return;
    let active = true;
    setPostError('');
    submitScore({ songId: song.id, difficulty: setup.difficulty, mods: setup.mods, daily: setup.daily }, result.log)
      .then(reply => { if (active) setSubmitted(reply); })
      .catch(reason => { if (active) setPostError(reason instanceof Error ? reason.message : 'Could not post your score.'); })
      .then(() => fetchBoard(song.id, setup.difficulty, setup.mods))
      .then(next => { if (active) setBoard(next); })
      .catch(() => { if (active) setPostError(previous => previous || 'Could not load the leaderboard.'); });
    return () => { active = false; };
  }, [ranked, result, song.id, setup, attempt]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.repeat || event.target instanceof HTMLInputElement) return;
      if (event.code === 'KeyR') { event.preventDefault(); if (setup.set && (failed || !songCleared(summary) || setDone)) next?.run(); else onReplay(); }
      else if (event.code === 'Escape') { event.preventDefault(); onExit(); }
      else if (event.code === 'KeyN' && next) { event.preventDefault(); next.run(); }
      else if (event.code === 'Enter' && !(event.target instanceof HTMLElement)) { event.preventDefault(); primary.current?.click(); }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [onReplay, onExit, next]);

  const share = () => {
    const link = challengeLink(song.id, setup.difficulty, summary.score, save.name, setup.mods);
    const text = `I scored ${summary.score.toLocaleString()} on ${song.title} (${difficultyNames[setup.difficulty]}) in Keyboard Shredder. Beat it:`;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      void navigator.share({ title: 'Keyboard Shredder', text, url: link }).catch(() => {});
      return;
    }
    if (!navigator.clipboard) { setShareStatus(link); return; }
    void navigator.clipboard.writeText(`${text} ${link}`).then(() => setShareStatus('Challenge link copied. Send it to a friend.'))
      .catch(() => setShareStatus(link));
  };

  // With different difficulties a battle is decided on timing rating, so both players have a fair shot.
  const fairParty = !!party?.difficulties && party.difficulties[0] !== party.difficulties[1] && !party.coop;
  const partyValue = (index: number) => fairParty ? scorings[index].rating : scorings[index].score;
  const title = failed ? (setup.mods.includes('sudden') ? 'Sudden death' : 'Booed off stage')
    : party ? (party.coop ? 'Set complete' : partyValue(0) === partyValue(1) ? 'Dead heat' : `${party.names[partyValue(0) > partyValue(1) ? 0 : 1]} wins!`)
    : outcome.lesson ? (outcome.lesson.passed ? 'Lesson passed' : 'Keep practicing')
    : typing ? (drillStars > 0 ? 'Drill complete' : 'Keep practicing')
    : setup.set && !failed && !songCleared(summary) ? 'Set over'
    : setup.set && !failed ? (setup.set.index + 1 < setup.set.ids.length ? `Song ${setup.set.index + 1} of ${setup.set.ids.length} cleared` : 'Headline set complete')
    : summary.fullCombo ? 'Full combo!' : summary.stars >= 5 ? 'Standing ovation' : summary.stars >= 3 ? 'Song cleared' : 'Rough night';
  const challenge = setup.challenge;
  const beat = challenge && !failed && summary.score > challenge.score;
  const weak = result.keyStats ? weakestKeys(result.keyStats, 3, 3).filter(code => {
    const stat = result.keyStats![code];
    return stat.hits / stat.attempts < 0.9;
  }) : [];
  const offset = result.hitOffsetMs;
  const suggestOffset = offset !== null && Math.abs(offset) >= 22 && !typing && !bot && !party;

  return <div className="results-layer" data-failed={failed ? 'true' : undefined}>
    <section className="results" aria-labelledby="results-title">
      <header>
        <p className="eyebrow">{song.title} · {typing ? setup.typing?.lesson?.title ?? 'Free typing' : party?.difficulties && party.difficulties[0] !== party.difficulties[1] ? `${difficultyNames[party.difficulties[0]]} vs ${difficultyNames[party.difficulties[1]]}` : difficultyNames[setup.difficulty]}
          {setup.mods.map(id => ` · ${MODS[id].name}`)}</p>
        <h1 id="results-title">{title}</h1>
      </header>

      {party ? <div className="party-results">
        {scorings.map((scoring, index) => {
          const winner = !party.coop && partyValue(0) !== partyValue(1) && partyValue(index) === Math.max(partyValue(0), partyValue(1));
          return <div key={index} className={winner ? 'winner' : ''}>
            {winner && <Crown aria-hidden="true" />}
            <h2>{party.names[index]}</h2>
            <strong>{fairParty ? `${scoring.rating.toFixed(1)}%` : finalScore(scoring.score, setup.mods).toLocaleString()}</strong>
            <p>{fairParty ? `timing rating · ${finalScore(scoring.score, setup.mods).toLocaleString()} points` : `${Math.round(scoring.rating)}%`}{party.difficulties ? ` · ${difficultyNames[party.difficulties[index]]}` : ''} · best streak {scoring.bestCombo}</p>
            <p>{scoring.perfects} perfect · {scoring.misses} missed</p>
          </div>;
        })}
        {party.coop && <div className="team-total"><span>Team score</span><strong>{shownScore.toLocaleString()}</strong></div>}
      </div> : <div className="results-hero">
        <div className="results-stars" role="img" aria-label={`${Math.min(starSlots, stars)} out of ${starSlots} stars${stars === 6 ? ', gold' : ''}`} data-gold={stars === 6 ? 'true' : undefined}>
          {Array.from({ length: starSlots }, (_, index) => <Star key={index} aria-hidden="true"
            className={index < stars ? 'earned' : ''} style={{ '--delay': `${350 + index * 190}ms` } as CSSProperties} />)}
        </div>
        <div className="results-score">
          <span>{typing ? 'Words per minute' : setDone ? 'Set total' : 'Score'}</span>
          <strong data-testid="final-score">{typing ? (summary.wpm ?? 0).toFixed(1) : shownScore.toLocaleString()}</strong>
          {setDone && <p className="best">Last song {summary.score.toLocaleString()} · average timing rating {setAverage.toFixed(1)}%</p>}
          {!typing && !setDone && !(setup.set && !songCleared(summary)) && <p className={outcome.newBest && !failed ? 'best new' : 'best'}>
            {failed ? `Made it ${Math.round(100 * summary.durationMs / recording.chart.durationMs)}% of the way`
              : outcome.newBest ? (outcome.firstClear ? (summary.stars > 0 ? 'First clear!' : 'First time through') : `New personal best! +${(summary.score - outcome.previousBest).toLocaleString()}`)
              : outcome.previousBest > 0 ? `Personal best ${outcome.previousBest.toLocaleString()}` : ''}</p>}
          {typing && <p className="best">{result.typingAccuracy}% accuracy · score {summary.score.toLocaleString()}</p>}
        </div>
        {!typing && (() => {
          const grade = setDone ? (setAverage >= 93 ? 'S' : setAverage >= 85 ? 'A' : setAverage >= 72 ? 'B' : setAverage >= 55 ? 'C' : 'D') : summary.grade;
          return <div className="grade" data-grade={grade[0]} aria-label={`${setDone ? 'Set grade' : 'Grade'} ${grade}`}>{grade}</div>;
        })()}
      </div>}

      {setup.set && !(!failed && songCleared(summary) && setup.set.index + 1 === setup.set.ids.length) && <p className={`challenge-result ${failed || !songCleared(summary) ? 'lost' : 'won'}`} role="status">
        {failed || !songCleared(summary) ? `The set ends here, ${setup.set.index + 1} of ${setup.set.ids.length} songs in${failed ? '' : `: you hit ${summary.totalNotes ? Math.floor(100 * (summary.perfects + summary.greats + summary.goods) / summary.totalNotes) : 0}% of the notes and a set song needs 60%`}. Set total ${(setup.set.score + summary.score).toLocaleString()}.`
          : setup.set.index + 1 < setup.set.ids.length ? `Set total ${(setup.set.score + summary.score).toLocaleString()} after ${setup.set.index + 1} of ${setup.set.ids.length} songs.`
          : (() => {
            const ratings = [...setup.set.ratings, summary.rating];
            const average = ratings.reduce((total, value) => total + value, 0) / ratings.length;
            return `Set complete: ${(setup.set.score + summary.score).toLocaleString()} points, ${average.toFixed(1)}% average timing rating. ${average >= 80 ? 'Gold record earned!' : 'Average 80% for the gold record.'}`;
          })()}</p>}
      {setup.tutorial && <p className="offset-hint">Here to learn typing? The Typing academy on the main menu starts with two keys and waits for you.</p>}
      <div className="results-actions">
        {next && <button ref={primary} className="primary big" onClick={next.run}>{next.label}<ChevronRight aria-hidden="true" /></button>}
        {!(setup.set && (failed || !songCleared(summary) || setDone)) && <button ref={next ? undefined : primary} className={next ? '' : 'primary big'} onClick={onReplay}><RotateCcw aria-hidden="true" size={18} />Play again</button>}
        {setup.tutorial && <button onClick={() => { try { sessionStorage.setItem('ks:partyLevel', 'beginner'); } catch { /* optional */ } app.go({ name: 'party' }); }}><Users aria-hidden="true" size={18} />Play with a friend</button>}
        {ranked && <button onClick={share}><Share2 aria-hidden="true" size={18} />Challenge a friend</button>}
        <button className="ghost" onClick={onExit}>{exitLabel}</button>
        <p className="hint keyboard-only">{setup.set && (failed || !songCleared(summary)) ? <><kbd>R</kbd> restart the set</> : setDone ? <><kbd>R</kbd> play the set again</> : <><kbd>R</kbd> play again{next ? <> · <kbd>N</kbd> next</> : null}</>} · <kbd>Esc</kbd> back</p>
      </div>

      {setup.set && !failed && songCleared(summary) && setup.set.index + 1 === setup.set.ids.length && (() => {
        const ratings = [...setup.set.ratings, summary.rating];
        const scores = [...(setup.set.scores ?? []), summary.score];
        const average = ratings.reduce((total, value) => total + value, 0) / ratings.length;
        const platinum = ratings.every(value => value >= 85);
        return <div className="set-summary" data-gold={average >= 80 ? 'true' : undefined} data-platinum={platinum ? 'true' : undefined}>
          <div className="record" aria-hidden="true"><i /></div>
          <div>
            <h2>{platinum ? 'Platinum record' : average >= 80 ? 'Gold record' : 'Set finished'}: {setup.set.name}</h2>
            <ol>{setup.set.ids.map((id, index) => <li key={id} data-short={!platinum && (ratings[index] ?? 0) < 85 ? 'true' : undefined}><span>{songTitles[id] ?? `Song ${index + 1}`}
              {!platinum && (ratings[index] ?? 0) < 85 && <> <button type="button" title="Practice this song. It is under the 85% platinum mark."
                onClick={() => { const song = app.songs.find(item => item.id === id); if (song) void app.launch(id, { mode: 'quickplay', difficulty: setup.difficulty, mods: [], practice: { startMs: 0, endMs: song.durationMs, rate: 1 } }, { name: 'tour' }); }}>Practice</button></>}
            </span><em>{(scores[index] ?? 0).toLocaleString()}</em><b>{(ratings[index] ?? 0).toFixed(1)}%</b></li>)}</ol>
            <p>Total {scores.reduce((total, value) => total + value, 0).toLocaleString()} · average timing rating {average.toFixed(1)}% on {difficultyNames[setup.difficulty]}</p>
            {average >= 80 && !platinum && <p className="set-goal">Extra goal: 85% or better on every song for a platinum record. Lowest song here: {Math.min(...ratings).toFixed(1)}%. Songs under 85% have a Practice button.</p>}
            {average < 80 && <p className="set-goal">A gold record needs an 80% average timing rating. You were {(80 - average).toFixed(1)} points short.</p>}
          </div>
        </div>;
      })()}
      {challenge && <p className={`challenge-result ${beat ? 'won' : 'lost'}`} role="status">
        {beat ? `You beat ${challenge.name} by ${(summary.score - challenge.score).toLocaleString()}. Send the challenge back!`
          : `${challenge.name} still leads by ${(challenge.score - summary.score).toLocaleString()}. One more try?`}</p>}
      {outcome.tour && !setup.set && <p className="challenge-result won" role="status">
        {outcome.tour.firstClear ? 'Song cleared. The next show is unlocked.' : outcome.tour.cleared ? 'Song cleared.' : 'Hit 60% of the notes to clear this song.'}</p>}
      {outcome.lesson && <p className={`challenge-result ${outcome.lesson.passed ? 'won' : 'lost'}`} role="status">
        {outcome.lesson.passed ? `${outcome.lesson.stars === 3 ? ((summary.wpm ?? 0) >= setup.typing!.lesson!.goal.wpm ? 'Three stars, and up to speed.' : `Three stars for accuracy. Next goal: ${setup.typing!.lesson!.goal.wpm} words per minute.`) : 'Reach 97% accuracy for three stars.'}${outcome.lesson.firstPass && outcome.lesson.next ? ` Unlocked: ${outcome.lesson.next.title}.` : ''}`
          : `Reach ${setup.typing!.lesson!.goal.accuracy}% accuracy to pass. You hit ${result.typingAccuracy}%.`}</p>}

      {setDone && <h2 className="set-last">Last song: {song.title}</h2>}
      {!party && result.waited && <dl className="results-stats">
        <div data-tone="great"><dt>Correct letters</dt><dd>{summary.perfects + summary.greats + summary.goods}</dd></div>
        <div data-tone="miss"><dt>Wrong keys</dt><dd>{summary.wrongKeys}</dd></div>
        <div><dt>Accuracy</dt><dd>{result.typingAccuracy}%</dd></div>
        <div><dt>Best streak</dt><dd>{summary.bestCombo}</dd></div>
      </dl>}
      {typing && !result.waited && summary.misses >= 6 && <p className="offset-hint">Letters arriving too fast?{' '}
        <button className="link" onClick={() => { settingsStore.set(previous => ({ ...previous, typingWait: true })); onReplay(); }}>Try again with the song waiting for you</button></p>}
      {!party && !result.waited && <dl className="results-stats">
        <div data-tone="perfect"><dt>Perfect</dt><dd>{summary.perfects}</dd></div>
        <div data-tone="great"><dt>Great</dt><dd>{summary.greats}</dd></div>
        <div data-tone="good"><dt>Good</dt><dd>{summary.goods}</dd></div>
        <div data-tone="miss"><dt>Missed</dt><dd>{summary.misses}</dd></div>
        <div><dt>Best streak</dt><dd>{summary.bestCombo}</dd></div>
        <div><dt>Notes hit</dt><dd>{summary.totalNotes ? Math.floor(100 * (summary.perfects + summary.greats + summary.goods) / summary.totalNotes) : 0}%</dd></div>
        <div title="Notes hit, weighted by timing: a Perfect counts in full, a Great 80%, a Good 55%."><dt>{typing ? 'Accuracy' : 'Timing rating'}</dt>
          <dd>{typing ? result.typingAccuracy : summary.rating >= 100 ? '100' : summary.rating.toFixed(1)}%</dd></div>
        <div><dt>Stray presses</dt><dd>{summary.wrongKeys}</dd></div>
      </dl>}

      {!party && !typing && onPractice && <Timeline result={result} durationMs={recording.chart.durationMs} names={sectionNames(recording.chart.events.normal, recording.chart.durationMs)} onPractice={onPractice} />}
      {!party && !result.waited && result.offsets.length >= 8 && <TimingChart offsets={result.offsets} windowMs={result.windowMs} />}

      {result.keyStats && <div className="results-typing">
        <KeyboardGuide stats={result.keyStats} compact />
        {weak.length > 0 ? <p>Work on {weak.map(code => `${code === 'Space' ? 'Space' : keyLabel(code)} (${fingerName(code)})`).join(', ')}.</p>
          : <p>{summary.misses + summary.wrongKeys === 0 ? 'Every key landed. Clean hands.' : 'No single key stands out. Keep your eyes on the next letter.'}</p>}
        <p className="heat-legend"><i data-tone="rough" /> missed most <i data-tone="ok" /> shaky <i data-tone="clean" /> clean</p>
      </div>}

      {suggestOffset && <p className="offset-hint" role="status">
        {offsetApplied ? 'Timing offset updated.' : <>Your hits land about {Math.abs(Math.round(offset!))} ms {offset! < 0 ? 'early' : 'late'}.{' '}
          <button className="link" onClick={() => {
            settingsStore.set(previous => ({ ...previous, calibration: Math.max(-250, Math.min(250, Math.round(previous.calibration + offset!))) }));
            setOffsetApplied(true);
          }}>Adjust timing to match</button></>}</p>}

      {result.credited && result.credited.length > 0 && <p className="offset-hint" role="status">
        {result.credited.map(item => `${item.name} earned ${item.xp} XP`).join(' and ')} on {result.credited.length > 1 ? 'their own profiles' : 'their own profile'}.</p>}
      {result.spectator && party && <p className="offset-hint">{save.name || 'The active player'} sat this one out, so nothing below changed. Guests keep no progress.</p>}
      {!bot && !result.spectator && <div className="xp-panel">
        <div className="xp-head"><strong>Level {after.level}</strong><span>{after.title}</span><em>+{outcome.xp.total} XP</em></div>
        <div className="xp-bar" role="progressbar" aria-label="Experience" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(after.progress * 100)}>
          <i style={{ width: `${xpShown * 100}%` }} /></div>
        <ul className="xp-parts">{outcome.xp.parts.map(part => <li key={part.label}><span>{part.label}</span><b>+{part.xp}</b></li>)}</ul>
        {outcome.streak.extended && outcome.streak.days > 1 && <p className="streak-note">{outcome.streak.days} day streak. Play tomorrow to keep it.</p>}
        {leveled && <p className="level-up" role="status"><Trophy aria-hidden="true" /><span>Level up! You are now level {after.level}.</span></p>}
        {outcome.unlocked.map(item => <p key={item.kind + item.id} className="unlock-note"><Unlock aria-hidden="true" /><span>New {item.kind === 'fx' ? 'hit effect' : item.kind === 'highway' ? 'neck' : 'gem style'}: <strong>{item.name}</strong>. Equip it in the locker.</span></p>)}
        {outcome.achievements.map(item => <p key={item.id} className="achievement-note"><Award aria-hidden="true" /><span><strong>{item.name}</strong> {item.blurb}</span></p>)}
      </div>}

      {ranked && <div className="results-board">
        <h2>Leaderboard{setDone ? `: ${song.title}` : ''} {submitted && <span>You are #{submitted.rank}{submitted.daily ? ` · daily #${submitted.daily.rank}` : ''}</span>}</h2>
        {board ? <ol>{board.entries.slice(0, 5).map(entry => <li key={entry.rank + entry.name} className={entry.you ? 'you' : ''}>
          <span>{entry.rank}</span><strong>{entry.name}</strong><em>{entry.score.toLocaleString()}</em></li>)}</ol>
          : postError ? <p className="muted" role="alert">{postError} <button className="link" onClick={() => setAttempt(value => value + 1)}>Try again</button></p>
          : <p className="muted">Posting your score…</p>}
        {board && postError && <p className="muted" role="alert">{postError} <button className="link" onClick={() => setAttempt(value => value + 1)}>Try again</button></p>}
      </div>}
      {rankable && result.paused && <p className="offset-hint">Paused runs stay off the leaderboard. Play it through without pausing to post a score.</p>}

      {shareStatus && <p role="status" className="share-status">{shareStatus}</p>}
    </section>
  </div>;
}
