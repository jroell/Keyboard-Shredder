import type { Chart, SongEvent } from '../../shared/song';
import type { ScoreEvent, Scoring } from '../../shared/scoring';
import { HIGHWAYS, mix, rgba, type HighwayTheme } from './themes';

export type LaneLayout = {
  columns: number;
  /** Visual column for a lane. -1 draws a bar across the whole neck (the space bar). */
  column: (lane: number) => number;
  color: (lane: number) => string;
  /** Text printed on the gem. Empty for plain gems. */
  gemLabel: (lane: number) => string;
  /** `unused` marks a ring no note in this chart uses. It is drawn faint and without its label. */
  targets: { label: string; color: string; unused?: boolean }[];
};

export type HighwayLook = { theme: string; gem: string; fx: string; lookahead: number; hidden: boolean; calm: boolean; /** Show a plain tick for hits, for modes that do not judge timing. */ plainHits?: boolean };

type Particle = {
  kind: 'spark' | 'ember' | 'ring' | 'confetti' | 'glyph' | 'pixel' | 'text';
  x: number; y: number; vx: number; vy: number; life: number; age: number; size: number; color: string;
  spin?: number; text?: string; gravity?: number;
};

const Z = 2.5;
const NEAR = -0.2;
const BOOST_COLOR = '#7df9ff';
const JUDGE_COLORS: Record<string, string> = {
  Perfect: '#ffe45c', Great: '#5cff9d', Good: '#6cc6ff', Miss: '#ff5a5a', 'Wrong key': '#ff8a8a', 'Sustain dropped': '#ff9c6b',
};
const JUDGE_TEXT: Record<string, string> = {
  Perfect: 'PERFECT', Great: 'GREAT', Good: 'GOOD', Miss: 'MISS', 'Wrong key': 'OOPS', 'Sustain dropped': 'DROPPED',
};

const sprites = new Map<string, HTMLCanvasElement>();
const SPRITE_W = 220;
const SPRITE_H = 150;

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
}

function shapePath(ctx: CanvasRenderingContext2D, skin: string) {
  ctx.beginPath();
  if (skin === 'star') {
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 ? 22 : 50;
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
  } else if (skin === 'heart') {
    ctx.moveTo(0, 40);
    ctx.bezierCurveTo(-70, -5, -40, -55, 0, -22);
    ctx.bezierCurveTo(40, -55, 70, -5, 0, 40);
  } else if (skin === 'bolt') {
    for (const [x, y] of [[10, -50], [-30, 6], [-4, 6], [-14, 50], [32, -10], [6, -10]]) ctx.lineTo(x, y);
  } else if (skin === 'diamond') {
    for (const [x, y] of [[0, -46], [52, 0], [0, 46], [-52, 0]]) ctx.lineTo(x, y);
  } else if (skin === 'skull') {
    ctx.arc(0, -8, 40, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(26, 34);
    ctx.lineTo(-26, 34);
  }
  ctx.closePath();
}

function gemSprite(skin: string, color: string) {
  const key = `${skin}|${color}`;
  const cached = sprites.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_W * 2;
  canvas.height = SPRITE_H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  const cx = SPRITE_W / 2;
  const cy = 82;
  const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 105);
  halo.addColorStop(0, rgba(color, 0.55));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, SPRITE_W, SPRITE_H);
  ellipse(ctx, cx, cy + 13, 80, 30);
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fill();
  if (skin === 'pixel') {
    const block = 12;
    const rows = ['..XXXXXXXX..', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', '.XXXXXXXXXX.', '..XXXXXXXX..'];
    rows.forEach((row, r) => [...row].forEach((cell, c) => {
      if (cell !== 'X') return;
      const edge = r === 0 || r === rows.length - 1 || row[c - 1] !== 'X' || row[c + 1] !== 'X';
      ctx.fillStyle = edge ? mix(color, '#000000', 0.45) : r < 2 ? mix(color, '#ffffff', 0.35) : color;
      ctx.fillRect(cx - 72 + c * block, cy - 30 + r * block, block, block);
    }));
    ctx.fillStyle = '#ffffffd0';
    ctx.fillRect(cx - 36, cy - 18, block * 2, block);
    sprites.set(key, canvas);
    return canvas;
  }
  const rim = ctx.createLinearGradient(0, cy - 32, 0, cy + 34);
  rim.addColorStop(0, '#ffffff');
  rim.addColorStop(0.5, '#b9b9c4');
  rim.addColorStop(1, '#55555f');
  ellipse(ctx, cx, cy, 76, 32);
  ctx.fillStyle = rim;
  ctx.fill();
  ellipse(ctx, cx, cy - 1, 70, 28);
  ctx.fillStyle = '#0b0b10';
  ctx.fill();
  const dome = ctx.createRadialGradient(cx - 12, cy - 16, 4, cx, cy - 2, 66);
  dome.addColorStop(0, mix(color, '#ffffff', 0.75));
  dome.addColorStop(0.35, color);
  dome.addColorStop(1, mix(color, '#000000', 0.55));
  if (skin === 'classic' || skin === 'round') {
    ellipse(ctx, cx, cy - 4, skin === 'round' ? 58 : 63, skin === 'round' ? 27 : 24);
    ctx.fillStyle = dome;
    ctx.fill();
    if (skin === 'classic') {
      ellipse(ctx, cx, cy - 10, 27, 9.5);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fill();
      ellipse(ctx, cx, cy - 10, 27, 9.5);
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ellipse(ctx, cx, cy - 4, 40, 17);
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ellipse(ctx, cx - 18, cy - 14, 16, 5);
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.fill();
    }
  } else {
    ellipse(ctx, cx, cy - 2, 62, 24);
    ctx.fillStyle = mix(color, '#000000', 0.72);
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy - 6);
    ctx.scale(1.12, 0.52);
    shapePath(ctx, skin);
    const fill = ctx.createRadialGradient(-10, -18, 2, 0, 0, 60);
    fill.addColorStop(0, mix(color, '#ffffff', 0.8));
    fill.addColorStop(0.4, color);
    fill.addColorStop(1, mix(color, '#000000', 0.35));
    ctx.fillStyle = skin === 'skull' ? '#f4f1e8' : fill;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = skin === 'skull' ? color : 'rgba(255,255,255,.9)';
    ctx.stroke();
    if (skin === 'skull') {
      ctx.fillStyle = '#0b0b10';
      for (const x of [-15, 15]) { ellipse(ctx, x, -8, 9, 11); ctx.fill(); }
      ctx.fillRect(-2, 8, 4, 10);
    } else if (skin === 'diamond') {
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-52, 0); ctx.lineTo(52, 0); ctx.moveTo(0, -46); ctx.lineTo(-20, 0); ctx.lineTo(0, 46); ctx.lineTo(20, 0); ctx.lineTo(0, -46);
      ctx.stroke();
    }
    ctx.restore();
  }
  sprites.set(key, canvas);
  return canvas;
}

