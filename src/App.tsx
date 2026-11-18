import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { FirebaseOptions } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import { Guitar, Library, Music2, Play, SlidersHorizontal, Swords } from 'lucide-react';
import AccountAccess from './components/AccountAccess';
import PlayerProfile from './components/PlayerProfile';
import type { Profile } from '../shared/duel';
import SoloGame from './components/Game/SoloGame';
import PracticeSettings from './components/Game/PracticeSettings';
import { DEFAULT_PRACTICE, normalizePracticeConfig, practiceKeys, PRACTICE_PRESETS } from '../shared/practice';
import { DEFAULT_KEYS } from '../shared/scoring';
import { loadRecording, type Recording } from './lib/recording';
import type { Difficulty, Job, Song } from '../shared/song';

const DuelRoom = lazy(() => import('./components/Game/DuelRoom'));

type Config = { authEmulator?: string; firebase: FirebaseOptions | null; localTest: boolean; musicEnabled: boolean; legacyDatabaseId: string | null };
type LegacySong = { id: string; title: string; prompt?: string };
const defaultPrompt = 'Punchy blues rock with a gritty electric guitar riff and a tight backbeat';
const stageText = { queued: 'Waiting to generate…', composing: 'Composing your track…', charting: 'Finding guitar notes and chords…' };

function savedPractice() {
  try {
    return normalizePracticeConfig(JSON.parse(localStorage.getItem('keyboard-shredder-practice') || 'null'));
  } catch {
    return DEFAULT_PRACTICE;
  }
}

function savedSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('keyboard-shredder-controls') || '{}');
    return {
      keys: Array.isArray(saved.keys) && saved.keys.length === 5 && saved.keys.every(key => /^(Key[A-Z]|Digit[0-9])$/.test(key)) &&
        new Set(saved.keys).size === 5 ? saved.keys as string[] : DEFAULT_KEYS,
      calibration: Number.isFinite(saved.calibration) ? Math.max(-250, Math.min(250, saved.calibration)) : 0,
    };
  } catch {
    return { keys: DEFAULT_KEYS, calibration: 0 };
  }
}

async function apiError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return new Error(body.error || `Request failed (HTTP ${response.status}). Try again.`);
}

