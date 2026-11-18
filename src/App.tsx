import { Component, createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FirebaseOptions } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Profile } from '../shared/duel';
import type { Song } from '../shared/song';
import { DIFFICULTIES, difficultyNames, isDifficulty } from '../shared/difficulty';
import { normalizeMods } from '../shared/modifiers';
import { isTourSongCleared, TOUR_TRACKS } from '../shared/tour';
import { TYPING_LESSONS, type TypingLesson } from '../shared/typing';
import { call, fetchSongs, guestToken, setTokenSource } from './lib/api';
import { loadRecording, type Recording } from './lib/recording';
import { previewSong, stopPreview } from './lib/preview';
import { sfx } from './game/sfx';
import { startMenuPad } from './game/gamepad';
import { saveStore, setStore, settingsStore, tourStore, useCell } from './state/store';
import GameScreen, { type RunResult, type RunSetup } from './ui/GameScreen';
import Title from './ui/Title';
import MainMenu from './ui/MainMenu';

const screens = {
  songs: () => import('./ui/SongSelect'), tour: () => import('./ui/TourScreen'), academy: () => import('./ui/Academy'),
  party: () => import('./ui/PartySetup'), online: () => import('./ui/Online'), locker: () => import('./ui/Locker'),
  settings: () => import('./ui/SettingsScreen'), create: () => import('./ui/CreateTrack'),
};
const SongSelect = lazy(screens.songs);
const TourScreen = lazy(screens.tour);
const Academy = lazy(screens.academy);
const PartySetup = lazy(screens.party);
const Online = lazy(screens.online);
const Locker = lazy(screens.locker);
const SettingsScreen = lazy(screens.settings);
const CreateTrack = lazy(screens.create);

/** A screen that fails to load (for example when the connection drops) offers a retry instead of a blank page. */
class ScreenBoundary extends Component<{ onMenu: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="screen notice-screen"><section className="panel notice" role="alert">
      <h2>This screen did not load</h2>
      <p>Check your connection, then try again.</p>
      <div className="modal-actions">
        <button className="primary" onClick={() => location.reload()}>Reload and try again</button>
        <button onClick={() => { this.setState({ failed: false }); this.props.onMenu(); }}>Back to menu</button>
      </div>
    </section></main>;
  }
}

export type Config = { authEmulator?: string; firebase: FirebaseOptions | null; localTest: boolean; musicEnabled: boolean; legacyDatabaseId: string | null; guest?: boolean };
export type ScreenName = 'title' | 'menu' | 'songs' | 'tour' | 'academy' | 'party' | 'online' | 'locker' | 'settings' | 'create';
export type Route =
  | { name: Exclude<ScreenName, 'online'> }
  | { name: 'online'; invite: string; coop: boolean }
  | { name: 'play'; recording: Recording; setup: RunSetup; back: Route };

export type AppApi = {
  config?: Config; auth?: Auth; user: User | null | undefined; songs: Song[]; profile?: Profile;
  go: (route: Route) => void;
  launch: (songId: string, setup: RunSetup, back: Route) => Promise<void>;
  startLesson: (lesson: TypingLesson, back?: Route) => Promise<void>;
  refreshSongs: () => Promise<void>;
  saveProfile: (value: Profile) => Promise<Profile>;
  refreshProfile: () => void;
  loading: string;
  error: string;
  setError: (message: string) => void;
};

const AppContext = createContext<AppApi | null>(null);
/** A song counts as cleared in this run when 60% of its notes were hit, with stray presses counted against it. */
export function songCleared(summary: { perfects: number; greats: number; goods: number; totalNotes: number; wrongKeys: number }) {
  return (summary.perfects + summary.greats + summary.goods) / Math.max(1, summary.totalNotes + summary.wrongKeys) >= 0.6;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('App context is missing.');
  return value;
}

function localPlayer() {
  const key = new URLSearchParams(location.search).get('player');
  const requested = key && /^test-[a-z0-9]{1,40}$/.test(key) ? key : null;
  try {
    if (requested) sessionStorage.setItem('shredder-local-player', requested);
    return sessionStorage.getItem('shredder-local-player') || 'test-player';
  } catch {
    return requested ?? 'test-player';
  }
}

