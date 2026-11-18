import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { badgeNames, palettes, type Duel, type LaneInput, type Profile, type Reply } from '../../../shared/duel';
import { TOUR_TRACKS, TOUR_VENUES, tourStart } from '../../../shared/tour';
import type { Difficulty, Song } from '../../../shared/song';
import { PlayerCard } from '../PlayerProfile';
import SoloGame from './SoloGame';
import { loadRecording, type Recording } from '../../lib/recording';

type Props = {
  invite: string; initialCoop?: boolean; token: () => Promise<string | undefined>; call: (path: string, options?: RequestInit) => Promise<Response>;
  songs: Song[]; difficulty: Difficulty; profile?: Profile; keys: string[]; calibration: number;
  exit: () => void; refresh: () => void;
};

export default function DuelRoom(props: Props) {
  const [duel, setDuel] = useState<Duel>();
  const [slot, setSlot] = useState<number>();
  const [songId, setSongId] = useState(props.songs[0]?.id || '');
  const [level, setLevel] = useState(props.difficulty);
  const [track, setTrack] = useState<Recording>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const socket = useRef<Socket>(null);
  const roomId = useRef(props.invite);
  const serverOffset = useRef(0);
  const current = useRef(props);
  current.current = props;

  useEffect(() => {
    let active = true;
    const client = io({ reconnectionAttempts: 8, transports: ['websocket'], auth: async callback => {
      try { callback({ token: await current.current.token() }); }
      catch { callback({ token: '' }); }
    } });
    socket.current = client;
    client.on('connect', async () => {
      setConnected(true);
      setSyncing(true);
      setError('');
      try {
        let best = Infinity;
        for (let i = 0; i < 5; i++) {
          const before = Date.now();
          const remote = await client.timeout(2500).emitWithAck('clock') as number;
          const after = Date.now();
          if (after - before < best) {
            best = after - before;
            serverOffset.current = remote - (before + after) / 2;
          }
        }
        if (active && roomId.current) await request(client, 'join-duel', roomId.current);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not join the duel.');
      } finally { if (active) setSyncing(false); }
    });
    client.on('connect_error', (reason: Error) => { setConnected(false); setError(reason.message); });
    client.on('disconnect', () => setConnected(false));
    client.on('duel', (next: Duel) => {
      setDuel(next);
      if (next.phase === 'finished') current.current.refresh();
    });
    client.on('duel-expired', () => { setDuel(undefined); setError('This invite has expired.'); });
    return () => { active = false; client.disconnect(); socket.current = null; };
  }, []);

  async function request(client: Socket, event: string, ...args: unknown[]) {
    const reply = await client.timeout(5000).emitWithAck(event, ...args) as Reply;
    if (reply.error) throw new Error(reply.error);
    if (reply.id) {
      roomId.current = reply.id;
      setSlot(reply.slot);
      history.replaceState(null, '', `?duel=${reply.id}`);
    }
  }

  const activeId = duel?.id;
  const activeSongId = duel?.song.id;
  const fetchTrack = useRef(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!activeId) return;
    const serial = ++fetchTrack.current;
    const api = current.current.call;
    loadRecording(api, `/duels/${activeId}`, `/duels/${activeId}/track`).then(recording => {
      if (serial === fetchTrack.current) setTrack(recording);
    }).catch(() => {
      if (serial === fetchTrack.current) setError('Could not load the shared track. Try again.');
    });
    return () => { fetchTrack.current++; };
  }, [activeId, activeSongId, reload]);

  async function send(event: string, ...args: unknown[]) {
    if (!socket.current?.connected) throw new Error('Reconnecting to the duel.');
    await request(socket.current, event, ...args);
  }
  function action(event: string, ...args: unknown[]) {
    setError('');
    void send(event, ...args).catch(reason => setError(reason.message));
  }
  async function leave() {
    try {
      if (socket.current?.connected) await send('leave-duel');
      else if (roomId.current) await props.call(`/duels/${roomId.current}/leave`, { method: 'POST' });
    } catch {
      setError('Could not reach the room to leave.');
    } finally { props.exit(); }
  }
  function copy() {
    const link = new URL(location.href);
    link.search = `?duel=${duel!.id}`;
    if (!navigator.clipboard) { setStatus('Select and copy the invite link below.'); return; }
    void navigator.clipboard.writeText(link.href).then(() => setStatus('Invite copied.')).catch(() => setStatus('Select and copy the invite link below.'));
  }
  const cooperative = duel ? duel.mode === 'coop' : !!props.initialCoop;
  const team = duel?.coop;
  const nextSong = TOUR_TRACKS.find(track => track.id === team?.nextSongId);
  const venue = TOUR_VENUES.find(venue => venue.tracks.some(track => track.id === duel?.song.id));
  const title = cooperative ? 'Co-op tour' : 'Head-to-head';
  const partner = cooperative ? 'Teammate' : 'Opponent';
  const me = duel?.players.find(player => player.slot === slot);
  const scheduled = useRef<{ epoch: number; perf: number }>(null);
  if (duel?.startAt && scheduled.current?.epoch !== duel.startAt) {
    scheduled.current = { epoch: duel.startAt, perf: performance.now() + duel.startAt - Date.now() - serverOffset.current };
  }

  return <main className="studio duel-studio" data-phase={duel?.phase}>
    <header className="masthead"><h1>{title}</h1><button onClick={() => void leave()}>{props.initialCoop ? 'Back to tour' : 'Back to studio'}</button></header>
    {!connected && <p role="status">Connecting to the duel… <button onClick={() => socket.current?.connect()}>Retry connection</button></p>}
    {error && <p role="alert" className="error">{error}</p>}
    {!duel && !props.invite && <section className="panel duel-host">
      <h2>{cooperative ? 'Share the stage' : 'Head-to-head'}</h2>
      <p>{cooperative ? 'Invite a teammate and continue from your next unlocked song. Your points count toward one team target.'
        : 'Pick a track and share the invite. Both players start on the same beat.'}</p>
      <div className="duel-fields">
      {!cooperative && <label>Track<select value={songId} onChange={event => setSongId(event.target.value)}>
        <option value="">Choose a track</option>{props.songs.map(song => <option key={song.id} value={song.id}>{song.title}</option>)}
      </select></label>}
      <label>{cooperative ? 'Co-op difficulty' : 'Duel difficulty'}<select value={level} onChange={event => setLevel(event.target.value as Difficulty)}>
        <option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option>
      </select></label>
      </div>
      {!cooperative && !props.songs.length && <p>Load a track in the studio to host a duel.</p>}
      <button className="primary" disabled={(!cooperative && !songId) || syncing || !connected}
        onClick={() => action('create-duel', cooperative ? { mode: 'coop', difficulty: level } : { songId, difficulty: level })}>Create invite</button>
    </section>}
    {duel && <>
      {duel.phase !== 'finished' && <div className={`duel-scoreboard duel-${duel.phase}`} aria-label={cooperative ? 'Team scoreboard' : 'Duel scoreboard'}>
        {duel.players.map(player => <section key={player.slot} className="panel duel-player">
          <PlayerCard profile={player.profile} />
          <p>{player.slot === slot ? 'You' : partner} · {!player.connected ? 'Disconnected' : duel.phase === 'lobby' ? player.ready ? 'Ready' : 'Getting ready' : `${player.combo} combo`}</p>
          <strong>{player.score.toLocaleString()} pts</strong>{duel.phase !== 'lobby' && <p>{player.hits > 0 && player.accuracy === 0 ? '<1' : player.accuracy}% accuracy</p>}
          {duel.phase === 'playing' && <div className="duel-frets" aria-hidden="true">
            {palettes[player.profile.palette].map((color, lane) => <i key={lane} style={{ color }}
              className={player.strike?.lanes.includes(lane) ? player.strike.missed ? 'missed' : 'active' : player.frets.includes(lane) ? 'active' : ''} />)}
          </div>}
        </section>)}
        {duel.players.length < 2 && <section className="panel">Waiting for {cooperative ? 'a teammate' : 'an opponent'}</section>}
      </div>}
      {team && duel.phase !== 'canceled' && duel.phase !== 'finished' && <div className="team-target" aria-label="Team score">
        <strong>{team.teamScore.toLocaleString()} / {team.targetScore.toLocaleString()} team points</strong>
        <progress aria-label="Team target" value={Math.min(team.teamScore, team.targetScore)} max={team.targetScore} />
      </div>}
      {duel.phase === 'lobby' && <div className="duel-invite">
        {slot === duel.host && <details className="panel" open={duel.players.length < 2}>
          <summary>{cooperative ? 'Invite a teammate' : 'Share this duel'}</summary>
          <label>Invite link<input readOnly value={`${location.origin}${location.pathname}?duel=${duel.id}`} onFocus={event => event.target.select()} /></label>
          <button onClick={copy}>Copy invite</button><p role="status">{status}</p>
        </details>}
        {venue && <p>{venue.name} · {duel.song.title}</p>}
        <p>Ready up to start. Playback continues if you switch tabs.</p>
      </div>}
      {duel.phase === 'finished' && <section className="panel results stage-results finale duel-finale" aria-live="polite">
        <h2>{team ? team.teamPassed ? tourStart(team.progress) ? 'Song cleared' : 'Tour complete' : 'Target missed'
          : duel.winner === null ? 'Draw' : duel.winner === slot ? 'You won' : 'Your opponent won'}</h2>
        {team && <p>{team.teamScore.toLocaleString()} of {team.targetScore.toLocaleString()} team points
          {team.teamPassed && nextSong && <> · Next up {nextSong.title}</>}</p>}
        <div className="duel-final-scores">
          {duel.players.map(player => <div key={player.slot}>
            <PlayerCard profile={player.profile} />
            <span>{player.slot === slot ? 'You' : partner}</span>
            <strong>{player.score.toLocaleString()}</strong>
            <p>{player.hits} {player.hits === 1 ? 'note' : 'notes'} hit · Best combo {player.bestCombo}</p>
          </div>)}
        </div>
        {duel.reason && <p role="status">{duel.reason}</p>}
        {!cooperative && !!me?.profile.badges.length && <p>Earned badges: {me.profile.badges.map(badge => badgeNames[badge]).join(', ')}</p>}
        {slot === duel.host && <button className="primary" disabled={duel.players.length < 2 || !duel.players.every(player => player.connected) || !connected}
          onClick={() => action(nextSong ? 'advance-coop' : 'rematch')}>
          {nextSong ? 'Continue tour' : cooperative ? 'Replay song' : 'Set up rematch'}</button>}
        {slot !== duel.host && <p>{cooperative ? 'The host chooses when to continue.' : 'The host can set up a rematch.'}</p>}
      </section>}
      {duel.phase === 'canceled' && <p role="status">{duel.reason}</p>}
      {(duel.phase === 'lobby' || duel.phase === 'playing') && (track?.song.id === duel.song.id
        ? <SoloGame key={duel.round ?? duel.id} {...track} difficulty={duel.difficulty} keys={props.keys} calibration={props.calibration}
          profile={props.profile} leave={() => void leave()} match={{
            startAt: duel.startAt ? scheduled.current?.perf ?? null : null, ready: !!me?.ready,
            ampCharge: me?.ampCharge ?? 0, boostEndMs: me?.boostEndMs ?? null, combo: me?.combo ?? 0,
            onReady: () => send('duel-ready', true),
            onBoost: timeMs => { if (socket.current?.connected) socket.current.emit('duel-boost', timeMs); },
            onInput: (input: LaneInput) => { if (socket.current?.connected) socket.current.emit('duel-input', input); },
          }} />
        : <div className="panel"><p role="status">Loading the shared track…</p>{error && <button onClick={() => { setError(''); setReload(count => count + 1); }}>Retry track</button>}</div>)}
    </>}
  </main>;
}