export function beatPulse(chart: Chart, timeMs: number) {
  const beats = chart.beatsMs;
  let low = 0;
  let high = beats.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (beats[middle] <= timeMs) low = middle;
    else high = middle - 1;
  }
  const beat = beats[low];
  if (beat === undefined || beat > timeMs) return 0;
  const length = (beats[low + 1] ?? beat + 60_000 / chart.bpm) - beat;
  return Math.exp(-4 * Math.min(1, (timeMs - beat) / Math.max(120, length)));
}

export class Highway {
  x = 0; y = 0; w = 100; h = 100;
  wobble = 0;
  /** 0 to 1 from a whammy bar. Makes held tails shake. */
  whammy = 0;
  dim = 0;
  energy = 0;
  private particles: Particle[] = [];
  private beams: number[] = [];
  private targetFlash: { until: number; bad: boolean }[] = [];
  private missed = new Set<string>();
  private judge: { text: string; color: string; at: number; detail: string } | null = null;
  private first = 0;
  private lastTime = -Infinity;
  private shake = 0;
  private bolts: { points: [number, number][]; until: number }[] = [];
  private nextBolt = 0;
  private stars: [number, number, number][] = [];
  private flash = 0;

  constructor(public scoring: Scoring, public events: SongEvent[], public layout: LaneLayout, public look: HighwayLook) {
    for (let i = 0; i < 60; i++) this.stars.push([Math.random(), Math.random(), Math.random()]);
  }

  reset(scoring: Scoring, events: SongEvent[]) {
    this.scoring = scoring;
    this.events = events;
    this.missed.clear();
    this.particles = [];
    this.judge = null;
    this.first = 0;
    this.lastTime = -Infinity;
  }

  private scale(depth: number) { return 1 / (1 + Z * depth); }
  private get strikeY() { return this.y + this.h * 0.8; }
  private get farY() { return this.y + this.h * 0.05; }
  private get nearHalf() { return this.w * 0.5 * (this.layout.columns > 6 ? 0.94 : 0.8); }
  private py(depth: number) {
    const far = this.scale(1);
    const vanish = (this.farY - this.strikeY * far) / (1 - far);
    return vanish + (this.strikeY - vanish) * this.scale(depth);
  }
  private half(depth: number) { return this.nearHalf * this.scale(depth); }
  private px(column: number, depth: number, timeMs = 0) {
    const centre = this.x + this.w / 2 + (this.wobble ? Math.sin(timeMs / 130 + depth * 7) * this.w * 0.035 * this.wobble : 0);
    return centre + ((column + 0.5) / this.layout.columns - 0.5) * 2 * this.half(depth);
  }
  private laneWidth(depth: number) { return 2 * this.half(depth) / this.layout.columns; }
  targetPoint(column: number) {
    return { x: column < 0 ? this.x + this.w / 2 : this.px(column, 0), y: this.strikeY };
  }

  press(lane: number, now: number) {
    const column = this.layout.column(lane);
    this.beams[column < 0 ? this.layout.columns : column] = now;
  }

