import { getValidToken, forceRefreshToken } from '../auth/spotify-auth';

const BASE_URL = 'https://api.spotify.com/v1';

async function spotifyFetchWithRetry<T>(
  endpoint: string,
  options: RequestInit,
  attempt: number
): Promise<T> {
  const token = await getValidToken();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if ((response.status === 401 || response.status === 403) && attempt === 0) {
    await forceRefreshToken();
    return spotifyFetchWithRetry<T>(endpoint, options, attempt + 1);
  }

  if (response.status === 429 && attempt < 5) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
    const backoff = Math.max(retryAfter || 5, 3 * 2 ** attempt);
    console.warn(`Rate limited — retrying in ${backoff}s (attempt ${attempt + 1})`);
    await new Promise((r) => setTimeout(r, backoff * 1000));
    return spotifyFetchWithRetry<T>(endpoint, options, attempt + 1);
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    console.error('Spotify API error:', response.status, endpoint, errorBody);
    throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
  }

  // Some endpoints return 204 with no body
  if (response.status === 204) return undefined as T;

  return response.json();
}

export function spotifyFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  return spotifyFetchWithRetry<T>(endpoint, options, 0);
}

export async function spotifyPut(
  endpoint: string,
  body?: object
): Promise<void> {
  const token = await getValidToken();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 || response.status === 403) {
    // Token revoked or invalid — force refresh and retry once
    const freshToken = await forceRefreshToken();
    const retry = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${freshToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!retry.ok) {
      throw new Error(`Spotify API error: ${retry.status} ${retry.statusText}`);
    }
    return;
  }

  if (!response.ok) {
    throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
  }
}
