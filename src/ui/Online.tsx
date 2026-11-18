import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Crown, Handshake, Swords } from 'lucide-react';
import { badgeNames, palettes, type Duel, type LaneInput, type Reply } from '../../shared/duel';
import { DIFFICULTIES, difficultyNames } from '../../shared/difficulty';
import { gradeFor } from '../../shared/rating';
import { TOUR_TRACKS, TOUR_VENUES, tourStart } from '../../shared/tour';
import type { Difficulty } from '../../shared/song';
import { useApp } from '../App';
import { call, token } from '../lib/api';
import { loadRecording, type Recording } from '../lib/recording';
import { sfx } from '../game/sfx';
import { completeRun } from '../state/progress';
import { settingsStore, useCell } from '../state/store';
import { PlayerCard } from './Profile';
import GameScreen from './GameScreen';
import { Screen } from './common';

export default function Online({ invite, initialCoop }: { invite: string; initialCoop: boolean }) {
  const app = useApp();
  const settings = useCell(settingsStore);
  const [duel, setDuel] = useState<Duel>();
  const [slot, setSlot] = useState<number>();
  const [coop, setCoop] = useState(initialCoop);
  const [songId, setSongId] = useState('');
  const [level, setLevel] = useState<Difficulty>(settings.difficulty);
  const [track, setTrack] = useState<Recording>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const socket = useRef<Socket>(null);
  const roomId = useRef(invite);
  const serverOffset = useRef(0);
  const refresh = useRef(app.refreshProfile);
  refresh.current = app.refreshProfile;
  const awarded = useRef('');

  useEffect(() => {
    let active = true;
    const client = io({ reconnectionAttempts: 8, transports: ['websocket'], auth: async callback => {
      try { callback({ token: await token() }); }
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
        if (active) setError(reason instanceof Error ? reason.message : 'Could not join the game.');
      } finally { if (active) setSyncing(false); }
    });
    client.on('connect_error', (reason: Error) => { setConnected(false); setError(reason.message); });
    client.on('disconnect', () => setConnected(false));
    client.on('duel', (next: Duel) => {
      setDuel(next);
      if (next.phase === 'finished') refresh.current();
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
    loadRecording(call, `/duels/${activeId}`, `/duels/${activeId}/track`).then(recording => {
      if (serial === fetchTrack.current) setTrack(recording);
    }).catch(() => {
      if (serial === fetchTrack.current) setError('Could not load the shared track. Try again.');
    });
    return () => { fetchTrack.current++; };
  }, [activeId, activeSongId, reload]);

  async function send(event: string, ...args: unknown[]) {
    if (!socket.current?.connected) throw new Error('Reconnecting to the game.');
    await request(socket.current, event, ...args);
  }
  function action(event: string, ...args: unknown[]) {
    setError('');
    sfx.play('ui-select');
    void send(event, ...args).catch(reason => setError(reason.message));
  }
  async function leave() {
    try {
      if (socket.current?.connected) await send('leave-duel');
      else if (roomId.current) await call(`/duels/${roomId.current}/leave`, { method: 'POST' });
    } catch { /* The room times out on its own. */ }
    finally { app.go(initialCoop ? { name: 'tour' } : { name: 'menu' }); }
  }
  const inviteLink = duel ? `${location.origin}${location.pathname}?duel=${duel.id}` : '';
  function copy() {
    if (!navigator.clipboard) { setStatus('Select and copy the invite link.'); return; }
    void navigator.clipboard.writeText(inviteLink).then(() => setStatus('Invite copied. Send it to your friend.')).catch(() => setStatus('Select and copy the invite link.'));
  }

  const cooperative = duel ? duel.mode === 'coop' : coop;
  const team = duel?.coop;
  const nextSong = TOUR_TRACKS.find(item => item.id === team?.nextSongId);
  const venue = TOUR_VENUES.find(item => item.tracks.some(song => song.id === duel?.song.id));
  const partner = cooperative ? 'Teammate' : 'Opponent';
  const me = duel?.players.find(player => player.slot === slot);
  const other = duel?.players.find(player => player.slot !== slot);
  const scheduled = useRef<{ epoch: number; perf: number }>(null);
  if (duel?.startAt && scheduled.current?.epoch !== duel.startAt) {
    scheduled.current = { epoch: duel.startAt, perf: performance.now() + duel.startAt - Date.now() - serverOffset.current };
  }

  // Online games earn experience like any other run.
  useEffect(() => {
    if (!duel || duel.phase !== 'finished' || !me || awarded.current === duel.round) return;
    awarded.current = duel.round;
    const won = cooperative ? !!team?.teamPassed : duel.winner === slot;
    sfx.play(won ? 'crowd-roar' : 'crowd-clap');
    const tally = { perfects: 0, greats: me.hits, goods: 0, misses: 0, wrongKeys: 0, total: Math.max(1, me.hits), bestCombo: me.bestCombo };
    completeRun({
      songId: duel.song.id, mode: cooperative ? 'coop' : 'versus', difficulty: duel.difficulty, mods: [], score: me.score, rating: me.accuracy,
      stars: 0, grade: gradeFor(tally), perfects: 0, greats: me.hits, goods: 0, misses: 0, wrongKeys: 0, totalNotes: me.hits, bestCombo: me.bestCombo,
      fullCombo: false, failed: cooperative ? !team?.teamPassed : false, boostsUsed: 0, durationMs: duel.song.durationMs, won: !cooperative && won, genre: duel.song.genre,
    });
  }, [duel, me, cooperative, team, slot]);

  if (!duel) {
    return <Screen title={coop ? 'Tour together' : 'Play online'} eyebrow="Send a link, play in sync" onBack={() => void leave()} className="online-screen">
      {!connected && <p role="status" className="muted">Connecting… <button className="link" onClick={() => socket.current?.connect()}>Retry</button></p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!invite && <>
        <div className="party-modes" role="radiogroup" aria-label="Game type">
          <button role="radio" aria-checked={!coop} className={!coop ? 'on' : ''} onClick={() => { sfx.play('ui-toggle'); setCoop(false); }}>
            <Swords aria-hidden="true" /><strong>Head-to-head</strong><span>Same song, same beat. Highest score wins and earns badges.</span></button>
          <button role="radio" aria-checked={coop} className={coop ? 'on' : ''} onClick={() => { sfx.play('ui-toggle'); setCoop(true); }}>
            <Handshake aria-hidden="true" /><strong>Co-op tour</strong><span>Play the tour together. Your points count toward one team target.</span></button>
        </div>
        <div className="form-row">
          {!coop && <label className="field">Track<select value={songId} onChange={event => setSongId(event.target.value)}>
            <option value="">Choose a track</option>{app.songs.map(song => <option key={song.id} value={song.id}>{song.title}</option>)}
          </select></label>}
          <label className="field">{coop ? 'Co-op difficulty' : 'Duel difficulty'}<select value={level} onChange={event => setLevel(event.target.value as Difficulty)}>
            {DIFFICULTIES.map(item => <option key={item} value={item}>{difficultyNames[item]}</option>)}
          </select></label>
          <button className="primary big" disabled={(!coop && !songId) || syncing || !connected}
            onClick={() => action('create-duel', coop ? { mode: 'coop', difficulty: level } : { songId, difficulty: level })}>Create invite</button>
        </div>
        <p className="muted">You get a link to share. The game starts when both players press Ready.</p>
      </>}
      {invite && !error && <p role="status">Joining the game…</p>}
    </Screen>;
  }

  if (duel.phase === 'finished' || duel.phase === 'canceled') {
    const title = duel.phase === 'canceled' ? 'Game ended'
      : team ? team.teamPassed ? tourStart(team.progress) ? 'Song cleared' : 'Tour complete' : 'Target missed'
      : duel.winner === null ? 'Draw' : duel.winner === slot ? 'You won' : 'Your opponent won';
    return <Screen title={title} eyebrow={duel.song.title} onBack={() => void leave()} className="online-screen">
      {error && <p role="alert" className="error">{error}</p>}
      <section className="panel duel-finale" aria-live="polite">
        {team && <p className="team-line">{team.teamScore.toLocaleString()} of {team.targetScore.toLocaleString()} team points
          {team.teamPassed && nextSong && <> · Next up {nextSong.title}</>}</p>}
        <div className="party-results">
          {duel.players.map(player => <div key={player.slot} className={!team && duel.winner === player.slot ? 'winner' : ''}>
            {!team && duel.winner === player.slot && <Crown aria-hidden="true" />}
            <PlayerCard profile={player.profile} />
            <span>{player.slot === slot ? 'You' : partner}</span>
            <strong>{player.score.toLocaleString()}</strong>
            <p>{player.hits} {player.hits === 1 ? 'note' : 'notes'} hit · Best combo {player.bestCombo}</p>
          </div>)}
        </div>
        {duel.reason && <p role="status">{duel.reason}</p>}
        {!cooperative && !!me?.profile.badges.length && <p>Earned badges: {me.profile.badges.map(badge => badgeNames[badge]).join(', ')}</p>}
        {duel.phase === 'finished' && slot === duel.host && <button className="primary big" autoFocus
          disabled={duel.players.length < 2 || !duel.players.every(player => player.connected) || !connected}
          onClick={() => action(nextSong ? 'advance-coop' : 'rematch')}>
          {nextSong ? 'Continue tour' : cooperative ? 'Replay song' : 'Set up rematch'}</button>}
        {duel.phase === 'finished' && slot !== duel.host && <p>{cooperative ? 'The host chooses when to continue.' : 'The host can set up a rematch.'}</p>}
      </section>
    </Screen>;
  }

  return <div className="online-stage" data-phase={duel.phase}>
    {track?.song.id === duel.song.id
      ? <GameScreen key={duel.round ?? duel.id} recording={track} setup={{ mode: cooperative ? 'coop' : 'versus', difficulty: duel.difficulty, mods: [] }}
        onExit={() => void leave()} opponentBoostUntil={cooperative ? null : other?.boostEndMs ?? null}
        readyExtra={<div className="duel-invite">
          {venue && <p>{venue.name}</p>}
          {slot === duel.host && duel.players.length < 2 && <>
            <label className="field">Invite link<input readOnly value={inviteLink} onFocus={event => event.target.select()} /></label>
            <button type="button" onClick={copy}>Copy invite</button><p role="status">{status}</p>
          </>}
          <p>{duel.players.length < 2 ? `Waiting for ${cooperative ? 'a teammate' : 'an opponent'}…` : 'Both players are here. Ready up to start.'}</p>
          {error && <p role="alert" className="error">{error}</p>}
        </div>}
        match={{
          startAt: duel.startAt ? scheduled.current?.perf ?? null : null, ready: !!me?.ready,
          ampCharge: me?.ampCharge ?? 0, boostEndMs: me?.boostEndMs ?? null, combo: me?.combo ?? 0,
          onReady: () => send('duel-ready', true),
          onBoost: timeMs => { if (socket.current?.connected) socket.current.emit('duel-boost', timeMs); },
          onInput: (input: LaneInput) => { if (socket.current?.connected) socket.current.emit('duel-input', input); },
        }} />
      : <main className="screen"><p role="status" className="loading-line">Loading the shared track…</p>
        {error && <><p role="alert" className="error">{error}</p><button onClick={() => { setError(''); setReload(count => count + 1); }}>Retry track</button></>}
        <button onClick={() => void leave()}>Leave</button></main>}
    <div className={`duel-scoreboard duel-${duel.phase}`} aria-label={cooperative ? 'Team scoreboard' : 'Duel scoreboard'}>
      {duel.players.map(player => <section key={player.slot} className="duel-player" data-you={player.slot === slot ? 'true' : undefined}>
        <PlayerCard profile={player.profile} />
        <p>{player.slot === slot ? 'You' : partner} · {!player.connected ? 'Disconnected' : duel.phase === 'lobby' ? player.ready ? 'Ready' : 'Getting ready' : `${player.combo} combo`}</p>
        <strong>{player.score.toLocaleString()} pts</strong>{duel.phase !== 'lobby' && <p>{player.hits > 0 && player.accuracy === 0 ? '<1' : player.accuracy}% accuracy</p>}
        {duel.phase === 'playing' && <div className="duel-frets" aria-hidden="true">
          {(palettes[player.profile.palette] ?? palettes.Classic).map((color, lane) => <i key={lane} style={{ color }}
            className={player.strike?.lanes.includes(lane) ? player.strike.missed ? 'missed' : 'active' : player.frets.includes(lane) ? 'active' : ''} />)}
        </div>}
      </section>)}
      {duel.players.length < 2 && <section className="duel-player waiting">Waiting for {cooperative ? 'a teammate' : 'an opponent'}</section>}
      {team && <div className="team-target" aria-label="Team score">
        <strong>{team.teamScore.toLocaleString()} / {team.targetScore.toLocaleString()} team points</strong>
        <progress aria-label="Team target" value={Math.min(team.teamScore, team.targetScore)} max={team.targetScore} />
      </div>}
    </div>
  </div>;
}