  onScore(event: ScoreEvent, now: number) {
    if (event.type === 'hit') {
      const detail = event.judgement === 'Perfect' ? '' : event.offsetMs < 0 ? 'EARLY' : 'LATE';
      this.judge = this.look.plainHits ? { text: 'NICE', color: JUDGE_COLORS.Great, at: now, detail: '' }
        : { text: JUDGE_TEXT[event.judgement], color: JUDGE_COLORS[event.judgement], at: now, detail };
      for (const lane of event.lanes) this.burst(lane, event.judgement === 'Perfect' ? 1 : event.judgement === 'Great' ? 0.7 : 0.45, now, event.boosted);
      if (event.judgement === 'Perfect' && !this.look.calm) this.flash = Math.min(1, this.flash + 0.25);
    } else if (event.type === 'miss') {
      this.missed.add(event.event.id);
      this.judge = { text: 'MISS', color: JUDGE_COLORS.Miss, at: now, detail: '' };
      for (const lane of event.lanes) this.flashTarget(lane, now, true);
      this.shake = Math.max(this.shake, event.brokeCombo >= 10 ? 9 : 4);
    } else if (event.type === 'wrong') {
      this.judge = { text: 'OOPS', color: JUDGE_COLORS['Wrong key'], at: now, detail: '' };
      for (const lane of event.lanes) this.flashTarget(lane, now, true);
      this.shake = Math.max(this.shake, 3);
    } else if (event.type === 'drop') {
      this.judge = { text: 'DROPPED', color: JUDGE_COLORS['Sustain dropped'], at: now, detail: '' };
    } else if (event.type === 'sustain') {
      for (const lane of event.lanes) this.burst(lane, 0.5, now, false);
    } else if (event.type === 'boost') {
      this.shake = 16;
      this.flash = 1;
      for (let i = 0; i < 70; i++) {
        const side = i % 2 ? 1 : -1;
        const depth = Math.random();
        this.spawn('spark', this.x + this.w / 2 + side * this.half(depth), this.py(depth), side * (60 + Math.random() * 260), -80 - Math.random() * 260, 500 + Math.random() * 500, 3, BOOST_COLOR);
      }
    }
  }

  celebrate(strength: number) {
    const colors = ['#ffe45c', '#ff5d8f', '#35d6e8', '#5cff9d', '#ffffff'];
    for (let i = 0; i < 40 + 80 * strength; i++) {
      this.spawn('confetti', this.x + this.w * Math.random(), this.strikeY - this.h * 0.1 * Math.random(),
        (Math.random() - 0.5) * 500, -300 - Math.random() * 500, 1100 + Math.random() * 900, 5 + Math.random() * 5,
        colors[i % colors.length], 900);
    }
  }

  private spawn(kind: Particle['kind'], x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, gravity = 0, text?: string) {
    if (this.particles.length > 700) this.particles.splice(0, 100);
    this.particles.push({ kind, x, y, vx, vy, life, age: 0, size, color, gravity, text, spin: Math.random() * 6 });
  }

  private flashTarget(lane: number, now: number, bad: boolean) {
    const column = this.layout.column(lane);
    this.targetFlash[column < 0 ? this.layout.columns : column] = { until: now + 220, bad };
  }

  private burst(lane: number, power: number, now: number, boosted: boolean) {
    const column = this.layout.column(lane);
    this.flashTarget(lane, now, false);
    const { x, y } = this.targetPoint(column);
    const color = boosted ? BOOST_COLOR : this.layout.color(lane);
    const unit = this.laneWidth(0);
    const spread = column < 0 ? this.nearHalf * 1.6 : unit * 0.5;
    const count = Math.round((this.look.calm ? 6 : 14) * power) + 4;
    this.spawn('ring', x, y, 0, 0, 260, column < 0 ? this.nearHalf : unit * 0.55, color);
    const fx = this.look.fx;
    for (let i = 0; i < count; i++) {
      const sx = x + (Math.random() - 0.5) * spread;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const speed = (180 + Math.random() * 420) * (0.6 + power * 0.6);
      if (fx === 'flames') this.spawn('ember', sx, y, (Math.random() - 0.5) * 70, -140 - Math.random() * 320 * power, 300 + Math.random() * 380, unit * (0.1 + Math.random() * 0.14), i % 3 ? '#ff8a1f' : '#ffd91f');
      else if (fx === 'confetti') this.spawn('confetti', sx, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 600 + Math.random() * 400, 4 + Math.random() * 4, i % 2 ? color : '#ffffff', 1100);
      else if (fx === 'notes') this.spawn('glyph', sx, y, Math.cos(angle) * speed * 0.5, Math.sin(angle) * speed * 0.6, 700 + Math.random() * 300, unit * 0.3, color, 0, i % 2 ? '♪' : '♫');
      else if (fx === 'pixels') this.spawn('pixel', sx, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 450 + Math.random() * 250, 4 + Math.random() * 5, i % 2 ? color : '#ffffff', 900);
      else this.spawn('spark', sx, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 260 + Math.random() * 300, 2 + Math.random() * 2, i % 3 ? color : '#ffffff', 900);
    }
    if (fx === 'lightning' && !this.look.calm) {
      const points: [number, number][] = [[x, y]];
      let bx = x;
      for (let step = 1; step <= 6; step++) {
        bx += (Math.random() - 0.5) * unit * 0.7;
        points.push([bx, y - step * this.h * 0.035 * (0.6 + power)]);
      }
      this.bolts.push({ points, until: now + 110 });
    }
    // The classic flame lick above a struck fret.
    for (let i = 0; i < (this.look.calm ? 2 : 5); i++) {
      this.spawn('ember', x + (Math.random() - 0.5) * spread * 0.7, y - 4, (Math.random() - 0.5) * 40, -180 - Math.random() * 240 * power,
        220 + Math.random() * 200, unit * (0.16 + Math.random() * 0.12), color);
    }
  }

