// Spotify Web API types

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyUser {
  id: string;
  display_name: string | null;
  images: SpotifyImage[];
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  images: SpotifyImage[];
  tracks: { total: number };
  owner: { display_name: string | null };
}

export interface SpotifyArtist {
  id: string;
  name: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: SpotifyImage[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  duration_ms: number;
  is_local: boolean;
  is_playable?: boolean;
  type: string;
}

export interface SpotifyPlaylistTrackItem {
  track: SpotifyTrack | null;  // legacy format
  item: SpotifyTrack | null;   // new API format
  is_local: boolean;
}

export interface SpotifyPaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

// Spotify Web Playback SDK types
declare global {
  interface Window {
    Spotify: typeof Spotify;
    onSpotifyWebPlaybackSDKReady: () => void;
  }

  namespace Spotify {
    interface PlayerInit {
      name: string;
      getOAuthToken: (cb: (token: string) => void) => void;
      volume?: number;
    }

    interface WebPlaybackPlayer {
      device_id: string;
    }

    interface WebPlaybackState {
      paused: boolean;
      position: number;
      duration: number;
      track_window: {
        current_track: {
          uri: string;
          name: string;
          artists: { name: string; uri: string }[];
          album: { name: string; uri: string; images: { url: string }[] };
        };
      };
    }

    interface WebPlaybackError {
      message: string;
    }

    class Player {
      constructor(options: PlayerInit);
      connect(): Promise<boolean>;
      disconnect(): void;
      addListener(
        event: 'ready',
        cb: (data: { device_id: string }) => void
      ): void;
      addListener(
        event: 'not_ready',
        cb: (data: { device_id: string }) => void
      ): void;
      addListener(
        event: 'player_state_changed',
        cb: (state: WebPlaybackState | null) => void
      ): void;
      addListener(
        event: 'initialization_error',
        cb: (error: WebPlaybackError) => void
      ): void;
      addListener(
        event: 'authentication_error',
        cb: (error: WebPlaybackError) => void
      ): void;
      addListener(
        event: 'account_error',
        cb: (error: WebPlaybackError) => void
      ): void;
      removeListener(event: 'ready', cb: (data: { device_id: string }) => void): void;
      pause(): Promise<void>;
      resume(): Promise<void>;
      togglePlay(): Promise<void>;
      seek(positionMs: number): Promise<void>;
      setVolume(volume: number): Promise<void>;
      getCurrentState(): Promise<WebPlaybackState | null>;
    }
  }
}

export {};
