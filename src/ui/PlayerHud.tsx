import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Flame, Users, Zap } from 'lucide-react';
import type { Scoring } from '../../shared/scoring';
import { BOOST_MS } from '../../shared/scoring';

export type HudHandle = {
  update: (scoring: Scoring, timeMs: number, shownScore: number) => void;
  place: (x: number, width: number) => void;
  callout: (text: string, kind?: string) => void;
};

function retrigger(element: HTMLElement | null, name: string) {
  if (!element) return;
  element.classList.remove(name);
  void element.offsetWidth;
  element.classList.add(name);
}

/** Score, multiplier, streak, crowd and amp meters for one highway. Updated every frame without React renders. */
const PlayerHud = forwardRef<HudHandle, { label?: string; boostKey: string; showScore: boolean; byRating?: boolean }>(function PlayerHud({ label, boostKey, showScore, byRating }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const score = useRef<HTMLElement>(null);
  const mult = useRef<HTMLDivElement>(null);
  const multText = useRef<HTMLElement>(null);
  const streak = useRef<HTMLElement>(null);
  const streakBox = useRef<HTMLDivElement>(null);
  const crowd = useRef<HTMLDivElement>(null);
  const amp = useRef<HTMLDivElement>(null);
  const callouts = useRef<HTMLDivElement>(null);
  const last = useRef({ score: -1, mult: 0, combo: -1, crowd: -1, amp: -1, ready: false, boost: false });

  useImperativeHandle(ref, () => ({
    callout(text, kind = '') {
      const host = callouts.current;
      if (!host) return;
      // The same word twice in a row replaces itself instead of stacking.
      if (host.lastElementChild?.textContent === text) host.lastElementChild.remove();
      const node = document.createElement('div');
      node.className = `callout ${kind}`;
      node.textContent = text;
      host.append(node);
      while (host.children.length > 2) host.firstElementChild?.remove();
      setTimeout(() => node.remove(), 1500);
    },
    place(x, width) {
      root.current?.style.setProperty('--hx', `${x}px`);
      root.current?.style.setProperty('--hw', `${width}px`);
    },
    update(scoring, timeMs, shownScore) {
      const state = last.current;
      // A battle on different difficulties is decided on timing rating, so that is the number to watch.
      const rounded = byRating ? Math.round(scoring.liveRating) : Math.round(shownScore);
      if (rounded !== state.score && score.current) {
        state.score = rounded;
        score.current.textContent = byRating ? `${rounded}%` : rounded.toLocaleString();
      }
      const boosting = scoring.boosting(timeMs);
      const multiplier = scoring.multiplier(timeMs);
      if (multiplier !== state.mult && mult.current && multText.current) {
        if (multiplier > state.mult && state.mult) retrigger(mult.current, 'pop');
        state.mult = multiplier;
        multText.current.textContent = `${multiplier}×`;
        mult.current.dataset.level = String(Math.min(4, 1 + Math.floor(scoring.combo / 10)));
      }
      if (scoring.combo !== state.combo && streak.current && mult.current && streakBox.current) {
        if (scoring.combo > state.combo && scoring.combo % 10 === 0) retrigger(streakBox.current, 'pop');
        if (scoring.combo < state.combo && state.combo >= 10) retrigger(streakBox.current, 'broke');
        state.combo = scoring.combo;
        streak.current.textContent = String(scoring.combo);
        streakBox.current.dataset.hot = scoring.combo >= 30 ? 'true' : 'false';
        mult.current.style.setProperty('--ring', String(scoring.combo >= 30 ? 1 : (scoring.combo % 10) / 10));
      }
      const crowdValue = Math.round(scoring.crowd);
      if (crowdValue !== state.crowd && crowd.current) {
        state.crowd = crowdValue;
        crowd.current.style.setProperty('--level', String(crowdValue / 100));
        crowd.current.dataset.zone = crowdValue < 25 ? 'low' : crowdValue < 65 ? 'mid' : 'high';
      }
      const ampValue = boosting ? scoring.boostRemaining(timeMs) / BOOST_MS : scoring.ampCharge / 100;
      const ampRounded = Math.round(ampValue * 200);
      const ready = !boosting && scoring.ampCharge >= 100;
      if ((ampRounded !== state.amp || ready !== state.ready || boosting !== state.boost) && amp.current) {
        state.amp = ampRounded;
        amp.current.style.setProperty('--level', String(Math.max(0, Math.min(1, ampValue))));
        if (ready !== state.ready) amp.current.dataset.ready = String(ready);
        if (boosting !== state.boost) amp.current.dataset.boost = String(boosting);
        state.ready = ready;
        state.boost = boosting;
      }
    },
  }), [byRating]);

  return <div className="hud" ref={root}>
    <div className="callouts" ref={callouts} aria-live="polite" />
    <div className="hud-left">
      {label && <div className="hud-name">{label}</div>}
      {showScore && <div className="hud-score"><span>{byRating ? 'Timing rating' : 'Score'}</span><strong ref={score} data-testid="score">{byRating ? '0%' : '0'}</strong></div>}
      <div className="hud-mult" ref={mult} data-level="1" aria-label="Score multiplier">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="track" cx="50" cy="50" r="43" /><circle className="fill" cx="50" cy="50" r="43" pathLength="1" /></svg>
        <strong ref={multText}>1×</strong>
      </div>
      <div className="hud-streak" ref={streakBox}><Flame aria-hidden="true" size={18} /><strong ref={streak} data-testid="combo">0</strong><span>streak</span></div>
    </div>
    <div className="hud-right">
      <div className="hud-meter crowd" ref={crowd} data-zone="mid" role="meter" aria-label="Crowd energy" aria-valuemin={0} aria-valuemax={100}>
        <Users aria-hidden="true" size={16} /><div className="tube"><i /></div><span>Crowd</span>
      </div>
      <div className="hud-meter amp" ref={amp} data-ready="false" data-boost="false" role="meter" aria-label="Amp charge" aria-valuemin={0} aria-valuemax={100}>
        <Zap aria-hidden="true" size={16} /><div className="tube"><i /></div><span>Amp</span>
        <kbd>{boostKey}</kbd>
      </div>
    </div>
  </div>;
});

export default PlayerHud;
