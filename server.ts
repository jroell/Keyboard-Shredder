import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = 3000;

  // Multiplayer Room Logic
  const rooms = new Map<string, any>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId: string, username: string) => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          players: [],
          gameState: "waiting", // waiting, generating, playing, finished
          songData: null,
        });
      }

      const room = rooms.get(roomId);
      const player = {
        id: socket.id,
        username,
        score: 0,
        combo: 0,
        multiplier: 1,
        ready: false,
      };

      room.players.push(player);
      io.to(roomId).emit("room-update", room);
      console.log(`${username} joined room ${roomId}`);
    });

    socket.on("player-ready", (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const player = room.players.find((p: any) => p.id === socket.id);
      if (player) {
        player.ready = true;
        io.to(roomId).emit("room-update", room);
      }

      // If all players are ready, start generation or game
      if (room.players.every((p: any) => p.ready) && room.players.length >= 1) {
        if (room.gameState === "waiting") {
          room.gameState = "generating";
          io.to(roomId).emit("start-generation");
        }
      }
    });

    socket.on("song-generated", (roomId: string, songData: any) => {
      const room = rooms.get(roomId);
      if (!room) return;
      room.songData = songData;
      room.gameState = "playing";
      io.to(roomId).emit("game-start", songData);
    });

    socket.on("update-score", (roomId: string, scoreData: any) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const player = room.players.find((p: any) => p.id === socket.id);
      if (player) {
        player.score = scoreData.score;
        player.combo = scoreData.combo;
        player.multiplier = scoreData.multiplier;
        socket.to(roomId).emit("opponent-score", {
          id: socket.id,
          ...scoreData,
        });
      }
    });

    socket.on("game-over", (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room) return;
      
      // Check if all players finished
      // For now, just broadcast
      io.to(roomId).emit("player-finished", socket.id);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      rooms.forEach((room, roomId) => {
        const playerIndex = room.players.findIndex((p: any) => p.id === socket.id);
        if (playerIndex !== -1) {
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            io.to(roomId).emit("room-update", room);
          }
        }
      });
    });
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