export default function App() {
  const [duelInvite, setDuelInvite] = useState<string | null>(() => new URLSearchParams(location.search).get('duel'));
  const [profile, setProfile] = useState<Profile>();
  const [profileError, setProfileError] = useState('');
  const [config, setConfig] = useState<Config>();
  const [auth, setAuth] = useState<Auth>();
  const [user, setUser] = useState<User | null>();
  const [songs, setSongs] = useState<Song[]>([]);
  const [legacy, setLegacy] = useState<LegacySong[]>([]);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [genreFilter, setGenreFilter] = useState('All tracks');
  const [lengthFilter, setLengthFilter] = useState('All lengths');
  const [practiceEnabled, setPracticeEnabled] = useState(false);
  const [practice, setPractice] = useState(savedPractice);
  const practiceLanes = useMemo(() => practiceKeys(practice), [practice]);
  useEffect(() => {
    try { localStorage.setItem('keyboard-shredder-practice', JSON.stringify(practice)); } catch { /* Storage is optional. */ }
  }, [practice]);
  const [seconds, setSeconds] = useState<30 | 90>(90);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [job, setJob] = useState<Job>();
  const [recording, setRecording] = useState<Recording>();
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(savedSettings);
  const [remapping, setRemapping] = useState<number>();
  const [remapStatus, setRemapStatus] = useState('');
  const request = useRef<{ key: string; prompt: string; durationSeconds: number }>(null);
  const busy = useRef(false);
  const canUseLibrary = config?.localTest || !!user;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;
    fetch('/api/config').then(async response => {
      if (!response.ok) throw await apiError(response);
      const next = await response.json() as Config;
      if (!active) return;
      setConfig(next);
      if (!next.firebase || next.localTest) return;
      const [{ initializeApp }, { connectAuthEmulator, getAuth, onAuthStateChanged }] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
      if (!active) return;
      const firebase = initializeApp(next.firebase);
      const client = getAuth(firebase);
      if (next.authEmulator) connectAuthEmulator(client, next.authEmulator, { disableWarnings: true });
      setAuth(client);
      unsubscribe = onAuthStateChanged(client, setUser);
    }).catch(() => { if (active) setError('Could not connect to the studio. Reload the page to try again.'); });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  const token = async () => {
    if (!config?.localTest) return user?.getIdToken();
    const key = new URLSearchParams(location.search).get('player');
    if (key && /^test-[a-z0-9]{1,40}$/.test(key)) sessionStorage.setItem('shredder-local-player', key);
    return sessionStorage.getItem('shredder-local-player') || 'test-player';
  };
  const call = async (path: string, options: RequestInit = {}) => {
    const bearer = await token();
    const response = await fetch('/api' + path, { ...options, headers: {
      ...options.headers, Authorization: `Bearer ${bearer || ''}`,
    }, signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw await apiError(response);
    return response;
  };

  useEffect(() => {
    if (!canUseLibrary) {
      setSongs([]);
      setProfile(undefined);
      setLegacy([]);
      setJob(undefined);
      setRecording(undefined);
      request.current = null;
      return;
    }
    let active = true;
    call('/profile').then(response => response.json()).then(value => { if (active) setProfile(value); })
      .catch(() => { if (active) setProfileError('Player profile unavailable. Reload to retry.'); });
    call('/songs').then(response => response.json()).then(items => { if (active) setSongs(items); })
      .catch(reason => { if (active) setError(reason.message); });
    if (user && auth && config?.legacyDatabaseId) {
      import('firebase/firestore/lite').then(({ collection, getFirestore, getDocs, query, where }) =>
        getDocs(query(collection(getFirestore(auth.app, config.legacyDatabaseId!), 'songs'), where('userId', '==', user.uid)))
      ).then(snapshot => {
        if (active) setLegacy(snapshot.docs.flatMap(doc => {
          const data = doc.data();
          return typeof data.audioUrl === 'string' && data.audioUrl.startsWith('blob:') ? [{
            id: doc.id, title: typeof data.title === 'string' ? data.title : 'Saved track',
            prompt: typeof data.genre === 'string' ? data.genre : undefined,
          }] : [];
        }));
      }).catch(() => { if (active) setError('Could not load older library entries.'); });
    }
    return () => { active = false; };
  }, [config, auth, user, canUseLibrary]);

  useEffect(() => {
    localStorage.setItem('keyboard-shredder-controls', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (remapping === undefined) return;
    const remap = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        setRemapping(undefined);
        setRemapStatus('Key change canceled.');
        return;
      }
      if (!/^(Key[A-Z]|Digit[0-9])$/.test(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const label = event.code.replace(/^(Key|Digit)/, '');
      const conflict = settings.keys.findIndex((key, i) => i !== remapping && key === event.code);
      if (conflict >= 0) {
        setRemapStatus(`${label} is already assigned to lane ${conflict + 1}. Choose another key.`);
        return;
      }
      setRemapStatus(`Lane ${remapping + 1} now uses ${label}.`);
      setSettings(previous => ({ ...previous, keys: previous.keys.map((key, i) => i === remapping ? event.code : key) }));
      setRemapping(undefined);
    };
    window.addEventListener('keydown', remap);
    return () => window.removeEventListener('keydown', remap);
  }, [remapping, settings.keys]);

  const openTrack = async (id: string) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const track = await loadRecording(call, `/songs/${id}`);
      setSongs(previous => previous.some(item => item.id === id) ? previous : [track.song, ...previous]);
      setRecording(track);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the track.');
    } finally {
      setLoading(false);
      busy.current = false;
    }
  };

  useEffect(() => {
    if (!job || job.stage === 'ready' || job.stage === 'failed' || !canUseLibrary) return;
    const id = job.id;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await call(`/generations/${id}`).then(response => response.json()) as Job;
        if (!active) return;
        setReconnecting(false);
        setJob(next);
        if (next.stage === 'ready') void openTrack(next.id);
        else if (next.stage !== 'failed') timer = setTimeout(poll, 900);
      } catch {
        if (active) {
          setReconnecting(true);
          timer = setTimeout(poll, 3000);
        }
      }
    };
    timer = setTimeout(poll, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [job?.id, job?.stage === 'ready' || job?.stage === 'failed', canUseLibrary, user]);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    const cleanPrompt = prompt.trim();
    if (!request.current || request.current.prompt !== cleanPrompt || request.current.durationSeconds !== seconds) {
      request.current = { prompt: cleanPrompt, durationSeconds: seconds, key: crypto.randomUUID() };
    }
    try {
      const response = await call('/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.current),
      });
      const next = await response.json() as Job;
      request.current = null;
      setJob(next);
      if (next.stage === 'ready') {
        busy.current = false;
        await openTrack(next.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start generation.');
    } finally {
      setLoading(false);
      busy.current = false;
    }
  };

  const retryChart = async () => {
    if (!job || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const response = await call(`/generations/${job.id}/retry`, { method: 'POST' });
      setJob(await response.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not retry analysis.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  async function saveProfile(value: Profile) {
    const response = await call('/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const saved: Profile = await response.json();
    setProfile(saved);
    return saved;
  }

  if (canUseLibrary && duelInvite !== null) return <Suspense fallback={<main className="studio"><p role="status">Opening duel…</p></main>}><DuelRoom key={user?.uid ?? 'local'} invite={duelInvite}
    token={token} call={call} songs={songs} difficulty={difficulty} profile={profile} {...settings}
    refresh={() => { void call('/profile').then(response => response.json()).then(setProfile).catch(() => {}); }}
    exit={() => { history.replaceState(null, '', location.pathname); setDuelInvite(null); }} /></Suspense>;

  const generating = !!job && job.stage !== 'ready' && job.stage !== 'failed';
  if (recording) return <main className="studio arcade-stage">
    <SoloGame key={recording.song.id} {...recording} difficulty={difficulty} profile={profile} {...settings}
      keys={practiceEnabled ? practiceLanes : settings.keys}
      practice={practiceEnabled ? PRACTICE_PRESETS[practice.preset].label : undefined}
      leave={() => setRecording(undefined)} />
  </main>;

  const featured = songs[0];
  const genres = [...new Set(songs.map(song => song.genre || 'My tracks'))];
  const setlist = songs.filter(song =>
    (genreFilter === 'All tracks' || (song.genre || 'My tracks') === genreFilter) &&
    (lengthFilter === 'All lengths' || (song.durationMs >= 60_000) === (lengthFilter === 'Full songs')));
  const durationLabel = (ms: number) => {
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };

  return <main className="studio arcade-studio">
    <header className="masthead"><div className="brand"><Guitar aria-hidden="true" /><span>Keyboard Shredder</span></div>
      <div className="arcade-nav">
        {canUseLibrary && <button disabled={generating || loading} onClick={() => setDuelInvite('')}><Swords size={17} aria-hidden="true" /> Head-to-head</button>}
        {user && <button disabled={generating || loading} onClick={() => void import('firebase/auth').then(({ signOut }) => signOut(auth!))}>Sign out</button>}
      </div>
    </header>
    <section className="hero arcade-hero">
      <h1>Keyboard<br />Shredder</h1>
      <p>{config?.musicEnabled ? 'Play the setlist, create your own riffs, or challenge a friend.'
        : 'Pick a track from the setlist or challenge a friend.'}</p>
      {canUseLibrary && featured && <div className="hero-action">
        <button className="primary" disabled={loading || generating} onClick={() => void openTrack(featured.id)}>
          <Play size={16} aria-hidden="true" />Play {featured.title}
        </button>
        <a href="#setlist">Browse setlist</a>
        <a href="#keyboard-practice">Keyboard practice</a>
        {config?.musicEnabled && <a href="#create-track">Create a track</a>}
      </div>}
    </section>
    {!config && !error && <p role="status">Connecting to the studio…</p>}
    {config && !canUseLibrary && (auth
      ? <AccountAccess auth={auth} invite={duelInvite !== null} />
      : <p role="status">The studio needs a Firebase sign-in configuration.</p>)}
    {error && <p className="error" role="alert">{error}</p>}
    {canUseLibrary && <div className="studio-grid">
      <section id="setlist" className="panel library arcade-library"><h2><Library aria-hidden="true" /> Setlist</h2>
        <div className="setlist-filters">
          <label>Genre<select value={genreFilter} onChange={event => setGenreFilter(event.target.value)}>
            <option>All tracks</option>{genres.map(genre => <option key={genre}>{genre}</option>)}
          </select></label>
          <label>Difficulty<select value={difficulty} onChange={event => setDifficulty(event.target.value as Difficulty)}>
            <option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option>
          </select></label>
          <label>Track length<select value={lengthFilter} onChange={event => setLengthFilter(event.target.value)}>
            <option>All lengths</option><option>Quick songs</option><option>Full songs</option>
          </select></label>
        </div>
        {songs.length > 0 && setlist.length === 0 && <p>No tracks match these filters.</p>}
        {!songs.length && !legacy.length && <p>Your tracks appear here after you generate them.</p>}
        {loading && !generating && <p role="status">Loading track…</p>}
        <ul>
          {setlist.map(song => <li key={song.id}>
            <div className="setlist-track"><span className="record-mark" aria-hidden="true" />
              <div><strong>{song.title}</strong><p>{song.credit && <>{song.credit.artist} · </>}{song.genre || 'My tracks'} · {durationLabel(song.durationMs)}</p>
                {song.credit && <p><a href={song.credit.source} target="_blank" rel="noreferrer">Source</a> · <a href={song.credit.licenseUrl} target="_blank" rel="noreferrer">{song.credit.license}</a></p>}</div>
            </div>
            <button aria-label={`Load ${song.title}`} disabled={loading || generating} onClick={() => void openTrack(song.id)}><Play size={15} aria-hidden="true" /></button>
          </li>)}
          {genreFilter === 'All tracks' && lengthFilter === 'All lengths' && legacy.map(song => <li key={song.id}><div><strong>{song.title}</strong><p>Original audio unavailable</p></div>
            {song.prompt && <button onClick={() => { setPrompt(song.prompt!); document.getElementById('prompt')?.focus(); }}>Use prompt</button>}</li>)}
        </ul>
      </section>
      <div>
        <section id="keyboard-practice" className="panel settings">
          <h2>Keyboard practice</h2>
          <label className="practice-toggle"><input type="checkbox" checked={practiceEnabled}
            onChange={event => setPracticeEnabled(event.target.checked)} /> Use practice keys in solo tracks</label>
          {practiceEnabled && <PracticeSettings value={practice} onChange={setPractice} />}
        </section>
        {config?.musicEnabled && <form id="create-track" className="panel composer" onSubmit={event => void generate(event)}>
          <h2><Music2 aria-hidden="true" /> Create a track</h2>
          <label htmlFor="prompt">Describe your music</label>
          <textarea id="prompt" maxLength={500} rows={3} value={prompt} onChange={event => setPrompt(event.target.value)} />
          <div className="controls">
            <label>Length<select value={seconds} onChange={event => setSeconds(Number(event.target.value) as 30 | 90)}>
              <option value={90}>Full track · 90s</option><option value={30}>Quick Play · 30s</option></select></label>
          </div>
          <button disabled={!prompt.trim() || loading || generating || !config?.musicEnabled}>Generate track</button>
          {generating && <div className="job" role="status">
            <p>{reconnecting ? 'Reconnecting to the studio…' : stageText[job.stage as keyof typeof stageText]}</p>
            <progress aria-label="Generating track" />
            {reconnecting && <button type="button" onClick={() => { setReconnecting(false); setJob(undefined); }}>Back to studio</button>}
          </div>}
          {job?.stage === 'failed' && <div className="error" role="alert">
            <p>{job.error || 'Track generation failed.'}</p>
            {job.canRetryChart && <button type="button" disabled={loading} onClick={() => void retryChart()}>Retry chart analysis</button>}
          </div>}
        </form>}
        {profile && <PlayerProfile key={user?.uid ?? 'local'} profile={profile} save={saveProfile} />}
        {profileError && <p role="status">{profileError}</p>}
        <details className="panel settings">
          <summary><SlidersHorizontal aria-hidden="true" /> Controls and timing</summary>
          <p>Choose a lane, then press a letter or number to remap it. Press Escape to cancel.</p>
          <div className="key-settings">{settings.keys.map((key, lane) => <button key={lane} type="button"
            aria-label={`Remap lane ${lane + 1}, current key ${key}`} aria-pressed={remapping === lane}
            onClick={() => { setRemapping(lane); setRemapStatus(`Press a new key for lane ${lane + 1}.`); }}>{remapping === lane ? '…' : key.replace(/^(Key|Digit)/, '')}</button>)}</div>
          <p role="status">{remapStatus}</p>
          <label>Timing offset (ms)<input type="number" min={-250} max={250} step={5} value={settings.calibration}
            onChange={event => setSettings(previous => ({ ...previous, calibration: Math.max(-250, Math.min(250, Number(event.target.value))) }))} /></label>
          <p>Increase the offset if your hits consistently register late.</p>
          <button type="button" onClick={() => { setRemapping(undefined); setRemapStatus('Default controls restored.'); setSettings({ keys: DEFAULT_KEYS, calibration: 0 }); }}>Reset controls</button>
        </details>
      </div>

    </div>}
  </main>;
}
