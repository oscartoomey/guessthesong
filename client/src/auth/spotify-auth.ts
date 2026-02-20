import { generatePKCE } from './pkce';
import {
  storeTokens,
  getStoredTokens,
  isTokenExpired,
  clearTokens,
  storeCodeVerifier,
  getCodeVerifier,
  clearCodeVerifier,
} from './token-store';
import type { SpotifyTokenResponse } from '../types/spotify';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
// Spotify only allows http:// redirect URIs for localhost.
// Always redirect to localhost so OAuth works even when the page is
// loaded via a LAN IP — the host machine is always localhost.
const REDIRECT_URI = `http://localhost:${window.location.port}`;
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';

export async function redirectToSpotifyLogin(role = 'host'): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  storeCodeVerifier(verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: `role:${role}`,
  });

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

// Guard against double-execution (React StrictMode / page refresh)
let callbackInProgress: Promise<boolean> | null = null;

export function handleCallback(): Promise<boolean> {
  if (callbackInProgress) return callbackInProgress;
  callbackInProgress = doHandleCallback();
  return callbackInProgress;
}

async function doHandleCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const state = params.get('state') || '';

  // Extract role from state param (e.g. "role:host")
  const roleMatch = state.match(/^role:(\w+)$/);
  const returnQuery = roleMatch ? `role=${roleMatch[1]}` : '';

  if (error) {
    console.error('Spotify auth error:', error);
    window.history.replaceState({}, '', returnQuery ? `/?${returnQuery}` : '/');
    return false;
  }

  if (!code) return false;

  // Clean URL, restoring the role param
  window.history.replaceState({}, '', returnQuery ? `/?${returnQuery}` : '/');

  const verifier = getCodeVerifier();
  if (!verifier) {
    console.error('No code verifier found');
    return false;
  }

  // Clear verifier immediately to prevent re-use
  clearCodeVerifier();

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      console.error('Token exchange failed:', response.status, errorBody);
      clearTokens();
      return false;
    }

    const data: SpotifyTokenResponse = await response.json();
    storeTokens(data.access_token, data.refresh_token, data.expires_in);
    return true;
  } catch (err) {
    console.error('Token exchange error:', err);
    clearTokens();
    return false;
  }
}

// Mutex for concurrent refresh prevention
let refreshPromise: Promise<string> | null = null;

export async function getValidToken(): Promise<string> {
  const tokens = getStoredTokens();
  if (!tokens) throw new Error('No tokens stored');

  if (!isTokenExpired()) {
    return tokens.accessToken;
  }

  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise;

  refreshPromise = refreshAccessToken(tokens.refreshToken);
  try {
    const token = await refreshPromise;
    return token;
  } finally {
    refreshPromise = null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    clearTokens();
    throw new Error('Token refresh failed');
  }

  const data: SpotifyTokenResponse = await response.json();
  storeTokens(
    data.access_token,
    data.refresh_token || refreshToken,
    data.expires_in
  );
  return data.access_token;
}

export async function forceRefreshToken(): Promise<string> {
  const tokens = getStoredTokens();
  if (!tokens) throw new Error('No tokens stored');
  return refreshAccessToken(tokens.refreshToken);
}

export function isAuthenticated(): boolean {
  return getStoredTokens() !== null;
}

export function logout(): void {
  clearTokens();
  localStorage.removeItem('dg_playlists_cache');
}
