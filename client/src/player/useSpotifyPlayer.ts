import { useState, useEffect, useCallback, useRef } from 'react';
import {
  initPlayer,
  playClip as playerPlayClip,
  pausePlayback,
  resumePlayback,
  playFull as playerPlayFull,
  disconnectPlayer,
  type PlayerStatus,
} from './spotify-player';

export function useSpotifyPlayer(isAuthenticated: boolean) {
  const [status, setStatus] = useState<PlayerStatus>('loading');
  const initRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || initRef.current) return;
    initRef.current = true;

    initPlayer({
      onStatusChange: setStatus,
    }).catch(() => setStatus('error'));

    return () => {
      disconnectPlayer();
      initRef.current = false;
    };
  }, [isAuthenticated]);

  const playClip = useCallback(
    async (trackUri: string, durationSeconds: number) => {
      await playerPlayClip(trackUri, durationSeconds);
    },
    []
  );

  const pause = useCallback(async () => {
    await pausePlayback();
  }, []);

  const resume = useCallback(async () => {
    await resumePlayback();
  }, []);

  const playFull = useCallback(async (trackUri: string) => {
    await playerPlayFull(trackUri);
  }, []);

  return { status, playClip, pause, resume, playFull };
}
