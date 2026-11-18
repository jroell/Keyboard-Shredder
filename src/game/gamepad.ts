/**
 * Guitar controllers and gamepads through the browser Gamepad API.
 * Guitar Hero and Rock Band guitars report frets as buttons, the strum bar as a d-pad and the whammy bar as an axis.
 */
export type Binding =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; dir: 1 | -1; rest: number };

export type PadMap = {
  /** Green, red, yellow, blue, orange. */
  frets: Binding[];
  strumDown: Binding;
  strumUp: Binding;
  overdrive: Binding[];
  pause: Binding;
  /** Axis index of the whammy bar, or -1. */
  whammy: number;
  /** 'strum': hold frets and strum, like the real games. 'tap': a fret press plays the note. */
  mode: 'strum' | 'tap';
};

const button = (index: number): Binding => ({ kind: 'button', index });

/** Xbox 360 style guitars with the standard gamepad layout: green A, red B, yellow Y, blue X, orange LB, strum on the d-pad. */
export const DEFAULT_PAD: PadMap = {
  frets: [button(0), button(1), button(3), button(2), button(4)],
  strumDown: button(13), strumUp: button(12),
  overdrive: [button(8), { kind: 'axis', index: 3, dir: 1, rest: 0 }],
  pause: button(9), whammy: 2, mode: 'strum',
};

export const PAD_STEPS = [
  'Green fret', 'Red fret', 'Yellow fret', 'Blue fret', 'Orange fret', 'Strum down', 'Strum up', 'Overdrive (Select, or tilt the neck)', 'Pause (Start)',
] as const;

function validBinding(value: unknown): value is Binding {
  const item = value as Binding;
  if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index > 63) return false;
  return item.kind === 'button' || (item.kind === 'axis' && (item.dir === 1 || item.dir === -1) && Number.isFinite(item.rest));
}

export function normalizePadMap(value: unknown): PadMap {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<PadMap>;
  const frets = Array.isArray(input.frets) && input.frets.length === 5 && input.frets.every(validBinding) ? input.frets : DEFAULT_PAD.frets;
  const overdrive = Array.isArray(input.overdrive) && input.overdrive.length > 0 && input.overdrive.length <= 3 && input.overdrive.every(validBinding)
    ? input.overdrive : DEFAULT_PAD.overdrive;
  return {
    frets, overdrive,
    strumDown: validBinding(input.strumDown) ? input.strumDown : DEFAULT_PAD.strumDown,
    strumUp: validBinding(input.strumUp) ? input.strumUp : DEFAULT_PAD.strumUp,
    pause: validBinding(input.pause) ? input.pause : DEFAULT_PAD.pause,
    whammy: Number.isInteger(input.whammy) && input.whammy! >= -1 && input.whammy! < 32 ? input.whammy! : DEFAULT_PAD.whammy,
    mode: input.mode === 'tap' ? 'tap' : 'strum',
  };
}

export function pads(): Gamepad[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  try { return [...navigator.getGamepads()].filter((pad): pad is Gamepad => !!pad && pad.connected); }
  catch { return []; }
}

export function looksLikeGuitar(pad: Gamepad) {
  return /guitar|harmonix|redoctane|rock ?band|gh ?live|1430|12ba|1bad|strat|les paul|xplorer/i.test(pad.id);
}

export function padName(pad: Gamepad) {
  return pad.id.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:.*?\)\s*$/i, '').trim() || 'Game controller';
}

export function active(pad: Gamepad, binding: Binding) {
  if (binding.kind === 'button') return !!pad.buttons[binding.index]?.pressed;
  const value = pad.axes[binding.index];
  return value !== undefined && (value - binding.rest) * binding.dir > 0.45;
}

export type PadState = {
  frets: boolean[]; strum: boolean; overdrive: boolean; pause: boolean;
  /** 0 at rest, 1 fully pressed. */
  whammy: number;
  /** `performance.now()` time of the reading. */
  at: number;
  /** Frets that changed since the last reading. */
  pressed: number[]; released: number[]; strumUp: boolean; strumDown: boolean;
};

/** Reads one controller and reports edges since the last poll. */
export class PadReader {
  private frets = [false, false, false, false, false];
  private down = false;
  private up = false;
  private drive = false;
  private paused = false;
  private whammyRest: number | null = null;

  constructor(readonly index: number) {}

  poll(map: PadMap): PadState | null {
    const pad = pads().find(item => item.index === this.index);
    if (!pad) return null;
    const frets = map.frets.map(binding => active(pad, binding));
    const down = active(pad, map.strumDown);
    const up = active(pad, map.strumUp);
    const drive = map.overdrive.some(binding => active(pad, binding));
    const paused = active(pad, map.pause);
    const pressed: number[] = [];
    const released: number[] = [];
    frets.forEach((value, lane) => { if (value !== this.frets[lane]) (value ? pressed : released).push(lane); });
    const raw = map.whammy >= 0 ? pad.axes[map.whammy] : undefined;
    if (raw !== undefined && this.whammyRest === null) this.whammyRest = raw;
    const whammy = raw === undefined || this.whammyRest === null ? 0 : Math.max(0, Math.min(1, Math.abs(raw - this.whammyRest) / 1.2));
    const state: PadState = {
      frets, pressed, released, whammy,
      strumDown: down && !this.down, strumUp: up && !this.up, strum: (down && !this.down) || (up && !this.up),
      overdrive: drive && !this.drive, pause: paused && !this.paused,
      at: Math.min(performance.now(), pad.timestamp || performance.now()),
    };
    this.frets = frets;
    this.down = down;
    this.up = up;
    this.drive = drive;
    this.paused = paused;
    return state;
  }
}

