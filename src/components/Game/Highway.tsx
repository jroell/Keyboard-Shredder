import type { Chart, SongEvent } from '../../../shared/song';
import type { Scoring } from '../../../shared/scoring';

type Feedback = Scoring['feedback'];
const strikeY = 82;

function widthAt(y: number) {
  return 28 + 0.7 * y;
}

function laneAt(lane: number, y: number) {
  return 50 + (lane - 2) * widthAt(y) / 5;
}

function project(delta: number, lookahead: number) {
  const depth = Math.max(-0.07, Math.min(1, delta / lookahead));
  return strikeY - 74 * depth / (0.55 + 0.45 * depth);
}

function sustainShape(lane: number, head: number, tail: number) {
  const lower = laneAt(lane, head);
  const upper = laneAt(lane, tail);
  const near = widthAt(head) * 0.025;
  const far = widthAt(tail) * 0.025;
  return `polygon(${upper - far}% ${tail}%, ${upper + far}% ${tail}%, ${lower + near}% ${head}%, ${lower - near}% ${head}%)`;
}

export default function Highway({ chart, events, time, lookahead, colors, keys, game, feedback, missed }: {
  chart: Chart; events: SongEvent[]; time: number; lookahead: number; colors: string[]; keys: string[];
  game: Scoring; feedback: Feedback; missed: boolean;
}) {
  const visible = events.filter(event => event.timeMs + event.durationMs > time - 130 &&
    event.timeMs <= time + lookahead && (!game.consumed.has(event.id) || game.sustaining.has(event.id)));
  return <div className="highway" aria-hidden="true">
    <div className="highway-bed" />
    {colors.map((color, lane) => (
      <div className="highway-rail" key={lane} style={{ color,
        clipPath: sustainShape(lane, 100, 0),
      }} />
    ))}
    {chart.beatsMs.filter(beat => beat >= time - 130 && beat <= time + lookahead).map(beat => {
      const y = project(beat - time, lookahead);
      return <div key={beat} className={chart.downbeatsMs.includes(beat) ? 'beat downbeat' : 'beat'}
        style={{ top: `${y}%`, width: `${widthAt(y)}%` }} />;
    })}
    <div className="strike-line" style={{ top: `${strikeY}%`, width: `${widthAt(strikeY)}%` }} />
    {visible.map(event => {
      const held = game.sustaining.has(event.id);
      const y = project(held ? 0 : event.timeMs - time, lookahead);
      const tail = project(event.timeMs + event.durationMs - time, lookahead);
      const first = laneAt(Math.min(...event.lanes), y);
      const last = laneAt(Math.max(...event.lanes), y);
      return <div key={event.id}>
        {event.durationMs > 0 && event.lanes.map(lane => <div key={lane} className="note-tail"
          style={{ color: colors[lane], clipPath: sustainShape(lane, y, tail) }} />)}
        {event.lanes.length > 1 && <div className="chord-link" style={{ top: `${y}%`, left: `${first}%`, width: `${last - first}%` }} />}
        {event.lanes.map(lane => <div key={lane} className="note" data-note={event.id} style={{
          left: `${laneAt(lane, y)}%`, top: `${y}%`, width: `${widthAt(y) * 0.126}%`, color: colors[lane],
        }} />)}
      </div>;
    })}
    {keys.map((key, lane) => {
      const result = feedback?.lanes.includes(lane) ? missed ? ' missed' : ' hit' : '';
      return <div key={key} className={`target${game.held.has(lane) ? ' held' : ''}${result}`}
        style={{ color: colors[lane], left: `${laneAt(lane, strikeY)}%`, top: `${strikeY}%` }}>
        {result === ' hit' && <span className="lane-hit-burst" key={feedback?.timeMs} />}
        <kbd>{key.replace(/^(Key|Digit)/, '')}</kbd>
      </div>;
    })}
  </div>;
}
