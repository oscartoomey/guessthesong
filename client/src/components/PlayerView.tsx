import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Player, Song } from '../types/game';
import socket from '../socket';
import Leaderboard from './Leaderboard';

type PlayerPhase =
  | 'join'
  | 'lobby'
  | 'await-round'
  | 'round-active'
  | 'guessing'
  | 'waiting'
  | 'round-end'
  | 'game-over';

function getOrCreatePlayerId(): string {
  let id = localStorage.getItem('dg_player_id');
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('dg_player_id', id);
  }
  return id;
}

export default function PlayerView() {
  const playerIdRef = useRef(getOrCreatePlayerId());
  const [phase, setPhase] = useState<PlayerPhase>('join');
  const [nameInput, setNameInput] = useState('');
  const [myName, setMyName] = useState('');
  const myNameRef = useRef('');

  const [players, setPlayers] = useState<Player[]>([]);
  const [roundNumber, setRoundNumber] = useState(0);
  const [totalRounds, setTotalRounds] = useState(10);
  const [buzzingPlayer, setBuzzingPlayer] = useState('');
  const [buzzPoints, setBuzzPoints] = useState(0);

  const [guessInput, setGuessInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(15);
  const [isLockedOut, setIsLockedOut] = useState(false);

  const [drinkPrompt, setDrinkPrompt] = useState('');
  const [revealedSong, setRevealedSong] = useState<Song | null>(null);
  const [scores, setScores] = useState<Player[]>([]);
  const [lastPlace, setLastPlace] = useState('');
  const [roundWinner, setRoundWinner] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // On mount, try to rejoin if we have a stored name
  useEffect(() => {
    const storedName = localStorage.getItem('dg_player_name');
    if (storedName) {
      myNameRef.current = storedName;
      setMyName(storedName);
      setNameInput(storedName);
      socket.emit('player-join', { name: storedName, playerId: playerIdRef.current });
    }
  }, []);

  useEffect(() => {
    socket.on('lobby-update', ({ players }: { players: Player[] }) => {
      setPlayers(players);
    });

    socket.on('game-started', ({ totalRounds }: { totalRounds: number }) => {
      setTotalRounds(totalRounds);
    });

    socket.on('await-round', () => {
      setPhase('await-round');
      setIsLockedOut(false);
      setDrinkPrompt('');
      setBuzzingPlayer('');
    });

    socket.on('round-started', ({ roundNumber }: { roundNumber: number }) => {
      setRoundNumber(roundNumber);
      setPhase('round-active');
      setIsLockedOut(false);
      setBuzzingPlayer('');
      setDrinkPrompt('');
    });

    socket.on('buzz-accepted', ({ playerName, points }: { playerName: string; points: number }) => {
      setBuzzingPlayer(playerName);
      setBuzzPoints(points);
      // Only go to 'waiting' if it wasn't me — 'your-turn' handles my guessing phase
      if (playerName !== myNameRef.current) {
        setPhase('waiting');
      }
    });

    socket.on('your-turn', ({ timeoutMs }: { timeoutMs: number }) => {
      setPhase('guessing');
      setGuessInput('');
      const seconds = Math.floor(timeoutMs / 1000);
      setTimeLeft(seconds);
      clearTimer();
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearTimer();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    });

    socket.on('wrong-guess', ({ playerName }: { playerName: string }) => {
      clearTimer();
      setBuzzingPlayer('');
      if (playerName === myNameRef.current) {
        setIsLockedOut(true);
        setPhase('round-active');
      } else {
        setPhase((prev) => (prev === 'waiting' ? 'round-active' : prev));
      }
    });

    socket.on('drink-prompt', ({ message }: { message: string }) => {
      setDrinkPrompt(message);
    });

    socket.on(
      'round-over',
      ({
        song,
        scores,
        lastPlace,
        winner,
      }: {
        song: Song;
        scores: Player[];
        lastPlace: string;
        winner: string | null;
      }) => {
        clearTimer();
        setRevealedSong(song);
        setScores(scores);
        setLastPlace(lastPlace);
        setRoundWinner(winner || '');
        setPhase('round-end');
      }
    );

    socket.on('game-over', ({ scores }: { scores: Player[] }) => {
      setScores(scores);
      setPhase('game-over');
    });

    socket.on('game-reset', () => {
      setPhase('lobby');
      setIsLockedOut(false);
      setDrinkPrompt('');
      setRoundNumber(0);
      setBuzzingPlayer('');
    });

    socket.on('error', ({ message }: { message: string }) => {
      setErrorMsg(message);
      setTimeout(() => setErrorMsg(''), 3000);
    });

    // Handle rejoin state from server
    socket.on('rejoin-state', ({
      phase: serverPhase,
      roundNumber: rn,
      totalRounds: tr,
      scores: sc,
      lockedOut,
    }: {
      phase: string;
      roundNumber: number;
      totalRounds: number;
      scores: Player[];
      lockedOut: boolean;
    }) => {
      setRoundNumber(rn);
      setTotalRounds(tr);
      setScores(sc);
      setIsLockedOut(lockedOut);

      // Map server game state to player phase
      if (serverPhase === 'lobby') {
        setPhase('lobby');
      } else if (serverPhase === 'playing') {
        setPhase('await-round');
      } else if (serverPhase === 'round-active') {
        setPhase(lockedOut ? 'round-active' : 'round-active');
      } else if (serverPhase === 'guessing') {
        setPhase('waiting');
      } else if (serverPhase === 'round-end') {
        setPhase('round-end');
      } else if (serverPhase === 'game-over') {
        setPhase('game-over');
      } else {
        setPhase('lobby');
      }
    });

    return () => {
      socket.off('lobby-update');
      socket.off('game-started');
      socket.off('await-round');
      socket.off('round-started');
      socket.off('buzz-accepted');
      socket.off('your-turn');
      socket.off('wrong-guess');
      socket.off('drink-prompt');
      socket.off('round-over');
      socket.off('game-over');
      socket.off('game-reset');
      socket.off('error');
      socket.off('rejoin-state');
      clearTimer();
    };
  }, [clearTimer]);

  const handleJoin = () => {
    const name = nameInput.trim();
    if (!name) return;
    myNameRef.current = name;
    setMyName(name);
    localStorage.setItem('dg_player_name', name);
    socket.emit('player-join', { name, playerId: playerIdRef.current });
    setPhase('lobby');
  };

  const handleBuzzIn = () => {
    if (isLockedOut || phase !== 'round-active') return;
    socket.emit('buzz-in');
  };

  const handlePass = () => {
    if (isLockedOut || phase !== 'round-active') return;
    socket.emit('pass-round');
    setIsLockedOut(true);
  };

  const handleSubmitGuess = () => {
    const text = guessInput.trim();
    if (!text) return;
    clearTimer();
    socket.emit('submit-guess', { text });
  };

  // --- Render by phase ---

  if (phase === 'join') {
    return (
      <div className="player-view join-screen">
        <h1>🎵 Drinking Game</h1>
        <div className="join-form">
          <input
            type="text"
            placeholder="Your name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            maxLength={20}
            autoFocus
          />
          <button
            className="btn-primary btn-large"
            onClick={handleJoin}
            disabled={!nameInput.trim()}
          >
            Join Game
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'lobby') {
    return (
      <div className="player-view lobby-screen">
        <h2>Hey, {myName}! 👋</h2>
        <p className="status">Waiting for the host to start the game...</p>
        <div className="player-list">
          <h3>Players ({players.length})</h3>
          <ul>
            {players.map((p, i) => (
              <li key={i} className={p.name === myName ? 'me' : ''}>
                {p.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (phase === 'await-round') {
    return (
      <div className="player-view await-screen">
        <h2>Get Ready! 🎵</h2>
        <p className="hint">Round {roundNumber + 1} of {totalRounds} is coming up...</p>
        <p className="status">Waiting for the host to play the song...</p>
      </div>
    );
  }

  if (phase === 'round-active') {
    return (
      <div className="player-view round-screen">
        <div className="round-info">
          Round {roundNumber} / {totalRounds}
        </div>

        {drinkPrompt && <div className="drink-prompt">{drinkPrompt}</div>}

        {isLockedOut ? (
          <div className="locked-out">
            <p>🔒 You're locked out this round</p>
            <small>Wait for the next round...</small>
          </div>
        ) : (
          <>
            <button className="buzz-button" onClick={handleBuzzIn}>
              BUZZ IN!
            </button>
            <button className="btn-secondary" onClick={handlePass}>
              Don't Know
            </button>
          </>
        )}

        {errorMsg && <p className="error">{errorMsg}</p>}
      </div>
    );
  }

  if (phase === 'guessing') {
    return (
      <div className="player-view guess-screen">
        <div
          className="timer"
          style={{ color: timeLeft <= 5 ? '#ff4444' : undefined }}
        >
          {timeLeft}s
        </div>
        <p>What song is this? ({buzzPoints} pts)</p>
        <div className="guess-form">
          <input
            type="text"
            placeholder="Song name or artist..."
            value={guessInput}
            onChange={(e) => setGuessInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitGuess()}
            autoFocus
          />
          <button
            className="btn-primary btn-large"
            onClick={handleSubmitGuess}
            disabled={!guessInput.trim()}
          >
            Submit!
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="player-view waiting-screen">
        <div className="round-info">Round {roundNumber} / {totalRounds}</div>
        <p className="buzzing">⚡ {buzzingPlayer} is guessing...</p>
      </div>
    );
  }

  if (phase === 'round-end') {
    const myScore = scores.find((p) => p.name === myName)?.score ?? 0;
    const myRank = scores.findIndex((p) => p.name === myName) + 1;

    return (
      <div className="player-view round-end-screen">
        <h2>Round {roundNumber} Over!</h2>

        {revealedSong && (
          <div className="song-reveal">
            {revealedSong.albumArt && (
              <img className="album-art" src={revealedSong.albumArt} alt="Album cover" />
            )}
            <p className="song-name">{revealedSong.trackName}</p>
            <p className="artists">{revealedSong.artists.join(', ')}</p>
            {roundWinner && <p className="round-winner">{roundWinner} got it!</p>}
          </div>
        )}

        <div className="my-score">
          #{myRank} — {myScore} pts
        </div>

        {drinkPrompt && <div className="drink-prompt big">{drinkPrompt}</div>}

        <p className="status">Waiting for next round...</p>
      </div>
    );
  }

  if (phase === 'game-over') {
    return (
      <div className="player-view game-over-screen">
        <h1>Game Over! 🎉</h1>
        <Leaderboard scores={scores} myName={myName} />
      </div>
    );
  }

  return null;
}