/** Snapshot used by the mapping wizard to spot which control moved. */
export function snapshot(pad: Gamepad) {
  return { buttons: pad.buttons.map(item => item.pressed), axes: [...pad.axes] };
}

export function changedControl(pad: Gamepad, before: ReturnType<typeof snapshot>): Binding | null {
  for (let index = 0; index < pad.buttons.length; index++) {
    if (pad.buttons[index].pressed && !before.buttons[index]) return { kind: 'button', index };
  }
  for (let index = 0; index < pad.axes.length; index++) {
    const rest = before.axes[index] ?? 0;
    const delta = pad.axes[index] - rest;
    if (Math.abs(delta) > 0.6) return { kind: 'axis', index, dir: delta > 0 ? 1 : -1, rest };
  }
  return null;
}

export function describe(binding: Binding) {
  return binding.kind === 'button' ? `Button ${binding.index + 1}` : `Axis ${binding.index + 1}${binding.dir > 0 ? '+' : '-'}`;
}

/** True while a song is being played, so menus ignore the controller. */
export const padFocus = { playing: false, mapping: false };

type HidDevice = { opened: boolean; open(): Promise<void>; sendReport(id: number, data: Uint8Array): Promise<void>; productName: string; vendorId: number; productId: number };
const GHL_DONGLES = [
  // PlayStation 3 and Wii U dongle, then PlayStation 4 dongle. Keep-alive bytes from the Linux hid-sony driver.
  { vendorId: 0x12ba, productId: 0x074b, report: 0x02, data: [0x08, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00] },
  { vendorId: 0x1430, productId: 0x07bb, report: 0x30, data: [0x02, 0x08, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00] },
];
let ghlTimer: ReturnType<typeof setInterval> | undefined;

export function canWakeGhl() {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

/**
 * Guitar Hero Live dongles stop sending input unless the host sends a keep-alive report every 8 seconds.
 * Asks the player to pick the dongle, then keeps it awake for as long as the page is open.
 */
export async function wakeGhlDongle(): Promise<string> {
  const hid = (navigator as unknown as { hid?: { requestDevice(options: { filters: { vendorId: number; productId: number }[] }): Promise<HidDevice[]> } }).hid;
  if (!hid) throw new Error('This browser cannot talk to the dongle. Use Chrome or Edge on a computer.');
  const [device] = await hid.requestDevice({ filters: GHL_DONGLES.map(({ vendorId, productId }) => ({ vendorId, productId })) });
  if (!device) throw new Error('No Guitar Hero Live dongle was chosen.');
  const dongle = GHL_DONGLES.find(item => item.vendorId === device.vendorId && item.productId === device.productId);
  if (!dongle) throw new Error('That device is not a supported Guitar Hero Live dongle.');
  if (!device.opened) await device.open();
  const poke = () => device.sendReport(dongle.report, new Uint8Array(dongle.data)).catch(() => {});
  await device.sendReport(dongle.report, new Uint8Array(dongle.data));
  clearInterval(ghlTimer);
  ghlTimer = setInterval(poke, 8000);
  return device.productName || 'Guitar Hero Live dongle';
}

/**
 * Lets a guitar or gamepad drive the menus: strum or d-pad moves, green confirms, red goes back,
 * yellow and blue step left and right. Returns a function that stops it.
 */
export function startMenuPad(getMap: () => PadMap) {
  let reader: PadReader | null = null;
  let frame = 0;
  const send = (code: string) => {
    const unhandled = window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }));
    if (!unhandled) return;
    const focused = document.activeElement as HTMLElement | null;
    if (code === 'Enter') {
      if (focused && focused !== document.body) focused.click();
      return;
    }
    if (code !== 'ArrowDown' && code !== 'ArrowUp') return;
    const items = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select, input, [role="option"]')]
      .filter(item => item.offsetParent !== null);
    if (!items.length) return;
    const index = focused ? items.indexOf(focused) : -1;
    items[(index + (code === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus();
  };
  const loop = () => {
    frame = requestAnimationFrame(loop);
    const pad = pads()[0];
    if (!pad) { reader = null; return; }
    if (!reader || reader.index !== pad.index) reader = new PadReader(pad.index);
    const input = reader.poll(getMap());
    if (!input || padFocus.playing || padFocus.mapping) return;
    if (input.strumDown) send('ArrowDown');
    if (input.strumUp) send('ArrowUp');
    if (input.pressed.includes(0)) send('Enter');
    // On the guitar settings panel the red fret only lights its test lamp.
    if (input.pressed.includes(1) && !document.querySelector('.guitar-setup')) send('Escape');
    if (input.pressed.includes(2)) send('ArrowLeft');
    if (input.pressed.includes(3)) send('ArrowRight');
  };
  frame = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(frame);
}
