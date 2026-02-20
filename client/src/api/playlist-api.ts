import { spotifyFetch } from './spotify-client';
import type {
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyPlaylistTrackItem,
  SpotifyPaginatedResponse,
} from '../types/spotify';

const PLAYLISTS_CACHE_KEY = 'dg_playlists_cache';
const PLAYLISTS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function fetchUserPlaylists(): Promise<SpotifyPlaylist[]> {
  // Return cached result if still fresh
  try {
    const raw = localStorage.getItem(PLAYLISTS_CACHE_KEY);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < PLAYLISTS_CACHE_TTL) {
        return data as SpotifyPlaylist[];
      }
    }
  } catch {
    // Ignore corrupt cache
  }

  const page = await spotifyFetch<SpotifyPaginatedResponse<SpotifyPlaylist>>(
    `/me/playlists?limit=50&offset=0`
  );

  try {
    localStorage.setItem(
      PLAYLISTS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data: page.items })
    );
  } catch {
    // Ignore storage errors
  }

  return page.items;
}

function extractTracks(
  items: SpotifyPlaylistTrackItem[],
  into: SpotifyTrack[]
): void {
  for (const item of items) {
    const track = item.item ?? item.track;
    if (
      track &&
      !item.is_local &&
      !track.is_local &&
      track.type === 'track' &&
      track.is_playable !== false
    ) {
      into.push(track);
    }
  }
}

export async function searchSpotifyTracks(query: string): Promise<SpotifyTrack[]> {
  const result = await spotifyFetch<{ tracks: SpotifyPaginatedResponse<SpotifyTrack> }>(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=10&market=from_token`
  );
  return result.tracks.items.filter((t) => t && t.uri && t.is_playable !== false);
}

export async function fetchPlaylistTracks(
  playlistId: string
): Promise<SpotifyTrack[]> {
  const limit = 50;

  // Fetch first page to get total
  const firstPage = await spotifyFetch<
    SpotifyPaginatedResponse<SpotifyPlaylistTrackItem>
  >(`/playlists/${playlistId}/items?limit=${limit}&offset=0`);

  const total = firstPage.total;
  const tracks: SpotifyTrack[] = [];

  // For small playlists (<=100), use all tracks
  if (total <= 100) {
    extractTracks(firstPage.items, tracks);
    if (firstPage.next) {
      const page2 = await spotifyFetch<
        SpotifyPaginatedResponse<SpotifyPlaylistTrackItem>
      >(`/playlists/${playlistId}/items?limit=${limit}&offset=${limit}`);
      extractTracks(page2.items, tracks);
    }
    return tracks;
  }

  // For large playlists, fetch two random pages (skip the first page to reduce repeats)
  const totalPages = Math.ceil(total / limit);
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);

  // Pick two distinct random page indices, excluding page 0
  const page1Idx = 1 + (arr[0] % (totalPages - 1));
  let page2Idx = 1 + (arr[1] % (totalPages - 1));
  if (page2Idx === page1Idx && totalPages > 2) {
    page2Idx = (page2Idx % (totalPages - 1)) + 1;
  }

  const randomPage1 = await spotifyFetch<
    SpotifyPaginatedResponse<SpotifyPlaylistTrackItem>
  >(`/playlists/${playlistId}/items?limit=${limit}&offset=${page1Idx * limit}`);
  extractTracks(randomPage1.items, tracks);

  if (page2Idx !== page1Idx) {
    const randomPage2 = await spotifyFetch<
      SpotifyPaginatedResponse<SpotifyPlaylistTrackItem>
    >(`/playlists/${playlistId}/items?limit=${limit}&offset=${page2Idx * limit}`);
    extractTracks(randomPage2.items, tracks);
  }

  return tracks;
}
