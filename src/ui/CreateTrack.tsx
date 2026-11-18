import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Music2 } from 'lucide-react';
import type { Job } from '../../shared/song';
import { useApp } from '../App';
import { call } from '../lib/api';
import { settingsStore, useCell } from '../state/store';
import AccountAccess from '../components/AccountAccess';
import { Screen } from './common';

const defaultPrompt = 'Punchy blues rock with a gritty electric guitar riff and a tight backbeat';
const stageText = { queued: 'Waiting to generate…', composing: 'Composing your track…', charting: 'Finding guitar notes and chords…' };
const IDEAS = ['Sunny reggae with a bouncing guitar skank', 'Fast bluegrass flatpicking at 150 BPM', 'Dreamy lo-fi hip hop with a clean jazz guitar', 'Epic power metal with a soaring lead', 'Disco funk with a wah guitar hook'];

export default function CreateTrack() {
  const app = useApp();
  const settings = useCell(settingsStore);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [seconds, setSeconds] = useState<30 | 90>(90);
  const [job, setJob] = useState<Job>();
  const [busy, setBusy] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ key: string; prompt: string; durationSeconds: number }>(null);
  const allowed = !!app.user || !!app.config?.localTest;
  const generating = !!job && job.stage !== 'ready' && job.stage !== 'failed';

  const open = async (id: string) => {
    await app.refreshSongs().catch(() => {});
    await app.launch(id, { mode: 'quickplay', difficulty: settings.difficulty, mods: [] }, { name: 'songs' });
  };

  useEffect(() => {
    if (!job || job.stage === 'ready' || job.stage === 'failed') return;
    const id = job.id;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await call(`/generations/${id}`).then(response => response.json()) as Job;
        if (!active) return;
        setReconnecting(false);
        setJob(next);
        if (next.stage === 'ready') void open(next.id);
        else if (next.stage !== 'failed') timer = setTimeout(poll, 900);
      } catch {
        if (active) { setReconnecting(true); timer = setTimeout(poll, 3000); }
      }
    };
    timer = setTimeout(poll, 500);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.stage === 'ready' || job?.stage === 'failed']);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const clean = prompt.trim();
    if (!request.current || request.current.prompt !== clean || request.current.durationSeconds !== seconds) {
      request.current = { prompt: clean, durationSeconds: seconds, key: crypto.randomUUID() };
    }
    try {
      const response = await call('/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.current) });
      const next = await response.json() as Job;
      request.current = null;
      setJob(next);
      if (next.stage === 'ready') await open(next.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start generation.');
    } finally { setBusy(false); }
  };

  const retry = async () => {
    if (!job || busy) return;
    setBusy(true);
    setError('');
    try { setJob(await call(`/generations/${job.id}/retry`, { method: 'POST' }).then(response => response.json())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not retry analysis.'); }
    finally { setBusy(false); }
  };

  return <Screen title="Create a track" eyebrow="Any style you can describe" onBack={() => app.go({ name: 'menu' })} className="create-screen">
    {!allowed ? <section className="panel">
      <h2>Sign in to compose</h2>
      <p>Guests can play the whole setlist. Composing a new song needs a free account, so your tracks stay in your library.</p>
      {app.auth ? <AccountAccess auth={app.auth} invite={false} /> : <p role="status">Sign-in is not set up on this server.</p>}
    </section> : <form className="panel composer" onSubmit={event => void generate(event)}>
      <h2><Music2 aria-hidden="true" /> Describe your music</h2>
      <label htmlFor="prompt" className="field">Describe your music
        <textarea id="prompt" maxLength={500} rows={3} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
      <div className="chips">{IDEAS.map(idea => <button type="button" key={idea} onClick={() => setPrompt(idea)}>{idea}</button>)}</div>
      <label className="field">Length<select value={seconds} onChange={event => setSeconds(Number(event.target.value) as 30 | 90)}>
        <option value={90}>Full track · 90s</option><option value={30}>Quick Play · 30s</option></select></label>
      <button className="primary big" disabled={!prompt.trim() || busy || generating}>Generate track</button>
      {generating && <div className="job" role="status">
        <p>{reconnecting ? 'Reconnecting to the studio…' : stageText[job.stage as keyof typeof stageText]}</p>
        <progress aria-label="Generating track" />
        {reconnecting && <button type="button" onClick={() => { setReconnecting(false); setJob(undefined); }}>Stop waiting</button>}
      </div>}
      {job?.stage === 'failed' && <div className="error" role="alert">
        <p>{job.error || 'Track generation failed.'}</p>
        {job.canRetryChart && <button type="button" disabled={busy} onClick={() => void retry()}>Retry chart analysis</button>}
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>}
  </Screen>;
}
