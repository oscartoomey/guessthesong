import { loadSpotifySDK } from './sdk-loader';
import { getValidToken } from '../auth/spotify-auth';
import { spotifyPut } from '../api/spotify-client';

export type PlayerStatus =
  | 'loading'
  | 'ready'
  | 'not_premium'
  | 'error';

export interface PlayerEvents {
  onStatusChange: (status: PlayerStatus) => void;
}

let player: Spotify.Player | null = null;
let deviceId: string | null = null;
let clipTimeout: ReturnType<typeof setTimeout> | null = null;

export function getDeviceId(): string | null {
  return deviceId;
}

export async function initPlayer(events: PlayerEvents): Promise<void> {
  await loadSpotifySDK();

  player = new Spotify.Player({
    name: 'Spotify Heardle',
    getOAuthToken: async (cb) => {
      try {
        const token = await getValidToken();
        cb(token);
      } catch {
        events.onStatusChange('error');
      }
    },
    volume: 0.5,
  });

  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    events.onStatusChange('ready');
  });

  player.addListener('not_ready', () => {
    events.onStatusChange('error');
  });

  player.addListener('initialization_error', () => {
    events.onStatusChange('error');
  });

  player.addListener('authentication_error', () => {
    events.onStatusChange('error');
  });

  player.addListener('account_error', () => {
    events.onStatusChange('not_premium');
  });

  const connected = await player.connect();
  if (!connected) {
    events.onStatusChange('error');
  }
}

async function transferPlayback(): Promise<void> {
  if (!deviceId) throw new Error('Player not ready');

  await spotifyPut('/me/player', {
    device_ids: [deviceId],
    play: false,
  });
}

async function reconnect(): Promise<void> {
  if (!player) throw new Error('No player to reconnect');

  player.disconnect();
  deviceId = null;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Reconnect timed out')), 10000);

    const onReady = ({ device_id }: { device_id: string }) => {
      player!.removeListener('ready', onReady);
      clearTimeout(timeout);
      deviceId = device_id;
      resolve();
    };

    player.addListener('ready', onReady);
    player.connect();
  });
}

export async function playClip(
  trackUri: string,
  durationSeconds: number
): Promise<void> {
  if (!deviceId) throw new Error('Player not ready');

  clearClipTimeout();

  try {
    await spotifyPut(`/me/player/play?device_id=${deviceId}`, {
      uris: [trackUri],
      position_ms: 0,
    });
  } catch {
    try {
      await transferPlayback();
    } catch {
      await reconnect();
    }
    await spotifyPut(`/me/player/play?device_id=${deviceId}`, {
      uris: [trackUri],
      position_ms: 0,
    });
  }

  clipTimeout = setTimeout(async () => {
    await pausePlayback();
  }, durationSeconds * 1000);
}

export async function pausePlayback(): Promise<void> {
  clearClipTimeout();
  if (player) {
    try {
      await player.pause();
    } catch {
      // Player may already be paused
    }
  }
}

export async function resumePlayback(): Promise<void> {
  if (player) {
    try {
      await player.resume();
    } catch {
      // Fallback to API if SDK resume fails
      if (deviceId) {
        await spotifyPut(`/me/player/play?device_id=${deviceId}`);
      }
    }
  }
}

export async function playFull(trackUri: string): Promise<void> {
  if (!deviceId) throw new Error('Player not ready');

  clearClipTimeout();

  try {
    await spotifyPut(`/me/player/play?device_id=${deviceId}`, {
      uris: [trackUri],
      position_ms: 0,
    });
  } catch {
    // Play failed — transfer playback to this device then retry
    try {
      await transferPlayback();
    } catch {
      try {
        await reconnect();
        await transferPlayback();
      } catch {
        // Best-effort — carry on and attempt play anyway
      }
    }
    await new Promise((r) => setTimeout(r, 500));
    await spotifyPut(`/me/player/play?device_id=${deviceId}`, {
      uris: [trackUri],
      position_ms: 0,
    });
  }
}

export function disconnectPlayer(): void {
  clearClipTimeout();
  if (player) {
    player.disconnect();
    player = null;
    deviceId = null;
  }
}

function clearClipTimeout(): void {
  if (clipTimeout !== null) {
    clearTimeout(clipTimeout);
    clipTimeout = null;
  }
}
