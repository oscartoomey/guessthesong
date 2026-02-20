const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');
const Game = require('./game');

function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const PORT = 3000;

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const game = new Game();

// --- Fuzzy matching ---

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function isCorrectGuess(guess, { trackName }) {
  const g = normalize(guess);
  if (g.length < 2) return false;
  const t = normalize(trackName);
  return t.includes(g) || g.includes(t);
}

// --- Helpers ---

function getPlayers() {
  return Array.from(game.players.values())
    .filter((p) => p.connected)
    .map(({ name, score }) => ({ name, score }))
    .sort((a, b) => b.score - a.score);
}

function clearGuessTimer() {
  if (game.guessTimer) {
    clearTimeout(game.guessTimer);
    game.guessTimer = null;
  }
}

function emitToPlayer(playerId, event, data) {
  const player = game.players.get(playerId);
  if (player && player.socketId) {
    io.to(player.socketId).emit(event, data);
  }
}

function endRound(winner) {
  clearGuessTimer();
  game.state = 'round-end';
  game.buzzedPlayer = null;

  const players = getPlayers();

  io.emit('round-over', {
    song: game.currentSong,
    scores: players,
    lastPlace: null,
    winner: winner || null,
  });
}

// --- Socket handlers ---

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('host-connect', () => {
    game.hostId = socket.id;
    console.log('Host connected:', socket.id);
    socket.emit('lobby-update', { players: getPlayers() });
    socket.emit('server-info', { lanIp: getLanIp() });
  });

  socket.on('player-join', ({ name, playerId }) => {
    if (!name || typeof name !== 'string' || !name.trim()) {
      socket.emit('error', { message: 'Invalid name' });
      return;
    }
    if (!playerId || typeof playerId !== 'string') {
      socket.emit('error', { message: 'Invalid player ID' });
      return;
    }
    const trimmedName = name.trim().slice(0, 20);

    // Check if this is a rejoin
    const existing = game.players.get(playerId);
    if (existing) {
      // Rejoin — update socket and mark connected
      existing.socketId = socket.id;
      existing.connected = true;
      existing.name = trimmedName;
      console.log('Player rejoined:', trimmedName);

      // Send current game state to the rejoining player
      socket.emit('rejoin-state', {
        phase: game.state,
        roundNumber: game.roundNumber,
        totalRounds: game.totalRounds,
        scores: getPlayers(),
        lockedOut: game.lockedOut.has(playerId),
      });

      io.emit('lobby-update', { players: getPlayers() });
      return;
    }

    // New player
    if (game.state !== 'lobby') {
      socket.emit('error', { message: 'Game already started' });
      return;
    }

    game.players.set(playerId, {
      name: trimmedName,
      score: 0,
      socketId: socket.id,
      connected: true,
    });
    console.log('Player joined:', trimmedName);
    io.emit('lobby-update', { players: getPlayers() });
  });

  socket.on('start-game', ({ totalRounds, hardMode }) => {
    if (socket.id !== game.hostId) return;
    if (game.state !== 'lobby') return;

    game.totalRounds = Math.max(1, Math.min(30, totalRounds || 10));
    game.hardMode = !!hardMode;
    game.state = 'playing';
    game.roundNumber = 0;

    for (const player of game.players.values()) {
      player.score = 0;
    }

    io.emit('game-started', { totalRounds: game.totalRounds });
    io.emit('await-round');
    console.log('Game started with', game.totalRounds, 'rounds');
  });

  socket.on('round-started', ({ trackName, artists, trackUri, albumArt }) => {
    if (socket.id !== game.hostId) return;

    game.roundNumber++;
    game.currentSong = { trackName, artists, trackUri, albumArt };
    game.buzzedPlayer = null;
    game.lockedOut = new Set();
    game.state = 'round-active';
    game.roundStartedAt = Date.now();

    io.emit('round-started', { roundNumber: game.roundNumber });
    console.log(`Round ${game.roundNumber} started: ${trackName}`);
  });

  socket.on('buzz-in', () => {
    const entry = game.getPlayerBySocket(socket.id);
    if (!entry) return;
    const { playerId, player } = entry;

    if (game.state !== 'round-active') {
      socket.emit('error', { message: 'Cannot buzz in right now' });
      return;
    }
    if (game.lockedOut.has(playerId)) {
      socket.emit('error', { message: 'You are locked out this round' });
      return;
    }

    game.buzzedPlayer = playerId;
    game.state = 'guessing';

    // 1000 pts at 0s, linear decay to 100 pts over 30s
    const elapsed = Date.now() - game.roundStartedAt;
    game.buzzPoints = Math.max(100, Math.round(1000 - (elapsed / 30000) * 900));

    io.emit('buzz-accepted', { playerName: player.name, points: game.buzzPoints });
    socket.emit('your-turn', { timeoutMs: 15000 });

    clearGuessTimer();
    game.guessTimer = setTimeout(() => {
      if (game.buzzedPlayer === playerId && game.state === 'guessing') {
        if (game.hardMode) player.score = Math.max(0, player.score - 500);
        io.emit('wrong-guess', { playerName: player.name });
        emitToPlayer(playerId, 'drink-prompt', { message: 'Take a drink! 🍺' });
        game.lockedOut.add(playerId);

        game.buzzedPlayer = null;
        game.state = 'round-active';

        if (game.lockedOut.size >= game.getConnectedPlayerCount()) {
          console.log('All players locked out — auto-skipping round');
          endRound();
        }
      }
    }, 15000);

    console.log(`${player.name} buzzed in`);
  });

  socket.on('submit-guess', ({ text }) => {
    const entry = game.getPlayerBySocket(socket.id);
    if (!entry) return;
    const { playerId, player } = entry;

    if (game.state !== 'guessing') return;
    if (game.buzzedPlayer !== playerId) return;
    if (!text || typeof text !== 'string') return;

    clearGuessTimer();

    if (isCorrectGuess(text, game.currentSong)) {
      player.score += game.buzzPoints;
      console.log(`${player.name} guessed correctly! (+${game.buzzPoints} pts)`);
      endRound(player.name);
    } else {
      if (game.hardMode) player.score = Math.max(0, player.score - 500);
      console.log(`${player.name} guessed wrong: "${text}"`);
      io.emit('wrong-guess', { playerName: player.name });
      emitToPlayer(playerId, 'drink-prompt', { message: 'Take a drink! 🍺' });
      game.lockedOut.add(playerId);
      game.buzzedPlayer = null;
      game.state = 'round-active';

      if (game.lockedOut.size >= game.getConnectedPlayerCount()) {
        console.log('All players locked out — auto-skipping round');
        endRound();
      }
    }
  });

  socket.on('pass-round', () => {
    const entry = game.getPlayerBySocket(socket.id);
    if (!entry) return;
    const { playerId, player } = entry;

    if (game.state !== 'round-active') return;
    if (game.lockedOut.has(playerId)) return;

    game.lockedOut.add(playerId);
    console.log(`${player.name} passed`);

    if (game.lockedOut.size >= game.getConnectedPlayerCount()) {
      console.log('All players passed/locked out — auto-skipping round');
      endRound();
    }
  });

  socket.on('skip-round', () => {
    if (socket.id !== game.hostId) return;
    console.log('Host skipped round');
    endRound();
  });

  socket.on('next-round', () => {
    if (socket.id !== game.hostId) return;
    if (game.state !== 'round-end') return;

    if (game.roundNumber >= game.totalRounds) {
      game.state = 'game-over';
      io.emit('game-over', { scores: getPlayers() });
      console.log('Game over!');
    } else {
      game.state = 'playing';
      io.emit('await-round');
    }
  });

  socket.on('reset-game', () => {
    if (socket.id !== game.hostId) return;
    clearGuessTimer();

    for (const player of game.players.values()) {
      player.score = 0;
    }
    game.roundNumber = 0;
    game.currentSong = null;
    game.buzzedPlayer = null;
    game.lockedOut = new Set();
    game.state = 'lobby';

    io.emit('game-reset');
    io.emit('lobby-update', { players: getPlayers() });
    console.log('Game reset');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    if (socket.id === game.hostId) {
      game.hostId = null;
      console.log('Host disconnected');
      return;
    }

    const entry = game.getPlayerBySocket(socket.id);
    if (!entry) return;
    const { playerId, player } = entry;

    // Mark disconnected but keep player data
    player.connected = false;
    player.socketId = null;
    console.log('Player disconnected (kept):', player.name);

    if (game.state === 'lobby') {
      io.emit('lobby-update', { players: getPlayers() });
    }

    // If the disconnected player was the active buzzer, end their turn
    if (game.buzzedPlayer === playerId) {
      clearGuessTimer();
      game.buzzedPlayer = null;
      game.state = 'round-active';
      io.emit('wrong-guess', { playerName: player.name });
      game.lockedOut.add(playerId);

      if (game.lockedOut.size >= game.getConnectedPlayerCount()) {
        console.log('All remaining players locked out — auto-skipping round');
        endRound();
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
