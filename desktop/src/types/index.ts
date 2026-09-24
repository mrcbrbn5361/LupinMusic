export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  duration?: number;
  durationFormatted?: string;
  currentTime?: number;
  currentTimeFormatted?: string;
  progress?: number;
  url?: string;
  streamUrl?: string;
  lyrics?: string;
}

export type PlaybackStatus = 'playing' | 'paused' | 'stopped';

export interface BotServerState {
  app: string;
  version: string;
  status: PlaybackStatus;
  isPlaying: boolean;
  track: Track | null;
  currentTime: number;
  duration: number;
  progress: number;
  updatedAt: number;
}

export interface SearchResult {
  tracks: Track[];
  artists: any[];
  albums: any[];
}

export interface AppSettings {
  discordRpcEnabled: boolean;
  discordAppId?: string;
  discordWebhookUrl?: string;
  botServerPort: number;
  volume: number;
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;
}
