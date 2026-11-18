import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Award, ChevronRight, Crown, RotateCcw, Share2, Star, Trophy, Unlock } from 'lucide-react';
import { difficultyNames } from '../../shared/difficulty';
import { MODS, finalScore, isRanked } from '../../shared/modifiers';
import { levelFor } from '../../shared/progression';
import { starsFor } from '../../shared/rating';
import { keyLabel } from '../../shared/practice';
import { weakestKeys } from '../../shared/typing';
import type { Recording } from '../lib/recording';
import { fetchBoard, submitScore, type Board, type Submitted } from '../lib/api';
import { sfx } from '../game/sfx';
import { saveStore, settingsStore, useCell } from '../state/store';
import type { RunResult, RunSetup } from './GameScreen';
import KeyboardGuide, { fingerName } from './KeyboardGuide';
import confetti from 'canvas-confetti';

type Props = {
  recording: Recording; setup: RunSetup; result: RunResult; bot: boolean;
  onReplay: () => void; onExit: () => void; exitLabel: string;
  next?: { label: string; run: () => void };
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

export default function Results({ recording, setup, result, bot, onReplay, onExit, exitLabel, next }: Props) {
  const { song } = recording;
  const { summary, outcome, scorings } = result;
  const save = useCell(saveStore);
  const settings = useCell(settingsStore);
  const [board, setBoard] = useState<Board>();
  const [submitted, setSubmitted] = useState<Submitted>();
  const [shareStatus, setShareStatus] = useState('');
  const [offsetApplied, setOffsetApplied] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const party = setup.party;
  const typing = !!result.typing;
  const failed = summary.failed;
  // A lesson is graded on its own three-star scale.
  const starSlots = outcome.lesson ? 3 : 5;
  const stars = outcome.lesson ? outcome.lesson.stars
    : party?.coop ? Math.min(5, Math.round((starsFor(scorings[0].tally) + starsFor(scorings[1].tally)) / 2)) : summary.stars;
  const shownScore = useCountUp(party?.coop ? finalScore(scorings[0].score + scorings[1].score, setup.mods) : summary.score, 900);
  const before = useMemo(() => levelFor(outcome.save.xp - outcome.xp.total), [outcome]);
  const after = useMemo(() => levelFor(outcome.save.xp), [outcome]);
  const leveled = after.level > before.level;
  const [xpShown, setXpShown] = useState(before.progress);
  const ranked = !bot && !failed && !typing && !party && isRanked(setup.mods) && song.model === 'starter-setlist' && scorings[0].hits > 0 &&
    ['quickplay', 'tour', 'daily', 'challenge'].includes(setup.mode);

  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
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
    submitScore({ songId: song.id, difficulty: setup.difficulty, mods: setup.mods, daily: setup.daily }, result.log)
      .then(reply => { if (active) setSubmitted(reply); })
      .catch(() => {})
      .then(() => fetchBoard(song.id, setup.difficulty, setup.mods))
      .then(next => { if (active) setBoard(next); })
      .catch(() => {});
    return () => { active = false; };
  }, [ranked, result, song.id, setup]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.repeat || event.target instanceof HTMLInputElement) return;
      if (event.code === 'KeyR') { event.preventDefault(); onReplay(); }
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

  const title = failed ? (setup.mods.includes('sudden') ? 'Sudden death' : 'Booed off stage')
    : party ? (party.coop ? 'Set complete' : `${party.names[scorings[0].score >= scorings[1].score ? 0 : 1]} wins!`)
    : outcome.lesson ? (outcome.lesson.passed ? 'Lesson passed' : 'Keep practising')
    : summary.fullCombo ? 'Full combo!' : summary.stars >= 5 ? 'Standing ovation' : summary.stars >= 3 ? 'Set complete' : 'Rough night';
  const challenge = setup.challenge;
  const beat = challenge && !failed && summary.score > challenge.score;
  const weak = result.keyStats ? weakestKeys(result.keyStats, 3, 3).filter(code => {
    const stat = result.keyStats![code];
    return stat.hits / stat.attempts < 0.9;
  }) : [];
  const offset = result.hitOffsetMs;
  const suggestOffset = offset !== null && Math.abs(offset) >= 22 && !typing && !bot;

  return <div className="results-layer" data-failed={failed ? 'true' : undefined}>
    <section className="results" aria-labelledby="results-title">
      <header>
        <p className="eyebrow">{song.title} · {typing ? setup.typing?.lesson?.title ?? 'Free typing' : difficultyNames[setup.difficulty]}
          {setup.mods.map(id => ` · ${MODS[id].name}`)}</p>
        <h1 id="results-title">{title}</h1>
      </header>

      {party ? <div className="party-results">
        {scorings.map((scoring, index) => {
          const winner = !party.coop && scoring.score === Math.max(...scorings.map(item => item.score));
          return <div key={index} className={winner ? 'winner' : ''}>
            {winner && <Crown aria-hidden="true" />}
            <h2>{party.names[index]}</h2>
            <strong>{finalScore(scoring.score, setup.mods).toLocaleString()}</strong>
            <p>{Math.round(scoring.rating)}% · best streak {scoring.bestCombo}</p>
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
          <span>{typing ? 'Words per minute' : 'Score'}</span>
          <strong data-testid="final-score">{typing ? (summary.wpm ?? 0).toFixed(1) : shownScore.toLocaleString()}</strong>
          {!typing && <p className={outcome.newBest && !failed ? 'best new' : 'best'}>
            {failed ? `Made it ${Math.round(100 * summary.durationMs / recording.chart.durationMs)}% of the way`
              : outcome.newBest ? (outcome.firstClear ? 'First clear!' : `New personal best! +${(summary.score - outcome.previousBest).toLocaleString()}`)
              : outcome.previousBest > 0 ? `Personal best ${outcome.previousBest.toLocaleString()}` : ''}</p>}
          {typing && <p className="best">{result.typingAccuracy}% accuracy · score {summary.score.toLocaleString()}</p>}
        </div>
        <div className="grade" data-grade={summary.grade[0]} aria-label={`Grade ${summary.grade}`}>{summary.grade}</div>
      </div>}

      {challenge && <p className={`challenge-result ${beat ? 'won' : 'lost'}`} role="status">
        {beat ? `You beat ${challenge.name} by ${(summary.score - challenge.score).toLocaleString()}. Send the challenge back!`
          : `${challenge.name} still leads by ${(challenge.score - summary.score).toLocaleString()}. One more try?`}</p>}
      {outcome.tour && <p className="challenge-result won" role="status">
        {outcome.tour.firstClear ? 'Song cleared. The next show is unlocked.' : outcome.tour.cleared ? 'Song cleared.' : 'Hit 60% of the notes to clear this song.'}</p>}
      {outcome.lesson && <p className={`challenge-result ${outcome.lesson.passed ? 'won' : 'lost'}`} role="status">
        {outcome.lesson.passed ? `${outcome.lesson.stars === 3 ? 'Three stars. Nothing left to prove here.' : 'Reach 97% accuracy for three stars.'}${outcome.lesson.firstPass && outcome.lesson.next ? ` Unlocked: ${outcome.lesson.next.title}.` : ''}`
          : `Reach ${setup.typing!.lesson!.goal.accuracy}% accuracy to pass. You hit ${result.typingAccuracy}%.`}</p>}

      {!party && <dl className="results-stats">
        <div data-tone="perfect"><dt>Perfect</dt><dd>{summary.perfects}</dd></div>
        <div data-tone="great"><dt>Great</dt><dd>{summary.greats}</dd></div>
        <div data-tone="good"><dt>Good</dt><dd>{summary.goods}</dd></div>
        <div data-tone="miss"><dt>Missed</dt><dd>{summary.misses}</dd></div>
        <div><dt>Best streak</dt><dd>{summary.bestCombo}</dd></div>
        <div><dt>{typing ? 'Accuracy' : 'Rating'}</dt><dd>{typing ? result.typingAccuracy : Math.round(summary.rating)}%</dd></div>
        {summary.wrongKeys > 0 && <div><dt>Stray presses</dt><dd>{summary.wrongKeys}</dd></div>}
      </dl>}

      {!party && result.offsets.length >= 8 && <TimingChart offsets={result.offsets} windowMs={result.windowMs} />}

      {result.keyStats && <div className="results-typing">
        <KeyboardGuide stats={result.keyStats} compact />
        {weak.length > 0 ? <p>Work on {weak.map(code => `${code === 'Space' ? 'Space' : keyLabel(code)} (${fingerName(code)})`).join(', ')}.</p>
          : <p>Every key landed. Clean hands.</p>}
      </div>}

      {suggestOffset && <p className="offset-hint" role="status">
        {offsetApplied ? 'Timing offset updated.' : <>Your hits land about {Math.abs(Math.round(offset!))} ms {offset! < 0 ? 'early' : 'late'}.{' '}
          <button className="link" onClick={() => {
            settingsStore.set(previous => ({ ...previous, calibration: Math.max(-250, Math.min(250, Math.round(previous.calibration + offset!))) }));
            setOffsetApplied(true);
          }}>Adjust timing to match</button></>}</p>}

      {!bot && <div className="xp-panel">
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
        <h2>Leaderboard {submitted && <span>You are #{submitted.rank}{submitted.daily ? ` · daily #${submitted.daily.rank}` : ''}</span>}</h2>
        {board ? <ol>{board.entries.slice(0, 5).map(entry => <li key={entry.rank + entry.name} className={entry.you ? 'you' : ''}>
          <span>{entry.rank}</span><strong>{entry.name}</strong><em>{entry.score.toLocaleString()}</em></li>)}</ol>
          : <p className="muted">Posting your score…</p>}
      </div>}

      <div className="results-actions">
        {next && <button ref={primary} className="primary big" onClick={next.run}>{next.label}<ChevronRight aria-hidden="true" /></button>}
        <button ref={next ? undefined : primary} className={next ? '' : 'primary big'} onClick={onReplay}><RotateCcw aria-hidden="true" size={18} />{failed ? 'Try again' : 'Play again'}</button>
        {ranked && <button onClick={share}><Share2 aria-hidden="true" size={18} />Challenge a friend</button>}
        <button className="ghost" onClick={onExit}>{exitLabel}</button>
      </div>
      {shareStatus && <p role="status" className="share-status">{shareStatus}</p>}
      <p className="hint"><kbd>R</kbd> play again{next ? <> · <kbd>N</kbd> next</> : null} · <kbd>Esc</kbd> back</p>
    </section>
  </div>;
}