type Challenge = { songId: string; setup: RunSetup };
function readChallenge(): Challenge | null {
  const raw = new URLSearchParams(location.search).get('c');
  if (!raw) return null;
  const [songId, difficulty, score, name, mods = ''] = raw.split('~');
  if (!/^[a-z0-9-]{1,80}$/i.test(songId ?? '') || !isDifficulty(difficulty) || !Number.isFinite(Number(score))) return null;
  return { songId, setup: {
    mode: 'challenge', difficulty, mods: normalizeMods(mods.split('+')),
    challenge: { name: (name || 'A friend').replace(/[^\p{L}\p{N} ._'-]/gu, '').slice(0, 24) || 'A friend', score: Math.max(0, Math.round(Number(score))) },
  } };
}

export default function App() {
  const [config, setConfig] = useState<Config>();
  const [auth, setAuth] = useState<Auth>();
  const [user, setUser] = useState<User | null>();
  const [songs, setSongs] = useState<Song[]>([]);
  const [profile, setProfile] = useState<Profile>();
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const invite = useMemo(() => new URLSearchParams(location.search).get('duel'), []);
  const challenge = useMemo(readChallenge, []);
  const [notice, setNotice] = useState(() => !readChallenge() && new URLSearchParams(location.search).has('c')
    ? 'That challenge link is not valid. It may have been cut short when it was copied.' : '');
  // After switching player the game reloads. Land on the menu and say who is playing.
  const switched = useMemo(() => { try { const flag = sessionStorage.getItem('ks:switched'); sessionStorage.removeItem('ks:switched'); return !!flag; } catch { return false; } }, []);
  const [welcome, setWelcome] = useState(switched);
  useEffect(() => { if (!welcome) return; const timer = setTimeout(() => setWelcome(false), 4000); return () => clearTimeout(timer); }, [welcome]);
  const [route, setRoute] = useState<Route>(invite !== null ? { name: 'online', invite, coop: false } : switched ? { name: 'menu' } : { name: 'title' });
  const busy = useRef(false);
  const settings = useCell(settingsStore);
  const save = useCell(saveStore);

  useEffect(() => { sfx.volume = settings.sfxVolume; }, [settings.sfxVolume]);
  useEffect(() => startMenuPad(() => settingsStore.get().pad), []);
  // Fetch the other screens in the background, so the menus keep working if the connection drops later.
  useEffect(() => {
    const timer = setTimeout(() => { for (const load of Object.values(screens)) void load().catch(() => {}); }, 2500);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => { document.documentElement.dataset.calm = settings.calm ? 'true' : 'false'; }, [settings.calm]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;
    fetch('/api/config').then(async response => {
      if (!response.ok) throw new Error('config');
      const next = await response.json() as Config;
      if (!active) return;
      if (next.localTest) setTokenSource(async () => localPlayer());
      setConfig(next);
      if (!next.firebase || next.localTest) { setUser(null); return; }
      const [{ initializeApp }, { connectAuthEmulator, getAuth, onAuthStateChanged }] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
      if (!active) return;
      const client = getAuth(initializeApp(next.firebase));
      if (next.authEmulator) connectAuthEmulator(client, next.authEmulator, { disableWarnings: true });
      setAuth(client);
      unsubscribe = onAuthStateChanged(client, current => {
        setTokenSource(async () => current ? current.getIdToken() : guestToken());
        setUser(current);
      });
    }).catch(() => { if (active) setError('Could not reach the game server. Reload the page to try again.'); });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  // Quiet music behind the menus, once the player has pressed a key on the title screen.
  const menuSong = useRef('');
  useEffect(() => {
    const quiet = ['menu', 'tour', 'academy', 'party', 'locker', 'settings', 'create'].includes(route.name);
    if (!quiet || !songs.length) {
      if (route.name !== 'songs') stopPreview();
      return;
    }
    const starters = songs.filter(song => song.model === 'starter-setlist' && song.durationMs < 60_000);
    if (!starters.length) return;
    menuSong.current ||= starters[Math.floor(Math.random() * starters.length)].id;
    previewSong(menuSong.current, settings.musicVolume * 0.45);
  }, [route.name, songs, settings.musicVolume]);

  const ready = !!config && user !== undefined;
  const refreshSongs = useCallback(() => fetchSongs().then(setSongs), []);
  const refreshProfile = useCallback(() => {
    void call('/profile').then(response => response.json()).then(setProfile).catch(() => {});
  }, []);
  useEffect(() => {
    if (!ready) return;
    refreshSongs().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load the setlist.'));
    refreshProfile();
  }, [ready, user, refreshSongs, refreshProfile]);

  // The stage name and lane colors chosen on this device follow the player online.
  const synced = useRef('');
  useEffect(() => {
    if (!profile || !save.name) return;
    const wanted = `${save.name}|${settings.palette}`;
    if (synced.current === wanted || (profile.name === save.name && profile.palette === settings.palette)) return;
    synced.current = wanted;
    void call('/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...profile, name: save.name, palette: settings.palette }) })
      .then(response => response.json()).then(setProfile).catch(() => {});
  }, [profile, save.name, settings.palette]);

  const go = useCallback((next: Route) => {
    setError('');
    setWelcome(false);
    if (next.name !== 'online' && new URLSearchParams(location.search).has('duel')) history.replaceState(null, '', location.pathname);
    setRoute(next);
  }, []);

  const launch = useCallback(async (songId: string, setup: RunSetup, back: Route) => {
    if (busy.current) return;
    busy.current = true;
    setLoading('Tuning up…');
    setError('');
    stopPreview();
    try {
      const recording = await loadRecording(call, `/songs/${songId}`);
      setRoute({ name: 'play', recording, setup, back });
    } catch (reason) {
      setError(reason instanceof Error && !/fetch|network|load failed/i.test(reason.message) ? reason.message : 'Could not load this song. Check your connection and try again.');
    } finally {
      setLoading('');
      busy.current = false;
    }
  }, []);

  const startLesson = useCallback((lesson: TypingLesson, back: Route = { name: 'academy' }) => launch(lesson.songId, {
    mode: 'typing', difficulty: lesson.difficulty, mods: [],
    typing: { lesson, options: { keys: lesson.keys, newKeys: lesson.newKeys, kind: lesson.kind, difficulty: lesson.difficulty, seed: Date.now() % 100_000, minLength: lesson.id === 'longer-words' ? 5 : undefined } },
  }, back), [launch]);

  const saveProfile = useCallback(async (value: Profile) => {
    const response = await call('/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const saved: Profile = await response.json();
    setProfile(saved);
    return saved;
  }, []);

  // A challenge link opens straight into the song once the setlist is known.
  const challenged = useRef(false);
  useEffect(() => {
    if (!challenge || challenged.current || !ready || !songs.length) return;
    challenged.current = true;
    history.replaceState(null, '', location.pathname);
    if (!songs.some(song => song.id === challenge.songId)) { setNotice('That challenge is for a song that is not in the setlist any more.'); return; }
    void launch(challenge.songId, challenge.setup, { name: 'menu' });
  }, [challenge, ready, songs, launch]);

  const api: AppApi = { config, auth, user, songs, profile, go, launch, startLesson, refreshSongs, saveProfile, refreshProfile, loading, error, setError };

  const recorded = useRef<RunResult>(null);
  const next = useCallback((result: RunResult) => {
    if (route.name !== 'play') return undefined;
    const { setup, recording, back } = route;
    if (setup.practice) return undefined;
    if (setup.set) {
      const { set } = setup;
      const score = set.score + result.summary.score;
      const ratings = [...set.ratings, result.summary.rating];
      const last = set.index + 1 >= set.ids.length || result.summary.failed;
      if (result.summary.failed || !songCleared(result.summary)) return { label: 'Restart the set', run: () => void launch(set.ids[0], { ...setup, set: { ...set, index: 0, score: 0, ratings: [], scores: [] } }, back) };
      if (!last) return { label: `Next song: ${songs.find(song => song.id === set.ids[set.index + 1])?.title ?? 'next'}`,
        run: () => void launch(set.ids[set.index + 1], { ...setup, set: { ...set, index: set.index + 1, score, ratings, scores: [...(set.scores ?? []), result.summary.score] } }, back) };
      if (!result.summary.failed && recorded.current !== result) {
        recorded.current = result;
        const rating = ratings.reduce((total, value) => total + value, 0) / ratings.length;
        const key = `${set.name}:${setup.difficulty}`;
        const previous = setStore.get()[key];
        const platinum = ratings.every(value => value >= 85) || !!previous?.platinum;
        if (!previous || score > previous.score || rating > previous.rating || platinum !== !!previous.platinum) {
          setStore.set(all => ({ ...all, [key]: { score: Math.max(score, previous?.score ?? 0), rating: Math.max(rating, previous?.rating ?? 0), ...(platinum ? { platinum } : {}) } }));
        }
      }
      return undefined;
    }
    if (setup.tutorial) return { label: 'Pick a song', run: () => go({ name: 'songs' }) };
    if (result.summary.failed && !setup.typing && !setup.party && !setup.daily && !setup.challenge) {
      const easier = DIFFICULTIES[DIFFICULTIES.indexOf(setup.difficulty) - 1];
      return easier ? { label: `Try ${difficultyNames[easier]}`, run: () => void launch(recording.song.id, { ...setup, difficulty: easier, mods: setup.mods.filter(id => id !== 'sudden') }, back) } : undefined;
    }
    if (setup.tour) {
      const progress = tourStore.get();
      const index = TOUR_TRACKS.findIndex(track => track.id === recording.song.id);
      const following = TOUR_TRACKS[index + 1];
      if (following && isTourSongCleared(recording.song.id, progress)) {
        return { label: `Next: ${following.title}`, run: () => void launch(following.id, setup, back) };
      }
      return undefined;
    }
    if (setup.typing?.lesson) {
      const following = result.outcome.lesson?.passed
        ? TYPING_LESSONS[TYPING_LESSONS.findIndex(lesson => lesson.id === setup.typing!.lesson!.id) + 1] : undefined;
      return following ? { label: `Next: ${following.title}`, run: () => void startLesson(following, back) } : undefined;
    }
    if (setup.mode === 'quickplay' && !result.summary.failed) {
      const index = songs.findIndex(song => song.id === recording.song.id);
      const following = songs[(index + 1) % songs.length];
      if (following && following.id !== recording.song.id) return { label: `Next: ${following.title}`, run: () => void launch(following.id, setup, back) };
    }
    return undefined;
  }, [route, songs, go, launch, startLesson]);

  let view: ReactNode;
  if (route.name === 'play') {
    view = <GameScreen key={`${route.recording.song.id}:${route.setup.set?.index ?? ''}:${route.setup.mode}:${route.setup.difficulty}:${route.setup.typing?.lesson?.id ?? ''}:${JSON.stringify(route.setup.practice ?? '')}`}
      retune={setup => setRoute({ ...route, setup })}
      recording={route.recording} setup={route.setup} onExit={() => go(route.back)} next={next}
      exitLabel={route.back.name === 'tour' ? 'Back to tour' : route.back.name === 'party' ? 'Change song or players' : route.back.name === 'academy' ? 'Back to academy' : route.back.name === 'songs' ? 'Back to songs' : 'Back to menu'} />;
  } else if (route.name === 'title') {
    view = <Title ready={ready && !notice} onStart={() => go({ name: 'menu' })} />;
  } else if (route.name === 'menu') {
    view = <MainMenu />;
  } else {
    view = <ScreenBoundary onMenu={() => go({ name: 'menu' })}><Suspense fallback={<main className="screen"><p role="status" className="loading-line">Loading…</p></main>}>
      {route.name === 'songs' && <SongSelect />}
      {route.name === 'tour' && <TourScreen />}
      {route.name === 'academy' && <Academy />}
      {route.name === 'party' && <PartySetup />}
      {route.name === 'online' && (ready ? <Online key={`${user?.uid ?? 'guest'}:${route.invite ? 'join' : 'host'}`} invite={route.invite} initialCoop={route.coop} />
        : <main className="screen"><p role="status" className="loading-line">Connecting…</p></main>)}
      {route.name === 'locker' && <Locker />}
      {route.name === 'settings' && <SettingsScreen />}
      {route.name === 'create' && <CreateTrack />}
    </Suspense></ScreenBoundary>;
  }

  return <AppContext.Provider value={api}>
    <div className="app" data-route={route.name} data-level={save.xp > 0 ? 'known' : 'new'}>
      {view}
      {loading && <div className="loading-veil" role="status"><div className="loading-amp"><i /><i /><i /><i /><i /></div><p>{loading}</p></div>}
      {notice && <div className="modal-veil"><section className="modal" role="alertdialog" aria-labelledby="notice-title">
        <h2 id="notice-title">Link not found</h2>
        <p>{notice}</p>
        <div className="modal-actions">
          <button className="primary" autoFocus onClick={() => { setNotice(''); history.replaceState(null, '', location.pathname); go({ name: 'songs' }); }}>Pick a song</button>
          <button onClick={() => { setNotice(''); history.replaceState(null, '', location.pathname); go({ name: 'menu' }); }}>Main menu</button>
        </div>
      </section></div>}
      {welcome && <div className="toast" role="status">Now playing as {save.name || 'a new player'}.</div>}
      {error && route.name !== 'play' && <div className="toast error" role="alert">{error}<button className="link" onClick={() => setError('')}>Dismiss</button></div>}
    </div>
  </AppContext.Provider>;
}
