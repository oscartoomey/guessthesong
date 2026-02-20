const KEYS = {
  ACCESS_TOKEN: 'spotify_access_token',
  REFRESH_TOKEN: 'spotify_refresh_token',
  EXPIRES_AT: 'spotify_token_expires_at',
  CODE_VERIFIER: 'spotify_code_verifier',
} as const;

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function storeTokens(
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): void {
  const expiresAt = Date.now() + expiresIn * 1000;
  localStorage.setItem(KEYS.ACCESS_TOKEN, accessToken);
  localStorage.setItem(KEYS.REFRESH_TOKEN, refreshToken);
  localStorage.setItem(KEYS.EXPIRES_AT, expiresAt.toString());
}

export function getStoredTokens(): StoredTokens | null {
  const accessToken = localStorage.getItem(KEYS.ACCESS_TOKEN);
  const refreshToken = localStorage.getItem(KEYS.REFRESH_TOKEN);
  const expiresAt = localStorage.getItem(KEYS.EXPIRES_AT);

  if (!accessToken || !refreshToken || !expiresAt) return null;

  return {
    accessToken,
    refreshToken,
    expiresAt: parseInt(expiresAt, 10),
  };
}

export function isTokenExpired(): boolean {
  const tokens = getStoredTokens();
  if (!tokens) return true;
  // Consider expired 60s early to avoid edge cases
  return Date.now() >= tokens.expiresAt - 60_000;
}

export function clearTokens(): void {
  localStorage.removeItem(KEYS.ACCESS_TOKEN);
  localStorage.removeItem(KEYS.REFRESH_TOKEN);
  localStorage.removeItem(KEYS.EXPIRES_AT);
}

export function storeCodeVerifier(verifier: string): void {
  sessionStorage.setItem(KEYS.CODE_VERIFIER, verifier);
}

export function getCodeVerifier(): string | null {
  return sessionStorage.getItem(KEYS.CODE_VERIFIER);
}

export function clearCodeVerifier(): void {
  sessionStorage.removeItem(KEYS.CODE_VERIFIER);
}
