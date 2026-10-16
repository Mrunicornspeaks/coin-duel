const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// In-memory rooms: { CODE: { players: [{id, name, side, wins}], flipping: bool } }
const rooms = {};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    ).join("");
  } while (rooms[code]);
  return code;
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 16) || "Player";
}

function publicState(code) {
  const room = rooms[code];
  return {
    code,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      side: p.side,
      wins: p.wins,
    })),
  };
}

io.on("connection", (socket) => {
  socket.on("create_room", (name, cb) => {
    const code = makeCode();
    rooms[code] = {
      players: [{ id: socket.id, name: cleanName(name), side: "heads", wins: 0 }],
      flipping: false,
    };
    socket.join(code);
    socket.data.code = code;
    cb({ ok: true, state: publicState(code) });
  });

  socket.on("join_room", ({ code, name }, cb) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: "No room with that code." });
    if (room.players.length >= 2) return cb({ ok: false, error: "That room is full." });

    room.players.push({ id: socket.id, name: cleanName(name), side: "tails", wins: 0 });
    socket.join(code);
    socket.data.code = code;
    cb({ ok: true, state: publicState(code) });
    socket.to(code).emit("room_state", publicState(code));
  });

  socket.on("flip", () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room || room.players.length < 2 || room.flipping) return;

    room.flipping = true;
    // The server decides. Neither browser can influence the result.
    const result = Math.random() < 0.5 ? "heads" : "tails";
    const winner = room.players.find((p) => p.side === result);
    winner.wins += 1;

    io.to(code).emit("flip_result", {
      result,
      winnerId: winner.id,
      winnerName: winner.name,
      flipperName: (room.players.find((p) => p.id === socket.id) || {}).name,
      state: publicState(code),
    });

    // Unlock after the animation has had time to finish
    setTimeout(() => {
      if (rooms[code]) rooms[code].flipping = false;
    }, 3800);
  });

  socket.on("disconnect", () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) {
      delete rooms[code];
    } else {
      room.flipping = false;
      io.to(code).emit("room_state", publicState(code));
      io.to(code).emit("player_left");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Coin Duel running on http://localhost:${PORT}`));