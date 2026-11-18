import { randomBytes, randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Chart, Difficulty, Song } from '../shared/song';
import type { CoopStage, Duel, DuelMode, LaneInput, Profile, Reply } from '../shared/duel';
import { hitWindows, isDifficulty, notesFor } from '../shared/difficulty';
import { Scoring } from '../shared/scoring';
import { isTourSongCleared, TOUR_PASS_ACCURACY, tourStart, type TourProgress } from '../shared/tour';
import type { createProfileStore } from './profiles';
import type { createJobStore } from './jobs';

type Assets = NonNullable<ReturnType<ReturnType<typeof createJobStore>['assets']>>;
type Player = { level: Difficulty; uid: string; profile: Profile; socket: string | null; ready: boolean; game: Scoring; lastTime: number; sent: number; window: number };
type Room = {
  id: string; round: string; mode: DuelMode; assets: Assets; chart: Chart; difficulty: Difficulty; players: Player[];
  phase: Duel['phase']; startAt: number | null; winner: number | null; reason?: string; touched: number; published?: string;
  coop?: { progress: TourProgress; targetScore: number; teamPassed: boolean | null };
};

export function attachDuels(http: HttpServer, authenticate: (token: string) => Promise<string | undefined>,
  songs: ReturnType<typeof createJobStore>, profiles: ReturnType<typeof createProfileStore>) {
  const io = new Server(http, { transports: ['websocket'], maxHttpBufferSize: 4096 });
  const rooms = new Map<string, Room>();
  const membership = new Map<string, Room>();
  const view = (room: Room): Duel => ({
    id: room.id, round: room.round, mode: room.mode, coop: coopStage(room), song: publicSong(room.assets.song), difficulty: room.difficulty, phase: room.phase,
    players: room.players.map((player, slot) => ({
      slot, profile: player.profile, connected: !!player.socket, ready: player.ready, difficulty: player.level, rating: player.game.rating,
      score: player.game.score, combo: player.game.combo, ampCharge: player.game.ampCharge, boostEndMs: player.game.boostEndMs, accuracy: player.game.accuracy,
      frets: [...player.game.held],
      strike: player.game.feedback && Date.now() - (room.startAt ?? 0) - player.game.feedback.timeMs < 500
        ? { lanes: player.game.feedback.lanes, missed: player.game.feedback.offsetMs === undefined } : null,
      hits: player.game.hits, bestCombo: player.game.bestCombo,
    })),
    host: 0, startAt: room.startAt, winner: room.winner, reason: room.reason,
  });
  function coopStage(room: Room): CoopStage | undefined {
    if (!room.coop) return undefined;
    const currentProgress = room.coop.progress;
    const next = room.phase === 'finished' && isTourSongCleared(room.assets.song.id, currentProgress)
      ? tourStart(currentProgress) : null;
    return {
      ...room.coop,
      teamScore: room.players.reduce((total, player) => total + player.game.score, 0),
      nextSongId: next === room.assets.song.id ? null : next,
    };
  }

  function publish(room: Room, force = false) {
    const snapshot = view(room);
    const serialized = JSON.stringify(snapshot);
    if (force || serialized !== room.published) {
      room.published = serialized;
      io.to(room.id).emit('duel', snapshot);
    }
  }
  const game = (chart: Chart, level: Difficulty) => new Scoring(notesFor(chart, level), hitWindows[level]);
  const targetFor = (chart: Chart, level: Difficulty) => 2 * TOUR_PASS_ACCURACY * notesFor(chart, level).length;
  // The team target follows the charts the players actually chose.
  const retarget = (room: Room) => {
    if (!room.coop) return;
    const levels = room.players.length === 2 ? room.players.map(player => player.level) : [room.players[0]?.level ?? room.difficulty, room.players[0]?.level ?? room.difficulty];
    room.coop.targetScore = levels.reduce((total, level) => total + TOUR_PASS_ACCURACY * notesFor(room.chart, level).length, 0);
  };
  const newPlayer = (room: Room, uid: string, socket: string, level: Difficulty = room.difficulty): Player =>
    ({ level, uid, profile: profiles.get(uid), socket, ready: false, game: game(room.chart, level), lastTime: -Infinity, sent: 0, window: 0 });

  function resetRound(room: Room) {
    room.round = randomUUID();
    room.phase = 'lobby';
    room.startAt = null;
    room.winner = null;
    room.reason = undefined;
    room.touched = Date.now();
    room.players = room.players.map(player => newPlayer(room, player.uid, player.socket!, player.level));
    if (room.coop) room.coop.teamPassed = null;
  }

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
      room.reason = room.mode === 'coop' ? 'A player left the tour.' : 'A player left the duel.';
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
    // A finished, canceled or abandoned room never blocks a new game. Only a song in progress on another connection does.
    const busyElsewhere = (room: Room) => room.phase === 'playing' &&
      room.players.some(player => player.uid === uid && player.socket && player.socket !== socket.id);
    socket.on('clock', ack => { if (typeof ack === 'function') ack(Date.now()); });
    socket.on('create-duel', async (input, ack) => {
      if (typeof ack !== 'function') return;
      const previous = membership.get(uid);
      if (previous && busyElsewhere(previous)) return reject(ack, 'Leave your current duel first.');
      if (rooms.size >= 250) return reject(ack, 'The studio is busy. Try again shortly.');
      const mode = input?.mode ?? 'duel';
      const difficulty = input?.difficulty;
      if (!['duel', 'coop'].includes(mode) || !isDifficulty(difficulty)) {
        return reject(ack, 'Choose a game mode and difficulty.');
      }
      if (mode === 'duel' && typeof input.songId !== 'string') return reject(ack, 'Choose a track and difficulty.');
      try {
        const progress = mode === 'coop' ? profiles.coopProgress(uid) : undefined;
        const songId = progress ? tourStart(progress) : input.songId;
        if (!songId) return reject(ack, 'You cleared the co-op tour.');
        if (progress && input.songId !== undefined && input.songId !== songId) {
          return reject(ack, 'A co-op tour starts at your next unlocked track.');
        }
        const assets = songs.assets(uid, songId);
        if (!assets) return reject(ack, 'That track is unavailable.');
        const chart = JSON.parse(await assets.chart()) as Chart;
        if (!socket.connected || membership.get(uid) !== previous) return reject(ack, 'Leave your current duel first.');
        if (previous) removePlayer(previous, uid);
        const room: Room = {
          id: randomBytes(12).toString('base64url'), round: randomUUID(), mode, assets, chart, difficulty,
          players: [], phase: 'lobby', startAt: null, winner: null, touched: Date.now(),
          coop: progress && { progress, targetScore: targetFor(chart, difficulty), teamPassed: null },
        };
        room.players.push(newPlayer(room, uid, socket.id));
        rooms.set(room.id, room);
        connect(room, ack);
      } catch {
        reject(ack, 'Could not read that track.');
      }
    });
    socket.on('coop-progress', ack => {
      if (typeof ack !== 'function') return;
      try { ack({ progress: profiles.coopProgress(uid) }); }
      catch { reject(ack, 'Could not load co-op tour progress.'); }
    });
    socket.on('advance-coop', async ack => {
      if (typeof ack !== 'function') return;
      const room = current();
      if (!room?.coop || room.players[0].uid !== uid) return reject(ack, 'Only the host can advance the tour.');
      if (room.phase !== 'finished' || !isTourSongCleared(room.assets.song.id, room.coop.progress) ||
          !room.players.every(player => player.socket)) {
        return reject(ack, 'Clear this stage with both players connected before advancing.');
      }
      const next = coopStage(room)?.nextSongId;
      if (!next) return reject(ack, 'There is no next stage.');
      const round = room.round;
      const assets = songs.assets(uid, next);
      if (!assets) return reject(ack, 'That track is unavailable.');
      try {
        const chart = JSON.parse(await assets.chart()) as Chart;
        if (current() !== room || room.phase !== 'finished' || room.round !== round || !room.players.every(player => player.socket)) {
          return reject(ack, 'The room changed. Wait for both players before advancing.');
        }
        room.assets = assets;
        room.chart = chart;
        retarget(room);
        resetRound(room);
        ack({});
        publish(room);
      } catch {
        reject(ack, 'Could not read the next track.');
      }
    });
    socket.on('join-duel', (id, ack) => {
      if (typeof ack !== 'function') return;
      const room = typeof id === 'string' ? rooms.get(id) : undefined;
      const previous = membership.get(uid);
      if (!room) return reject(ack, 'This game was not found or has ended.');
      if (previous && previous !== room && busyElsewhere(previous)) return reject(ack, 'Leave your current duel first.');
      const member = room.players.some(player => player.uid === uid);
      // Check the new room has space before giving up the old one.
      if (!member && (room.phase !== 'lobby' || room.players.length >= 2)) return reject(ack, 'This duel already has two players.');
      if (previous && previous !== room) removePlayer(previous, uid);
      if (!member) {
        room.players.push(newPlayer(room, uid, socket.id));
        retarget(room);
      }
      connect(room, ack);
    });
    socket.on('duel-level', (level, ack) => {
      if (typeof ack !== 'function') return;
      const room = current();
      if (!room || room.phase !== 'lobby' || !isDifficulty(level)) return reject(ack, 'Choose a difficulty before the song starts.');
      const slot = room.players.findIndex(player => player.uid === uid);
      // Each player picks their own chart. Changing it clears ready, so nobody starts on a chart they did not choose.
      room.players[slot] = { ...newPlayer(room, uid, socket.id, level) };
      retarget(room);
      ack({});
      publish(room);
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
    function playerForInput(timeMs: number) {
      const room = current();
      if (!room || room.phase !== 'playing' || room.startAt === null || !Number.isFinite(timeMs)) return;
      const now = Date.now();
      const elapsed = now - room.startAt;
      if (elapsed < 0 || elapsed > room.chart.durationMs + 450 || timeMs < 0 ||
          timeMs > room.chart.durationMs + 250 || Math.abs(timeMs - elapsed) > 500) return;
      const player = room.players.find(candidate => candidate.uid === uid)!;
      if (timeMs < player.lastTime) return;
      if (now - player.window >= 1000) {
        player.window = now;
        player.sent = 0;
      }
      if (++player.sent > 80) return;
      player.lastTime = timeMs;
      return player;
    }
    socket.on('duel-input', (input: LaneInput) => {
      if (!input || !Number.isInteger(input.lane) || input.lane < 0 || input.lane > 4 || typeof input.down !== 'boolean') return;
      const player = playerForInput(input.timeMs);
      if (!player) return;
      if (input.down) player.game.press(input.lane, input.timeMs);
      else player.game.release(input.lane, input.timeMs);
    });
    socket.on('duel-boost', (timeMs: number) => {
      playerForInput(timeMs)?.game.activateBoost(timeMs);
    });
    socket.on('rematch', ack => {
      if (typeof ack !== 'function') return;
      const room = current();
      // Either player may ask for another round. Both still have to ready up.
      if (!room || room.phase !== 'finished' || !room.players.every(player => player.socket)) {
        return reject(ack, 'Both players must be connected to play again.');
      }
      resetRound(room);
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
    room.phase = 'finished';
    room.touched = Date.now();
    if (room.coop) {
      const teamScore = a.score + b.score;
      room.coop.teamPassed = teamScore >= room.coop.targetScore;
      const accuracy = Math.min(100, Math.floor(teamScore * TOUR_PASS_ACCURACY / room.coop.targetScore));
      room.coop.progress = profiles.recordCoop(room.players[0].uid, room.assets.song.id, accuracy);
      return;
    }
    // With different charts the fair measure is timing rating; on the same chart it is score.
    const mixed = room.players[0].level !== room.players[1].level;
    const [left, right] = mixed ? [a.rating, b.rating] : [a.score, b.score];
    room.winner = left === right ? null : left > right ? 0 : 1;
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
