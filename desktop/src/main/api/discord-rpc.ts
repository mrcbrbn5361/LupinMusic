import RPC from 'discord-rpc';
import type { Track, PlaybackStatus } from '../../types/index.js';

// Registered Official Lupin Music Discord Client ID
const DEFAULT_CLIENT_ID = '1552301617938825216';

export class DiscordRpcManager {
  private rpc: RPC.Client | null = null;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private enabled: boolean = true;
  private clientId: string = DEFAULT_CLIENT_ID;
  private currentTrack: Track | null = null;
  private currentStatus: PlaybackStatus = 'stopped';
  private currentTime: number = 0;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private connectGeneration: number = 0;
  private lastActivitySentTime: number = 0;
  private lastSentTrackId?: string;
  private lastSentStatus?: PlaybackStatus;
  private lastSentCurrentTime: number = 0;
  private lastSentDuration: number = 0;
  private throttleTimeout: NodeJS.Timeout | null = null;
  private pendingPayload: { track: Track | null; status: PlaybackStatus; currentTime: number } | null = null;

  constructor(enabled: boolean = true, customClientId?: string) {
    this.enabled = enabled;
    if (customClientId && customClientId.trim().length >= 10) {
      this.clientId = customClientId.trim();
    }
    if (this.enabled) {
      this.startReconnectLoop();
    }
  }

  public async setClientId(newId?: string): Promise<void> {
    const target = (newId && newId.trim().length >= 10) ? newId.trim() : DEFAULT_CLIENT_ID;
    if (target === this.clientId) return;
    this.clientId = target;
    console.log('[DiscordRPC] Client ID updated to:', this.clientId);
    if (this.enabled) {
      this.destroy();
      await this.connect();
    }
  }

  public getClientId(): string {
    return this.clientId;
  }

  public setEnabled(val: boolean): void {
    this.enabled = val;
    if (!val) {
      this.clear();
      this.stopReconnectLoop();
      this.destroy();
    } else {
      this.startReconnectLoop();
      this.connect();
    }
  }

  private startReconnectLoop(): void {
    if (this.reconnectInterval) return;
    this.reconnectInterval = setInterval(() => {
      if (this.enabled && !this.isConnected && !this.isConnecting) {
        this.connect().catch(() => {});
      }
    }, 15000);
  }

  private stopReconnectLoop(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  public async connect(): Promise<boolean> {
    if (!this.enabled || this.isConnecting || this.isConnected) return this.isConnected;
    this.isConnecting = true;
    const gen = ++this.connectGeneration;

    try {
      if (this.rpc) {
        try { this.rpc.destroy(); } catch {}
        this.rpc = null;
      }

      this.rpc = new RPC.Client({ transport: 'ipc' });
      const client = this.rpc;

      const readyPromise = new Promise<boolean>((resolve) => {
        client.on('ready', () => {
          if (gen !== this.connectGeneration) return resolve(false);
          this.isConnected = true;
          this.isConnecting = false;
          console.log('[DiscordRPC] ✅ Discord Rich Presence connected (App ID: ' + this.clientId + ')');
          if (this.currentTrack && this.currentStatus === 'playing') {
            this.sendActivity(this.currentTrack, this.currentStatus, this.currentTime);
          }
          resolve(true);
        });

        client.on('disconnected', () => {
          if (gen === this.connectGeneration) {
            this.isConnected = false;
            this.isConnecting = false;
            console.log('[DiscordRPC] Discord Rich Presence disconnected.');
          }
        });
      });

      const loginPromise = client.login({ clientId: this.clientId });
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Discord connect timeout')), 3500)
      );

      await Promise.race([Promise.all([readyPromise, loginPromise]), timeoutPromise]);
      return true;
    } catch (err) {
      if (gen === this.connectGeneration) {
        this.isConnected = false;
        this.isConnecting = false;
        try { this.rpc?.destroy(); } catch {}
        this.rpc = null;
      }
      return false;
    }
  }

