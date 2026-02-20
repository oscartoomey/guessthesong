import React, { useState, useEffect, useRef } from 'react';
import {
  isAuthenticated,
  redirectToSpotifyLogin,
  handleCallback,
  logout,
} from '../auth/spotify-auth';
import { disconnectPlayer } from '../player/spotify-player';
import { fetchUserPlaylists, fetchPlaylistTracks } from '../api/playlist-api';
import { useSpotifyPlayer } from '../player/useSpotifyPlayer';
import type { SpotifyPlaylist, SpotifyTrack } from '../types/spotify';
import type { Player, Song } from '../types/game';
import socket from '../socket';
import Leaderboard from './Leaderboard';

type HostPhase =
  | 'auth'
  | 'callback'
  | 'setup'
  | 'lobby'
  | 'await-round'
  | 'round-active'
  | 'buzzing'
  | 'round-end'
  | 'game-over';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function HostView() {
  const [phase, setPhase] = useState<HostPhase>('auth');
  const [authed, setAuthed] = useState(false);

  // Setup state
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [totalRounds, setTotalRounds] = useState(10);
  const [skipDelay, setSkipDelay] = useState(5);
  const [hardMode, setHardMode] = useState(false);
  const [loadingTracks, setLoadingTracks] = useState(false);

  // Game state
  const [lanIp, setLanIp] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [roundNumber, setRoundNumber] = useState(0);
  const [totalRoundsConfirmed, setTotalRoundsConfirmed] = useState(10);
  const [buzzedPlayer, setBuzzedPlayer] = useState('');
  const [buzzPoints, setBuzzPoints] = useState(0);
  const [revealedSong, setRevealedSong] = useState<Song | null>(null);
  const [scores, setScores] = useState<Player[]>([]);
  const [lastPlace, setLastPlace] = useState('');
  const [roundWinner, setRoundWinner] = useState('');
  const [roundEndCountdown, setRoundEndCountdown] = useState(0);
  const [awaitRoundCountdown, setAwaitRoundCountdown] = useState(0);
  const nextRoundCalledRef = useRef(false);
  const playRoundCalledRef = useRef(false);

  // Track list
  const tracksRef = useRef<SpotifyTrack[]>([]);
  const trackIndexRef = useRef(0);
  const playlistsFetchedRef = useRef(false);

  const { status: playerStatus, playFull, pause, resume } = useSpotifyPlayer(authed);

  // Check auth on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('code')) {
      setPhase('callback');
      handleCallback().then((success) => {
        if (success) {
          setAuthed(true);
          setPhase('setup');
        } else {
          setPhase('auth');
        }
      });
    } else if (isAuthenticated()) {
      setAuthed(true);
      setPhase('setup');
    } else {
      setPhase('auth');
    }
  }, []);

  // Connect as host and fetch playlists when entering setup (fetch once only)
  useEffect(() => {
    if (phase === 'setup') {
      socket.emit('host-connect');
      if (!playlistsFetchedRef.current) {
        playlistsFetchedRef.current = true;
        fetchUserPlaylists().then(setPlaylists).catch(console.error);
      }
    }
  }, [phase]);

  // Socket event listeners
  useEffect(() => {
    socket.on('server-info', ({ lanIp }: { lanIp: string }) => {
      setLanIp(lanIp);
    });

    socket.on('lobby-update', ({ players }: { players: Player[] }) => {
      setPlayers(players);
    });

    socket.on('game-started', ({ totalRounds }: { totalRounds: number }) => {
      setTotalRoundsConfirmed(totalRounds);
    });

    socket.on('await-round', () => {
      setPhase('await-round');
    });

    socket.on('round-started', ({ roundNumber }: { roundNumber: number }) => {
      setRoundNumber(roundNumber);
      setBuzzedPlayer('');
      setPhase('round-active');
    });

    socket.on('buzz-accepted', ({ playerName, points }: { playerName: string; points: number }) => {
      setBuzzedPlayer(playerName);
      setBuzzPoints(points);
      setPhase('buzzing');
      pause();
    });

    socket.on('wrong-guess', () => {
      setBuzzedPlayer('');
      setPhase((prev) => {
        if (prev === 'buzzing') {
          resume();
          return 'round-active';
        }
        return prev;
      });
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
        resume();
        setRevealedSong(song);
        setScores(scores);
        setLastPlace(lastPlace);
        setRoundWinner(winner || '');
        setPhase('round-end');
      }
    );

    socket.on('game-over', ({ scores }: { scores: Player[] }) => {
      pause();
      setScores(scores);
      setPhase('game-over');
    });

    socket.on('game-reset', () => {
      setRoundNumber(0);
      setBuzzedPlayer('');
      setRevealedSong(null);
      setScores([]);
      setLastPlace('');
    });

    return () => {
      socket.off('server-info');
      socket.off('lobby-update');
      socket.off('game-started');
      socket.off('await-round');
      socket.off('round-started');
      socket.off('buzz-accepted');
      socket.off('wrong-guess');
      socket.off('round-over');
      socket.off('game-over');
      socket.off('game-reset');
    };
  }, []);

  // Auto-advance from round-end after skipDelay seconds
  useEffect(() => {
    if (phase !== 'round-end') {
      nextRoundCalledRef.current = false;
      return;
    }
    setRoundEndCountdown(skipDelay);
    const countdown = setInterval(() => {
      setRoundEndCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    const autoAdvance = setTimeout(() => {
      handleNextRound();
    }, skipDelay * 1000);
    return () => {
      clearInterval(countdown);
      clearTimeout(autoAdvance);
    };
  }, [phase, skipDelay]);

  // Auto-play first round after skipDelay seconds
  useEffect(() => {
    if (phase !== 'await-round') {
      playRoundCalledRef.current = false;
      return;
    }
    setAwaitRoundCountdown(skipDelay);
    const countdown = setInterval(() => {
      setAwaitRoundCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    const autoPlay = setTimeout(() => {
      if (!playRoundCalledRef.current) {
        playRoundCalledRef.current = true;
        handlePlayRound();
      }
    }, skipDelay * 1000);
    return () => {
      clearInterval(countdown);
      clearTimeout(autoPlay);
    };
  }, [phase, skipDelay]);

  const handleLoadPlaylist = async () => {
    if (!selectedPlaylistId) return;
    setLoadingTracks(true);
    try {
      const rawTracks = await fetchPlaylistTracks(selectedPlaylistId);
      tracksRef.current = shuffle(rawTracks);
      trackIndexRef.current = 0;
      setPhase('lobby');
    } catch (err) {
      console.error('Failed to load tracks:', err);
    } finally {
      setLoadingTracks(false);
    }
  };

  const handleStartGame = () => {
    socket.emit('start-game', { totalRounds, hardMode });
  };

  const handlePlayRound = async () => {
    const tracks = tracksRef.current;
    if (tracks.length === 0) return;

    const track = tracks[trackIndexRef.current % tracks.length];
    trackIndexRef.current++;

    try {
      await playFull(track.uri);
      socket.emit('round-started', {
        trackName: track.name,
        artists: track.artists.map((a) => a.name),
        trackUri: track.uri,
        albumArt: track.album?.images?.[0]?.url || '',
      });
    } catch (err) {
      console.error('Failed to play track:', err);
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('401') || msg.includes('No tokens')) {
        alert('Session expired — please sign in again.');
        handleSignOut();
      } else {
        alert('Failed to play. Make sure Spotify is open and you have Premium.');
      }
    }
  };

  const handleSkip = () => {
    socket.emit('skip-round');
  };

  const handleNextRound = async () => {
    if (nextRoundCalledRef.current) return;
    nextRoundCalledRef.current = true;
    socket.emit('next-round');
    if (roundNumber < totalRoundsConfirmed) {
      await handlePlayRound();
    }
  };

  const handlePlayAgain = async () => {
    pause();
    socket.emit('reset-game');
    trackIndexRef.current = 0;
    setPhase('lobby');
    try {
      const freshTracks = await fetchPlaylistTracks(selectedPlaylistId);
      tracksRef.current = shuffle(freshTracks);
    } catch {
      // Fallback: reshuffle existing tracks
      tracksRef.current = shuffle(tracksRef.current);
    }
  };

  const handleRestart = () => {
    pause();
    socket.emit('reset-game');
    tracksRef.current = [];
    trackIndexRef.current = 0;
    setRoundNumber(0);
    setBuzzedPlayer('');
    setRevealedSong(null);
    setScores([]);
    setLastPlace('');
    setSelectedPlaylistId('');
    setPhase('setup');
  };

  const handleSignOut = () => {
    pause();
    socket.emit('reset-game');
    disconnectPlayer();
    logout();
    tracksRef.current = [];
    trackIndexRef.current = 0;
    setAuthed(false);
    setRoundNumber(0);
    setBuzzedPlayer('');
    setRevealedSong(null);
    setScores([]);
    setLastPlace('');
    setSelectedPlaylistId('');
    setPlaylists([]);
    playlistsFetchedRef.current = false;
    setPhase('auth');
  };

  const joinUrl = lanIp ? `http://${lanIp}:5173` : 'Connecting...';

  const showRestart = !['auth', 'callback'].includes(phase);

  // --- Render by phase ---

  if (phase === 'auth') {
    return (
      <div className="host-view auth-screen">
        <h1>🎵 Spotify Drinking Game</h1>
        <p>You're the host. Login with Spotify to get started.</p>
        <button className="btn-primary btn-large" onClick={redirectToSpotifyLogin}>
          Login with Spotify
        </button>
      </div>
    );
  }

  if (phase === 'callback') {
    return (
      <div className="host-view">
        <h1>Connecting to Spotify...</h1>
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <div className="host-view setup-screen">
        <button className="btn-restart" onClick={handleRestart} title="Restart session">↩ Restart</button>
        <button className="btn-signout" onClick={handleSignOut} title="Sign out of Spotify">Sign out</button>
        <h1>🎵 Spotify Drinking Game</h1>
        <div className="setup-form">
          <div className="form-group">
            <label>Select Playlist</label>
            <select
              value={selectedPlaylistId}
              onChange={(e) => setSelectedPlaylistId(e.target.value)}
            >
              <option value="">-- Choose a playlist --</option>
              {playlists.filter(p => p && p.id).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.tracks?.total ?? '?'} tracks)
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Number of Rounds: {totalRounds}</label>
            <input
              type="range"
              min="1"
              max="30"
              value={totalRounds}
              onChange={(e) => setTotalRounds(Number(e.target.value))}
            />
          </div>

          <div className="form-group">
            <label>Time Between Rounds: {skipDelay}s</label>
            <input
              type="range"
              min="1"
              max="15"
              value={skipDelay}
              onChange={(e) => setSkipDelay(Number(e.target.value))}
            />
          </div>

          <div className="form-group toggle-group">
            <label>
              <input
                type="checkbox"
                checked={hardMode}
                onChange={(e) => setHardMode(e.target.checked)}
              />
              Hard Mode <span className="hint">(-500 pts for wrong guesses)</span>
            </label>
          </div>

          <button
            className="btn-primary btn-large"
            onClick={handleLoadPlaylist}
            disabled={!selectedPlaylistId || loadingTracks}
          >
            {loadingTracks ? 'Loading tracks...' : 'Continue →'}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'lobby') {
    return (
      <div className="host-view lobby-screen">
        <button className="btn-restart" onClick={handleRestart} title="Restart session">↩ Restart</button>
        <button className="btn-signout" onClick={handleSignOut} title="Sign out of Spotify">Sign out</button>
        <h1>🎵 Game Lobby</h1>
        <div className="join-info">
          <p>Players join at:</p>
          <code>{joinUrl}</code>
        </div>

        <div className="player-list">
          <h2>Players ({players.length})</h2>
          {players.length === 0 ? (
            <p className="empty">Waiting for players to join...</p>
          ) : (
            <ul>
              {players.map((p, i) => (
                <li key={i}>{p.name}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="player-status">
          {playerStatus === 'loading' && <p className="hint">Loading Spotify player...</p>}
          {playerStatus === 'not_premium' && (
            <p className="error">Spotify Premium required!</p>
          )}
          {playerStatus === 'error' && (
            <p className="error">Player error — please refresh</p>
          )}
        </div>

        <button
          className="btn-primary btn-large"
          onClick={handleStartGame}
          disabled={players.length === 0 || playerStatus !== 'ready'}
        >
          Start Game! ({players.length} player{players.length !== 1 ? 's' : ''})
        </button>

        <div className="rounds-info">
          <small>{totalRounds} rounds · {tracksRef.current.length} tracks loaded</small>
        </div>
      </div>
    );
  }

  if (phase === 'await-round') {
    return (
      <div className="host-view round-screen">
        <button className="btn-restart" onClick={handleRestart} title="Restart session">↩ Restart</button>
        <h1>Round {roundNumber + 1} / {totalRoundsConfirmed}</h1>
        <p className="hint">Get ready...</p>
        <button className="btn-primary btn-large" onClick={() => {
          if (!playRoundCalledRef.current) {
            playRoundCalledRef.current = true;
            handlePlayRound();
          }
        }}>
          ▶ Play Song ({awaitRoundCountdown}s)
        </button>
      </div>
    );
  }

  if (phase === 'round-active') {
    return (
      <div className="host-view round-screen">
        <button className="btn-restart" onClick={handleRestart} title="Restart session">↩ Restart</button>
        <h2>🎵 Round {roundNumber} / {totalRoundsConfirmed}</h2>
        <p className="hint">Players are listening...</p>
        <p className="hint">Waiting for someone to buzz in</p>
        <button className="btn-secondary" onClick={handleSkip}>
          Skip Round
        </button>
      </div>
    );
  }

  if (phase === 'buzzing') {
    return (
      <div className="host-view round-screen">
        <button className="btn-restart" onClick={handleRestart} title="Restart session">↩ Restart</button>
        <h2>🎵 Round {roundNumber} / {totalRoundsConfirmed}</h2>
        <div className="buzzing-indicator">
          <p className="buzzer-name">⚡ {buzzedPlayer} is guessing!</p>
          <p className="hint">For {buzzPoints} pts — 15s to answer</p>
        </div>
        <button className="btn-secondary" onClick={handleSkip}>
          Skip Round
        </button>
      </div>
    );
  }

  if (phase === 'round-end') {
    return (
      <div className="host-view round-end-screen">
        <button className="btn-restart" onClick={handleRestart} title="Restart session">↩ Restart</button>
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


        <div className="scores">
          <h3>Scores</h3>
          {scores.map((p, i) => (
            <div key={i} className="score-row">
              <span>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`} {p.name}
              </span>
              <span>{p.score} pts</span>
            </div>
          ))}
        </div>

        <button className="btn-primary btn-large" onClick={handleNextRound}>
          Next Round ({roundEndCountdown}s) →
        </button>
      </div>
    );
  }

  if (phase === 'game-over') {
    return (
      <div className="host-view game-over-screen">
        {showRestart && (
          <button className="btn-restart" onClick={handleRestart} title="Restart session">
            ↩ Restart
          </button>
        )}
        <h1>Game Over! 🎉</h1>
        <Leaderboard scores={scores} />
        <button className="btn-primary btn-large" onClick={handlePlayAgain}>
          Play Again
        </button>
      </div>
    );
  }

  return null;
}
