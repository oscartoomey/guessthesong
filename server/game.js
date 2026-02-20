class Game {
  constructor() {
    this.players = new Map();   // playerId → { name, score, socketId, connected }
    this.hostId = null;
    this.state = 'lobby';
    this.rounds = [];           // used track URIs
    this.currentSong = null;    // { trackName, artists: string[], trackUri }
    this.roundNumber = 0;
    this.totalRounds = 10;
    this.buzzedPlayer = null;   // playerId
    this.lockedOut = new Set(); // playerIds locked out this round
    this.guessTimer = null;
    this.roundStartedAt = 0;   // timestamp when round began
    this.buzzPoints = 0;       // points the current buzzer earns if correct
    this.hardMode = false;
  }

  getPlayerBySocket(socketId) {
    for (const [playerId, player] of this.players) {
      if (player.socketId === socketId) return { playerId, player };
    }
    return null;
  }

  getConnectedPlayerCount() {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.connected) count++;
    }
    return count;
  }
}

module.exports = Game;