  draw(ctx: CanvasRenderingContext2D, chart: Chart, timeMs: number, now: number, dt: number) {
    const { layout, scoring, look } = this;
    const theme: HighwayTheme = HIGHWAYS[look.theme] ?? HIGHWAYS.classic;
    const boosting = scoring.boosting(timeMs);
    const pulse = beatPulse(chart, timeMs);
    const columns = layout.columns;
    if (timeMs < this.lastTime - 200) this.first = 0;
    this.lastTime = timeMs;
    this.energy += ((boosting ? 1 : Math.min(1, scoring.combo / 40)) - this.energy) * Math.min(1, dt / 300);
    this.shake *= Math.exp(-dt / 90);
    this.flash *= Math.exp(-dt / 140);

    ctx.save();
    if (this.shake > 0.3 && !look.calm) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake * 0.6);
    const cx = this.x + this.w / 2;
    const yFar = this.py(1);
    const yNear = Math.min(this.y + this.h, this.py(NEAR));
    const nearDepth = NEAR;

    // Bed.
    const bedPath = () => {
      ctx.beginPath();
      ctx.moveTo(cx - this.half(1), yFar);
      ctx.lineTo(cx + this.half(1), yFar);
      ctx.lineTo(cx + this.half(nearDepth), this.py(nearDepth));
      ctx.lineTo(cx - this.half(nearDepth), this.py(nearDepth));
      ctx.closePath();
    };
    const bed = ctx.createLinearGradient(0, yFar, 0, yNear);
    const far = boosting ? '#04162e' : theme.bedFar;
    const near = boosting ? '#0a2a55' : theme.bedNear;
    bed.addColorStop(0, rgba(far.slice(0, 7), 0));
    bed.addColorStop(0.1, rgba(far.slice(0, 7), 0.9));
    bed.addColorStop(1, rgba(near.slice(0, 7), 0.97));
    bedPath();
    ctx.fillStyle = bed;
    ctx.fill();
    ctx.save();
    bedPath();
    ctx.clip();
    this.pattern(ctx, theme, timeMs, pulse, boosting);

    // Lane tints and dividers.
    for (let column = 0; column < columns; column++) {
      const tint = ctx.createLinearGradient(0, this.py(0.9), 0, this.strikeY);
      const color = layout.targets[column]?.color ?? '#ffffff';
      tint.addColorStop(0, rgba(color, 0));
      tint.addColorStop(1, rgba(color, 0.13 + 0.05 * pulse));
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.moveTo(this.px(column - 0.5, 1, timeMs), yFar);
      ctx.lineTo(this.px(column + 0.5, 1, timeMs), yFar);
      ctx.lineTo(this.px(column + 0.5, nearDepth, timeMs), this.py(nearDepth));
      ctx.lineTo(this.px(column - 0.5, nearDepth, timeMs), this.py(nearDepth));
      ctx.fill();
      const beamAge = now - (this.beams[column] ?? -Infinity);
      if (beamAge < 180) {
        const beam = ctx.createLinearGradient(0, this.py(0.55), 0, this.strikeY);
        beam.addColorStop(0, rgba(color, 0));
        beam.addColorStop(1, rgba(color, 0.42 * (1 - beamAge / 180)));
        ctx.fillStyle = beam;
        ctx.fill();
      }
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = boosting ? rgba(BOOST_COLOR, 0.35) : theme.lane;
    for (let line = 1; line < columns; line++) {
      ctx.beginPath();
      ctx.moveTo(this.px(line - 0.5, 1, timeMs), yFar);
      ctx.lineTo(this.px(line - 0.5, nearDepth, timeMs), this.py(nearDepth));
      ctx.stroke();
    }

    // Beat lines travel with the notes.
    const beats = chart.beatsMs;
    for (let i = 0; i < beats.length; i++) {
      const delta = beats[i] - timeMs;
      if (delta < look.lookahead * nearDepth) continue;
      if (delta > look.lookahead) break;
      const depth = delta / look.lookahead;
      const y = this.py(depth);
      const down = chart.downbeatsMs.includes(beats[i]);
      ctx.strokeStyle = down ? theme.downbeat : theme.fret;
      ctx.lineWidth = (down ? 3.5 : 1.5) * this.scale(depth) + 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - this.half(depth), y);
      ctx.lineTo(cx + this.half(depth), y);
      ctx.stroke();
    }
    ctx.restore();

