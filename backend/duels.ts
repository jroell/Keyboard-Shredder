import { randomBytes, randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Chart, Difficulty, Song } from '../shared/song';
import type { Duel, LaneInput, Profile, Reply } from '../shared/duel';
import { Scoring } from '../shared/scoring';
import type { createProfileStore } from './profiles';
import type { createJobStore } from './jobs';

type Assets = NonNullable<ReturnType<ReturnType<typeof createJobStore>['assets']>>;
type Player = { uid: string; profile: Profile; socket: string | null; ready: boolean; game: Scoring; lastTime: number; sent: number; window: number };
type Room = {
  id: string; round: string; assets: Assets; chart: Chart; difficulty: Difficulty; players: Player[];
  phase: Duel['phase']; startAt: number | null; winner: number | null; reason?: string; touched: number; published?: string;
};

export function attachDuels(http: HttpServer, authenticate: (token: string) => Promise<string | undefined>,
  songs: ReturnType<typeof createJobStore>, profiles: ReturnType<typeof createProfileStore>) {
  const io = new Server(http, { transports: ['websocket'], maxHttpBufferSize: 4096 });
  const rooms = new Map<string, Room>();
  const membership = new Map<string, Room>();
  const view = (room: Room): Duel => ({
    id: room.id, song: publicSong(room.assets.song), difficulty: room.difficulty, phase: room.phase,
    players: room.players.map((player, slot) => ({
      slot, profile: player.profile, connected: !!player.socket, ready: player.ready,
      score: player.game.score, combo: player.game.combo, accuracy: player.game.accuracy,
      frets: [...player.game.held],
      strike: player.game.feedback && Date.now() - (room.startAt ?? 0) - player.game.feedback.timeMs < 500
        ? { lanes: player.game.feedback.lanes, missed: player.game.feedback.offsetMs === undefined } : null,
      hits: player.game.hits, bestCombo: player.game.bestCombo,
    })),
    host: 0, startAt: room.startAt, winner: room.winner, reason: room.reason,
  });
  function publish(room: Room, force = false) {
    const snapshot = view(room);
    const serialized = JSON.stringify(snapshot);
    if (force || serialized !== room.published) {
      room.published = serialized;
      io.to(room.id).emit('duel', snapshot);
    }
  }
  const game = (chart: Chart, level: Difficulty) => new Scoring(chart.events[level], level === 'hard' ? 80 : 95);
  const newPlayer = (room: Room, uid: string, socket: string): Player =>
    ({ uid, profile: profiles.get(uid), socket, ready: false, game: game(room.chart, room.difficulty), lastTime: -Infinity, sent: 0, window: 0 });

  function removePlayer(room: Room, uid: string) {
    const player = room.players.find(candidate => candidate.uid === uid);
    if (!player || membership.get(uid) !== room) return;
    if (player.socket) io.sockets.sockets.get(player.socket)?.leave(room.id);
    player.socket = null;
    player.ready = false;
    membership.delete(uid);
    if (room.phase === 'lobby' && room.players[0] !== player) {
      room.players.pop();
      room.players[0].ready = false;
    } else if (room.phase === 'lobby' || room.phase === 'playing') {
      room.phase = 'canceled';
      room.reason = 'A player left the duel.';
    }
    publish(room);
  }

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    const uid = typeof token === 'string' && token.length < 4096 ? await authenticate(token) : undefined;
    if (!uid) return next(new Error('Sign in to join a duel.'));
    socket.data.uid = uid;
    next();
  });

  io.on('connection', socket => {
    const uid: string = socket.data.uid;
    const current = () => {
      const room = membership.get(uid);
      return room?.players.some(player => player.uid === uid && player.socket === socket.id) ? room : undefined;
    };
    function connect(room: Room, ack: (reply: Reply) => void) {
      const slot = room.players.findIndex(player => player.uid === uid);
      const player = room.players[slot];
      if (player.socket && player.socket !== socket.id) io.sockets.sockets.get(player.socket)?.leave(room.id);
      player.socket = socket.id;
      player.profile = profiles.get(uid);
      room.touched = Date.now();
      membership.set(uid, room);
      void socket.join(room.id);
      ack({ id: room.id, slot });
      publish(room, true);
    }
    const reject = (ack: (reply: Reply) => void, error: string) => ack({ error });
    socket.on('clock', ack => { if (typeof ack === 'function') ack(Date.now()); });
    socket.on('create-duel', async (input, ack) => {
      if (typeof ack !== 'function') return;
      const previous = membership.get(uid);
      if (previous?.players.some(player => player.uid === uid && player.socket)) {
        return reject(ack, 'Leave your current duel first.');
      }
      if (rooms.size >= 250) return reject(ack, 'The studio is busy. Try again shortly.');
      if (typeof input?.songId !== 'string' || !['normal', 'hard'].includes(input?.difficulty)) return reject(ack, 'Choose a track and difficulty.');
      const assets = songs.assets(uid, input.songId);
      if (!assets) return reject(ack, 'That track is unavailable.');
      try {
        const chart = JSON.parse(await assets.chart()) as Chart;
        if (!socket.connected || membership.get(uid) !== previous) return reject(ack, 'Leave your current duel first.');
        if (previous) removePlayer(previous, uid);
        const room: Room = {
          id: randomBytes(12).toString('base64url'), round: randomUUID(), assets, chart, difficulty: input.difficulty,
          players: [], phase: 'lobby', startAt: null, winner: null, touched: Date.now(),
        };
        room.players.push(newPlayer(room, uid, socket.id));
        rooms.set(room.id, room);
        connect(room, ack);
      } catch {
        reject(ack, 'Could not read that track.');
      }
    });
    socket.on('join-duel', (id, ack) => {
      if (typeof ack !== 'function') return;
      const room = typeof id === 'string' ? rooms.get(id) : undefined;
      const previous = membership.get(uid);
      if (!room) return reject(ack, 'This invite has expired.');
      if (previous && previous !== room) return reject(ack, 'Leave your current duel first.');
      if (!room.players.some(player => player.uid === uid)) {
        if (room.phase !== 'lobby' || room.players.length >= 2) return reject(ack, 'This duel already has two players.');
        room.players.push(newPlayer(room, uid, socket.id));
      }
      connect(room, ack);
    });
    socket.on('duel-ready', (ready, ack) => {
      if (typeof ack !== 'function') return;
      const room = current();
      if (!room || room.phase !== 'lobby' || typeof ready !== 'boolean') return reject(ack, 'This duel already started.');
      room.players.find(player => player.uid === uid)!.ready = ready;
      if (room.players.length === 2 && room.players.every(player => player.ready && player.socket)) {
        room.phase = 'playing';
        room.startAt = Date.now() + 3200;
      }
      ack({});
      publish(room);
    });
    socket.on('duel-input', (input: LaneInput) => {
      const room = current();
      if (!room || room.phase !== 'playing' || room.startAt === null || !input ||
          !Number.isInteger(input.lane) || input.lane < 0 || input.lane > 4 ||
          typeof input.down !== 'boolean' || !Number.isFinite(input.timeMs)) return;
      const now = Date.now();
      const elapsed = now - room.startAt;
      if (elapsed < 0 || elapsed > room.chart.durationMs + 450 || input.timeMs < 0 ||
          input.timeMs > room.chart.durationMs + 250 || Math.abs(input.timeMs - elapsed) > 500) return;
      const player = room.players.find(candidate => candidate.uid === uid)!;
      if (input.timeMs < player.lastTime) return;
      if (now - player.window >= 1000) {
        player.window = now;
        player.sent = 0;
      }
      if (++player.sent > 80) return;
      player.lastTime = input.timeMs;
      if (input.down) player.game.press(input.lane, input.timeMs);
      else player.game.release(input.lane, input.timeMs);
    });
    socket.on('rematch', ack => {
      if (typeof ack !== 'function') return;
      const room = current();
      if (!room || room.players[0].uid !== uid || room.phase !== 'finished' || !room.players.every(player => player.socket)) {
        return reject(ack, 'Both players must be connected to play again.');
      }
      room.round = randomUUID();
      room.phase = 'lobby';
      room.startAt = null;
      room.winner = null;
      room.reason = undefined;
      room.players = room.players.map(player => newPlayer(room, player.uid, player.socket!));
      ack({});
      publish(room);
    });
    socket.on('leave-duel', ack => {
      if (typeof ack !== 'function') return;
      const room = current();
      if (room) removePlayer(room, uid);
      ack({});
    });
    socket.on('disconnect', () => {
      const room = current();
      if (!room) return;
      const player = room.players.find(candidate => candidate.uid === uid)!;
      player.socket = null;
      player.ready = false;
      if (room.phase === 'playing') {
        for (const lane of player.game.held) player.game.release(lane, Math.max(0, Date.now() - room.startAt!));
      }
      publish(room);
    });
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.phase === 'playing') {
        const elapsed = now - room.startAt!;
        if (elapsed >= room.chart.durationMs + 550) {
          try { finish(room); }
          catch (error) {
            console.error('Could not save duel', room.id, error);
            room.reason = 'The score is final, but account progress could not be saved.';
          }
        } else if (elapsed >= 0) {
          for (const player of room.players) player.game.tick(Math.max(0, elapsed - 500));
        }
        publish(room);
      } else if (now - room.touched > 30 * 60_000) {
        rooms.delete(room.id);
        for (const player of room.players) if (membership.get(player.uid) === room) membership.delete(player.uid);
        io.to(room.id).emit('duel-expired');
        io.in(room.id).socketsLeave(room.id);
      }
    }
  }, 125);
  timer.unref();

  function finish(room: Room) {
    for (const player of room.players) player.game.finish();
    const [a, b] = room.players.map(player => player.game);
    room.winner = a.score === b.score ? null : a.score > b.score ? 0 : 1;
    room.phase = 'finished';
    room.touched = Date.now();
    profiles.record(room.round, room.players.map((player, slot) => ({
      uid: player.uid, win: room.winner === slot, accuracy: player.game.accuracy,
      bestCombo: player.game.bestCombo, hits: player.game.hits,
    })));
    for (const player of room.players) player.profile = profiles.get(player.uid);
  }

  return {
    leave(id: string, uid: string) {
      const room = rooms.get(id);
      if (room) removePlayer(room, uid);
    },
    profileChanged(uid: string, profile: Profile) {
      const room = membership.get(uid);
      const player = room?.players.find(candidate => candidate.uid === uid);
      if (room && player) {
        player.profile = profile;
        publish(room);
      }
    },
    assets(id: string, uid: string) {
      const room = rooms.get(id);
      if (!room || membership.get(uid) !== room || !room.players.some(player => player.uid === uid)) return undefined;
      return { ...room.assets, song: publicSong(room.assets.song) };
    },
  };
}

function publicSong(song: Song): Song {
  return { ...song, prompt: '' };
}