  public update(track: Track | null, status: PlaybackStatus, currentTime: number = 0): void {
    this.currentTrack = track;
    this.currentStatus = status;
    this.currentTime = currentTime;

    if (!this.enabled) return;

    if (!this.isConnected || !this.rpc) {
      if (!this.isConnecting) {
        this.connect().catch(() => {});
      }
      return;
    }

    if (!track || status === 'stopped') {
      if (this.lastSentTrackId !== undefined || this.lastSentStatus !== 'stopped') {
        this.clear();
      }
      return;
    }

    // State diffing: if same track, same status, and no significant seek (seek > 3s),
    // skip sending SET_ACTIVITY to avoid hitting Discord's 5 updates / 20 seconds rate limit!
    const trackChanged = track.id !== this.lastSentTrackId;
    const statusChanged = status !== this.lastSentStatus;
    const durChanged = Math.abs((track.duration || 0) - this.lastSentDuration) > 1 && (track.duration || 0) > 0;
    
    // Expected time elapsed since last activity dispatch
    const secondsSinceLastDispatch = (Date.now() - this.lastActivitySentTime) / 1000;
    const expectedCurrentTime = this.lastSentCurrentTime + (this.lastSentStatus === 'playing' ? secondsSinceLastDispatch : 0);
    const seekOccurred = Math.abs(currentTime - expectedCurrentTime) > 3.5;

    if (!trackChanged && !statusChanged && !durChanged && !seekOccurred) {
      // Nothing significant changed — Discord client handles countdown/scrubber automatically!
      return;
    }

    // Discord Rate-Limit Guard (Minimum 1.5s between requests)
    const now = Date.now();
    const timeSinceLastSend = now - this.lastActivitySentTime;

    if (timeSinceLastSend < 1500) {
      this.pendingPayload = { track, status, currentTime };
      if (!this.throttleTimeout) {
        this.throttleTimeout = setTimeout(() => {
          this.throttleTimeout = null;
          if (this.pendingPayload) {
            const p = this.pendingPayload;
            this.pendingPayload = null;
            this.sendActivity(p.track, p.status, p.currentTime);
          }
        }, 1500 - timeSinceLastSend);
      }
      return;
    }

    if (this.throttleTimeout) {
      clearTimeout(this.throttleTimeout);
      this.throttleTimeout = null;
    }
    this.pendingPayload = null;

    this.sendActivity(track, status, currentTime);
  }

  private sendActivity(track: Track | null, status: PlaybackStatus, currentTime: number = 0): void {
    if (!this.rpc || !this.isConnected || !track || status === 'stopped') return;

    try {
      this.lastActivitySentTime = Date.now();
      this.lastSentTrackId = track.id;
      this.lastSentStatus = status;
      this.lastSentCurrentTime = currentTime;
      this.lastSentDuration = track.duration || 0;

      const isPlaying = status === 'playing';
      const safeTitle = (track.title || 'Lupin Music').slice(0, 128);
      const safeArtist = (track.artist ? `by ${track.artist}` : 'Lupin Audio').slice(0, 128);

      const now = Math.floor(Date.now() / 1000);
      const cur = Math.max(0, Math.floor(currentTime));
      const dur = Math.max(0, Math.floor(track.duration || 0));

      const timestamps: Record<string, number> = {};
      if (isPlaying) {
        timestamps.start = now - cur;
        if (dur > 0 && dur > cur) {
          timestamps.end = timestamps.start + dur;
        }
      }

      // Large and small image keys
      const cover = (track.thumbnail || '').trim();
      const assets: Record<string, string> = {
        large_image: cover.startsWith('http') ? cover.slice(0, 256) : 'lupin_logo',
        large_text: (track.album || track.title || 'Lupin Music').slice(0, 128),
        small_image: isPlaying ? 'play_icon' : 'pause_icon',
        small_text: isPlaying ? 'Lupin Music • Çalıyor' : 'Lupin Music • Duraklatıldı'
      };

      const buttons = [
        { label: '💜 Discord Sunucusu', url: 'https://discord.gg/Rma8w8JrQH' },
        { label: '🎵 Lupin Music', url: 'https://github.com/mrcbrbn5361' }
      ];

      // Type 2 = Listening to / Dinliyor
      const activity: Record<string, any> = {
        type: 2,
        details: safeTitle,
        state: safeArtist,
        instance: false,
        assets,
        timestamps: Object.keys(timestamps).length > 0 ? timestamps : undefined,
        buttons
      };

      console.log(`[DiscordRPC] 🎵 Activity updated: "${safeTitle}" - ${safeArtist} (${status})`);

      // Direct IPC request allows Type 2 ("Listening to")
      (this.rpc as any).request('SET_ACTIVITY', { pid: process.pid, activity })
        .catch(async () => {
          // Fallback to standard setActivity
          if (this.rpc && this.isConnected) {
            try {
              await this.rpc.setActivity({
                details: safeTitle,
                state: safeArtist,
                startTimestamp: timestamps.start,
                endTimestamp: timestamps.end,
                largeImageKey: assets.large_image,
                largeImageText: assets.large_text,
                smallImageKey: assets.small_image,
                smallImageText: assets.small_text,
                instance: false,
                buttons
              });
            } catch {}
          }
        });
    } catch (e: any) {
      console.debug('[DiscordRPC] Activity update error:', e?.message || e);
    }
  }

  public clear(): void {
    this.lastSentTrackId = undefined;
    this.lastSentStatus = 'stopped';
    if (this.throttleTimeout) {
      clearTimeout(this.throttleTimeout);
      this.throttleTimeout = null;
    }
    this.pendingPayload = null;

    if (this.rpc && this.isConnected) {
      try {
        this.rpc.clearActivity().catch(() => {});
      } catch {}
    }
  }

  public destroy(): void {
    this.stopReconnectLoop();
    this.clear();
    this.connectGeneration++;
    if (this.rpc) {
      try {
        this.rpc.destroy();
      } catch (e) {}
      this.rpc = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
  }
}