    // Rails.
    const railColor = boosting ? BOOST_COLOR : theme.rail;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      for (const [width, alpha] of [[14, 0.1 + 0.2 * this.energy + 0.12 * pulse], [5, 0.75]] as const) {
        ctx.strokeStyle = rgba(width > 6 ? (boosting ? BOOST_COLOR : theme.glow) : railColor, alpha);
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(cx + side * this.half(1), yFar);
        ctx.lineTo(cx + side * this.half(nearDepth), this.py(nearDepth));
        ctx.stroke();
      }
    }
    if (boosting && !look.calm) {
      if (now > this.nextBolt) {
        this.nextBolt = now + 70;
        const side = Math.random() < 0.5 ? -1 : 1;
        const start = Math.random() * 0.8;
        const points: [number, number][] = [];
        for (let step = 0; step <= 6; step++) {
          const depth = start + step * 0.035;
          points.push([cx + side * this.half(depth) + (Math.random() - 0.5) * 26, this.py(depth)]);
        }
        this.bolts.push({ points, until: now + 120 });
      }
    }
    if (!look.calm && (boosting || scoring.combo >= 30) && Math.random() < 0.7) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const depth = Math.random() * 0.75 - 0.1;
      const hot = boosting ? BOOST_COLOR : Math.random() < 0.5 ? '#ff7a18' : '#ffd91f';
      this.spawn('ember', cx + side * this.half(depth), this.py(depth), side * (10 + Math.random() * 50), -90 - Math.random() * 200,
        350 + Math.random() * 350, this.w * (0.012 + Math.random() * 0.02) * this.scale(depth), hot);
    }
    this.bolts = this.bolts.filter(bolt => bolt.until > now);
    for (const bolt of this.bolts) {
      ctx.strokeStyle = 'rgba(210,250,255,.95)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      bolt.points.forEach(([bx, by], index) => index ? ctx.lineTo(bx, by) : ctx.moveTo(bx, by));
      ctx.stroke();
    }
    // Strike line.
    ctx.strokeStyle = rgba(boosting ? BOOST_COLOR : '#ffffff', 0.5 + 0.3 * pulse);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - this.half(0), this.strikeY);
    ctx.lineTo(cx + this.half(0), this.strikeY);
    ctx.stroke();
    ctx.restore();

    this.drawTargets(ctx, timeMs, now, boosting, false);

    // Notes, far to near.
    while (this.first < this.events.length && this.events[this.first].timeMs + this.events[this.first].durationMs < timeMs - 450) this.first++;
    const visible: SongEvent[] = [];
    for (let i = this.first; i < this.events.length; i++) {
      const event = this.events[i];
      if (event.timeMs > timeMs + look.lookahead) break;
      const consumed = scoring.consumed.has(event.id);
      if (consumed && !scoring.sustaining.has(event.id) && !this.missed.has(event.id)) continue;
      visible.push(event);
    }
    for (let i = visible.length - 1; i >= 0; i--) this.drawNote(ctx, visible[i], timeMs, now, boosting);

    this.drawTargets(ctx, timeMs, now, boosting, true);
    this.drawParticles(ctx, dt);
    this.drawJudgement(ctx, now);
    if (this.flash > 0.02 && !look.calm) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(cx, this.strikeY, 10, cx, this.strikeY, this.w * 0.7);
      glow.addColorStop(0, rgba(boosting ? BOOST_COLOR : theme.glow, 0.22 * this.flash));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(this.x, this.y, this.w, this.h);
      ctx.restore();
    }
    if (this.dim > 0) {
      ctx.fillStyle = `rgba(6,4,10,${this.dim})`;
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
    ctx.restore();
  }

  private pattern(ctx: CanvasRenderingContext2D, theme: HighwayTheme, timeMs: number, pulse: number, boosting: boolean) {
    const cx = this.x + this.w / 2;
    if (boosting) {
      const glow = ctx.createLinearGradient(0, this.farY, 0, this.strikeY);
      glow.addColorStop(0, 'rgba(60,180,255,0)');
      glow.addColorStop(1, `rgba(60,180,255,${0.16 + 0.12 * pulse})`);
      ctx.fillStyle = glow;
      ctx.fillRect(this.x, this.y, this.w, this.h);
      return;
    }
    if (theme.pattern === 'stars') {
      for (const [sx, sy, phase] of this.stars) {
        const depth = (sy + timeMs / 9000) % 1;
        const alpha = 0.35 + 0.5 * Math.sin(timeMs / 400 + phase * 9);
        ctx.fillStyle = `rgba(220,228,255,${Math.max(0, alpha)})`;
        ctx.fillRect(cx + (sx - 0.5) * 2 * this.half(1 - depth), this.py(1 - depth), 2, 2);
      }
    } else if (theme.pattern === 'lava') {
      for (let i = 0; i < 5; i++) {
        const depth = ((i / 5 + timeMs / 7000) % 1);
        const y = this.py(1 - depth);
        const x = cx + Math.sin(i * 2.4 + timeMs / 1900) * this.half(1 - depth) * 0.7;
        const radius = this.w * 0.2 * this.scale(1 - depth);
        const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
        blob.addColorStop(0, `rgba(255,120,30,${0.22 + 0.1 * pulse})`);
        blob.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = blob;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    } else if (theme.pattern === 'ice' || theme.pattern === 'gold') {
      const sweep = ((timeMs / 2600) % 1.6) - 0.3;
      const y = this.py(1 - sweep);
      const sheen = ctx.createLinearGradient(0, y - 60, 0, y + 60);
      const tone = theme.pattern === 'ice' ? '220,248,255' : '255,236,160';
      sheen.addColorStop(0, `rgba(${tone},0)`);
      sheen.addColorStop(0.5, `rgba(${tone},.16)`);
      sheen.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = sheen;
      ctx.fillRect(this.x, y - 60, this.w, 120);
    } else if (theme.pattern === 'sun') {
      const y = this.py(1) + this.h * 0.02;
      const sun = ctx.createLinearGradient(0, y - this.h * 0.02, 0, y + this.h * 0.2);
      sun.addColorStop(0, 'rgba(255,211,110,.5)');
      sun.addColorStop(1, 'rgba(255,95,191,0)');
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(cx, y + this.h * 0.03, this.w * 0.14, Math.PI, 0);
      ctx.fill();
    } else if (theme.pattern === 'wood') {
      ctx.fillStyle = 'rgba(255,225,180,.035)';
      for (let i = 0; i < 9; i++) {
        const offset = (i / 9 - 0.5) * 2;
        ctx.beginPath();
        ctx.moveTo(cx + offset * this.half(1), this.py(1));
        ctx.lineTo(cx + (offset + 0.07) * this.half(1), this.py(1));
        ctx.lineTo(cx + (offset + 0.07) * this.half(NEAR), this.py(NEAR));
        ctx.lineTo(cx + offset * this.half(NEAR), this.py(NEAR));
        ctx.fill();
      }
    }
    if (theme.pattern === 'grid' || theme.pattern === 'sun') {
      ctx.strokeStyle = rgba(theme.glow, 0.16 + 0.1 * pulse);
      ctx.lineWidth = 1;
      const step = 250;
      for (let line = -(timeMs % step); line < this.look.lookahead; line += step) {
        const depth = line / this.look.lookahead;
        if (depth < NEAR) continue;
        const y = this.py(depth);
        ctx.beginPath();
        ctx.moveTo(cx - this.half(depth), y);
        ctx.lineTo(cx + this.half(depth), y);
        ctx.stroke();
      }
    }
  }

  private drawTargets(ctx: CanvasRenderingContext2D, timeMs: number, now: number, boosting: boolean, top: boolean) {
    const { layout, scoring } = this;
    const unit = this.laneWidth(0);
    const held = new Set<number>();
    for (const lane of scoring.held) held.add(layout.column(lane));
    const fontSize = Math.max(11, Math.min(26, unit * 0.3));
    for (let column = 0; column < layout.columns; column++) {
      const target = layout.targets[column];
      const x = this.px(column, 0, timeMs);
      const y = this.strikeY;
      const rx = unit * 0.43;
      const ry = rx * 0.42;
      const color = target.color;
      const down = held.has(column);
      const flash = this.targetFlash[column];
      const flashing = flash && flash.until > now ? (flash.until - now) / 220 : 0;
      if (target.unused && !down && !flashing) {
        if (!top) {
          ellipse(ctx, x, y, rx, ry);
          ctx.lineWidth = 2;
          ctx.strokeStyle = rgba(color, 0.22);
          ctx.stroke();
        }
        continue;
      }
      if (!top) {
        ellipse(ctx, x, y + 3, rx * 1.06, ry * 1.1);
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fill();
        ellipse(ctx, x, y, rx, ry);
        ctx.fillStyle = '#0a0a10';
        ctx.fill();
        ctx.lineWidth = Math.max(2.5, unit * 0.05);
        ctx.strokeStyle = flashing && flash.bad ? '#ff3b46' : color;
        ctx.stroke();
        ellipse(ctx, x, y, rx * 0.62, ry * 0.62);
        ctx.strokeStyle = rgba(color, 0.55);
        ctx.lineWidth = 2;
        ctx.stroke();
        continue;
      }
      if (down || flashing) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const bad = !!flashing && flash.bad;
        const glowColor = bad ? '#ff3b46' : color;
        const strength = Math.max(down ? 0.55 : 0, flashing);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, rx * 1.7);
        glow.addColorStop(0, rgba(bad ? '#ff3b46' : '#ffffff', 0.75 * strength));
        glow.addColorStop(0.35, rgba(glowColor, 0.7 * strength));
        glow.addColorStop(1, rgba(glowColor, 0));
        ctx.fillStyle = glow;
        ellipse(ctx, x, y, rx * 1.7, ry * 1.9);
        ctx.fill();
        ctx.restore();
      }
      if (target.label) {
        const width = Math.max(fontSize * 1.5, ctx.measureText(target.label).width + 12);
        const top = y + ry + unit * 0.12;
        ctx.fillStyle = down ? color : 'rgba(10,10,16,.88)';
        ctx.strokeStyle = rgba(color, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x - width / 2, top + (down ? 2 : 0), width, fontSize * 1.45, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = down ? '#0a0a10' : '#ffffff';
        ctx.font = `800 ${fontSize}px "Barlow Condensed", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(target.label, x, top + fontSize * 0.76 + (down ? 2 : 0));
      }
    }
  }

  private drawNote(ctx: CanvasRenderingContext2D, event: SongEvent, timeMs: number, now: number, boosting: boolean) {
    const { layout, scoring, look } = this;
    const sustaining = scoring.sustaining.has(event.id);
    const missed = this.missed.has(event.id);
    const raw = (event.timeMs - timeMs) / look.lookahead;
    const depth = sustaining ? 0 : Math.max(NEAR, raw);
    if (!sustaining && raw < NEAR && event.timeMs + event.durationMs < timeMs) return;
    const scale = this.scale(depth);
    const y = this.py(depth);
    let alpha = Math.min(1, (1 - raw) * 6);
    if (look.hidden && !sustaining) alpha *= Math.max(0, Math.min(1, (raw - 0.18) * 5));
    if (missed) alpha *= 0.45;
    if (alpha <= 0.01 && !event.durationMs) return;
    const unit = this.laneWidth(depth);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);

    if (event.durationMs > 0) {
      const tailDepth = Math.min(1, Math.max(NEAR, (event.timeMs + event.durationMs - timeMs) / look.lookahead));
      if (tailDepth > depth) {
        for (const lane of event.lanes) {
          const column = layout.column(lane);
          const color = missed ? '#666672' : layout.color(lane);
          const jitter = sustaining ? Math.sin(now / 28 + lane) * unit * (0.03 + 0.16 * this.whammy) : 0;
          const x0 = this.px(column, depth, timeMs) + jitter;
          const x1 = this.px(column, tailDepth, timeMs);
          const w0 = unit * (sustaining ? 0.2 : 0.14);
          const w1 = this.laneWidth(tailDepth) * (sustaining ? 0.2 : 0.14);
          ctx.fillStyle = rgba(color, sustaining ? 0.95 : 0.8);
          ctx.beginPath();
          ctx.moveTo(x1 - w1, this.py(tailDepth));
          ctx.lineTo(x1 + w1, this.py(tailDepth));
          ctx.lineTo(x0 + w0, y);
          ctx.lineTo(x0 - w0, y);
          ctx.fill();
          ctx.fillStyle = sustaining ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.35)';
          ctx.beginPath();
          ctx.moveTo(x1 - w1 * 0.3, this.py(tailDepth));
          ctx.lineTo(x1 + w1 * 0.3, this.py(tailDepth));
          ctx.lineTo(x0 + w0 * 0.3, y);
          ctx.lineTo(x0 - w0 * 0.3, y);
          ctx.fill();
          if (sustaining && Math.random() < 0.6) {
            this.spawn('spark', x0 + (Math.random() - 0.5) * unit * 0.4, y, (Math.random() - 0.5) * 240, -120 - Math.random() * 300, 220, 2.2, Math.random() < 0.5 ? '#ffffff' : color, 700);
          }
        }
      }
    }
    if (sustaining) { ctx.restore(); return; }

    const columns = event.lanes.map(lane => layout.column(lane));
    if (event.lanes.length > 1) {
      const xs = columns.map(column => this.px(column, depth, timeMs));
      ctx.strokeStyle = missed ? 'rgba(160,160,170,.6)' : 'rgba(255,255,255,.85)';
      ctx.lineWidth = Math.max(2, 9 * scale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.min(...xs), y);
      ctx.lineTo(Math.max(...xs), y);
      ctx.stroke();
    }
    for (const lane of event.lanes) {
      const column = layout.column(lane);
      // Gems keep their lane color in overdrive, so the next chord stays readable.
      const color = missed ? '#666672' : layout.color(lane);
      const label = layout.gemLabel(lane);
      if (column < 0) {
        const half = this.half(depth) * 0.92;
        const height = Math.max(4, unit * 0.2);
        ctx.fillStyle = rgba(color, 0.92);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 3 * scale);
        ctx.beginPath();
        ctx.roundRect(this.x + this.w / 2 - half, y - height / 2, half * 2, height, height / 2);
        ctx.fill();
        ctx.stroke();
        if (scale > 0.45) {
          ctx.fillStyle = '#16102a';
          ctx.font = `800 ${Math.round(height * 0.72)}px "Barlow Condensed", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('SPACE', this.x + this.w / 2, y + 1);
        }
        continue;
      }
      const x = this.px(column, depth, timeMs);
      const width = unit * (layout.columns > 6 ? 0.98 : 0.86) * (SPRITE_W / 152);
      const height = width * SPRITE_H / SPRITE_W;
      ctx.drawImage(gemSprite(label && layout.columns > 6 ? 'round' : look.gem, color), x - width / 2, y - height * 82 / SPRITE_H, width, height);
      if (label) {
        const size = Math.max(9, unit * (layout.columns > 6 ? 0.46 : 0.3));
        ctx.font = `800 ${size}px "Barlow Condensed", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, size * 0.16);
        ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.strokeText(label, x, y - size * 0.16);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x, y - size * 0.16);
      }
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, dt: number) {
    const seconds = dt / 1000;
    ctx.save();
    let write = 0;
    for (const particle of this.particles) {
      particle.age += dt;
      if (particle.age >= particle.life) continue;
      this.particles[write++] = particle;
      particle.vy += (particle.gravity ?? 0) * seconds;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      const life = 1 - particle.age / particle.life;
      ctx.globalAlpha = Math.min(1, life * 1.6);
      if (particle.kind === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = particle.size * life + 0.5;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x - particle.vx * 0.035, particle.y - particle.vy * 0.035);
        ctx.stroke();
      } else if (particle.kind === 'ember') {
        ctx.globalCompositeOperation = 'lighter';
        const radius = particle.size * (0.4 + life * 0.8);
        const glow = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, radius);
        glow.addColorStop(0, 'rgba(255,255,255,.9)');
        glow.addColorStop(0.3, rgba(particle.color, 0.8));
        glow.addColorStop(1, rgba(particle.color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(particle.x - radius, particle.y - radius, radius * 2, radius * 2);
      } else if (particle.kind === 'ring') {
        ctx.globalCompositeOperation = 'lighter';
        const grow = 1 + (1 - life) * 1.4;
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 4 * life + 0.5;
        ellipse(ctx, particle.x, particle.y, particle.size * grow, particle.size * grow * 0.42);
        ctx.stroke();
      } else if (particle.kind === 'glyph' || particle.kind === 'text') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = particle.color;
        ctx.font = `800 ${Math.round(particle.size)}px "Barlow Condensed", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(particle.text ?? '', particle.x, particle.y);
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = particle.color;
        if (particle.kind === 'pixel') ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
        else {
          ctx.save();
          ctx.translate(particle.x, particle.y);
          ctx.rotate((particle.spin ?? 0) + particle.age / 90);
          ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
          ctx.restore();
        }
      }
    }
    this.particles.length = write;
    ctx.restore();
  }

  private drawJudgement(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.judge) return;
    const age = now - this.judge.at;
    if (age > 620) return;
    const pop = 1 + 0.45 * Math.exp(-age / 55);
    const size = Math.max(20, Math.min(54, this.w * 0.085)) * pop;
    const x = this.x + this.w / 2;
    const y = this.strikeY - this.h * 0.2 - age * 0.02;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (620 - age) / 200);
    ctx.font = `800 italic ${Math.round(size)}px "Barlow Condensed", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = 'rgba(8,4,14,.9)';
    ctx.strokeText(this.judge.text, x, y);
    ctx.fillStyle = this.judge.color;
    ctx.fillText(this.judge.text, x, y);
    if (this.judge.detail) {
      ctx.font = `800 ${Math.round(size * 0.36)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.lineWidth = size * 0.08;
      ctx.strokeText(this.judge.detail, x, y + size * 0.62);
      ctx.fillStyle = '#ffffffd0';
      ctx.fillText(this.judge.detail, x, y + size * 0.62);
    }
    ctx.restore();
  }
}

