export interface Player {
  name: string;
  score: number;
}

export interface Song {
  trackName: string;
  artists: string[];
  trackUri: string;
  albumArt?: string;
}
