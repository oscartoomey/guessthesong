let loadPromise: Promise<void> | null = null;

export function loadSpotifySDK(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    if (window.Spotify) {
      resolve();
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => resolve();

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => reject(new Error('Failed to load Spotify SDK'));
    document.body.appendChild(script);
  });

  return loadPromise;
}