type Fan = { x: number; row: number; size: number; phase: number; arms: number; light: boolean };

export class StageRenderer {
  highways: Highway[] = [];
  /** 0 to 1. Drives how hard the crowd jumps and how many hands go up. */
  mood = 0.5;
  showCrowd = true;
  calm = false;
  private fans: Fan[] = [];
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private last = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 64; i++) {
      this.fans.push({ x: (i + Math.random() * 0.8) / 64, row: i % 3, size: 0.8 + Math.random() * 0.5, phase: Math.random() * 6.28, arms: Math.random(), light: Math.random() < 0.3 });
    }
    this.resize();
  }

  private drawCrowd(chart: Chart, timeMs: number, now: number) {
    const ctx = this.ctx;
    const pulse = beatPulse(chart, timeMs);
    const mood = this.mood;
    const unit = Math.max(9, Math.min(this.width, this.height * 1.6) / 60);
    const boosting = this.highways.some(highway => highway.scoring.boosting(timeMs));
    ctx.save();
    for (let row = 2; row >= 0; row--) {
      const shade = 4 + row * 5;
      ctx.fillStyle = `rgb(${shade + 4},${shade},${shade + 9})`;
      ctx.strokeStyle = ctx.fillStyle;
      for (const fan of this.fans) {
        if (fan.row !== row) continue;
        const radius = unit * fan.size * (1 - row * 0.14);
        const jump = this.calm ? 0 : (2 + 16 * mood) * pulse * (0.5 + 0.5 * Math.sin(fan.phase * 3)) + Math.sin(now / 600 + fan.phase) * 2;
        const x = fan.x * this.width;
        const y = this.height - radius * (0.2 + row * 1.25) - jump;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - radius * 1.35, y + radius * 0.8, radius * 2.7, radius * 3);
        if (fan.arms < mood * 1.1 - 0.25) {
          const sway = this.calm ? 0 : Math.sin(now / 240 + fan.phase) * radius * 0.5;
          ctx.lineWidth = radius * 0.55;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - radius * 1.1, y + radius);
          ctx.lineTo(x - radius * 1.5 + sway, y - radius * 1.9);
          ctx.moveTo(x + radius * 1.1, y + radius);
          ctx.lineTo(x + radius * 1.5 + sway, y - radius * 1.9);
          ctx.stroke();
          if (fan.light && (mood > 0.8 || boosting)) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const lx = x + radius * 1.5 + sway;
            const ly = y - radius * 2.2;
            const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius * 1.6);
            glow.addColorStop(0, boosting ? 'rgba(125,249,255,.9)' : 'rgba(255,230,150,.9)');
            glow.addColorStop(1, 'rgba(255,200,120,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(lx - radius * 1.6, ly - radius * 1.6, radius * 3.2, radius * 3.2);
            ctx.restore();
          }
        }
      }
    }
    ctx.restore();
  }

  resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = this.canvas.clientWidth || 800;
    this.height = this.canvas.clientHeight || 600;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.arrange();
  }

  arrange() {
    const count = this.highways.length || 1;
    const slot = this.width / count;
    this.highways.forEach((highway, index) => {
      const wide = highway.layout.columns > 6;
      const narrow = this.width < 700;
      const width = Math.min(slot * (count > 1 ? 0.96 : wide || narrow ? 1 : 0.74), this.height * (wide ? 1.55 : narrow ? 1.25 : 1.02));
      highway.w = width;
      highway.h = this.height;
      highway.x = slot * index + (slot - width) / 2;
      highway.y = 0;
    });
  }

  setHighways(highways: Highway[]) {
    this.highways = highways;
    this.arrange();
  }

  draw(chart: Chart, timeMs: number) {
    const now = performance.now();
    const dt = Math.min(64, this.last ? now - this.last : 16);
    this.last = now;
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (this.showCrowd) this.drawCrowd(chart, timeMs, now);
    for (const highway of this.highways) highway.draw(this.ctx, chart, timeMs, now, dt);
  }
}
