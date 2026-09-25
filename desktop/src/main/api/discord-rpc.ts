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
  private statusCallback?: (s: { connected: boolean; enabled: boolean }) => void;

  constructor(enabled: boolean = true, customClientId?: string) {
    this.enabled = enabled;
    if (customClientId && customClientId.trim().length >= 10) {
      this.clientId = customClientId.trim();
    }
    if (this.enabled) {
      this.startReconnectLoop();
    }
  }

  /** Baglanti durumu degisikliklerini dinle (Ayarlar UI gostergesi icin). */
  public setOnStatusChange(cb: (s: { connected: boolean; enabled: boolean }) => void): void {
    this.statusCallback = cb;
    cb({ connected: this.isConnected, enabled: this.enabled });
  }

  public getStatus(): { connected: boolean; enabled: boolean } {
    return { connected: this.isConnected, enabled: this.enabled };
  }

  private emitStatus(): void {
    try {
      this.statusCallback?.({ connected: this.isConnected, enabled: this.enabled });
    } catch {}
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
    this.emitStatus();
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

      client.on('ready', () => {
        if (gen !== this.connectGeneration) return;
        this.isConnected = true;
        this.isConnecting = false;
        console.log('[DiscordRPC] ✅ Discord Rich Presence connected (App ID: ' + this.clientId + ')');
        this.emitStatus();
        if (this.currentTrack && this.currentStatus === 'playing') {
          this.sendActivity(this.currentTrack, this.currentStatus, this.currentTime);
        }
      });

      client.on('disconnected', () => {
        if (gen === this.connectGeneration) {
          this.isConnected = false;
          this.isConnecting = false;
          console.log('[DiscordRPC] Discord Rich Presence disconnected.');
          this.emitStatus();
        }
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Discord connect timeout')), 8000)
      );

      await Promise.race([client.login({ clientId: this.clientId }), timeoutPromise]);
      return true;
    } catch (err) {
      if (gen === this.connectGeneration) {
        this.isConnected = false;
        this.isConnecting = false;
        try { this.rpc?.destroy(); } catch {}
        this.rpc = null;
        this.emitStatus();
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

      const nowMs = Date.now();
      const curSec = Math.max(0, Math.floor(currentTime));
      const durSec = Math.max(0, Math.floor(track.duration || 0));

      let startTimestamp: number | undefined;
      let endTimestamp: number | undefined;

      if (isPlaying) {
        startTimestamp = nowMs - (curSec * 1000);
        if (durSec > 0 && durSec > curSec) {
          endTimestamp = startTimestamp + (durSec * 1000);
        }
      }

      // Kapak resmi: Parçanın albüm kapağı (HTTPS) doğrudan Discord Media Proxy tarafından işlenir
      const cover = (track.thumbnail || '').trim();
      const defaultLogo = 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png';
      const largeImage = cover.startsWith('http') ? cover : defaultLogo;

      const buttons: { label: string; url: string }[] = [
        { label: '✨ Lupin Music • Dinle', url: `https://lupinmusic.vercel.app/play?id=${track.id}` },
        { label: '👥 Birlikte Dinle (Party)', url: `https://lupinmusic.vercel.app/party?id=${track.id}&t=${Math.floor(currentTime)}` }
      ];

      // Standart setActivity (Type 0 = Playing) + Spotify-tarzı Party & Birlikte Dinle desteği!
      const activityPayload: any = {
        details: safeTitle,
        state: safeArtist,
        startTimestamp,
        endTimestamp,
        largeImageKey: largeImage,
        largeImageText: (track.album || track.title || 'Lupin Music • Ultra Luxury Sound').slice(0, 128),
        smallImageKey: defaultLogo,
        smallImageText: isPlaying ? 'Çalıyor • Lupin Music' : 'Duraklatıldı',
        instance: false,
        partyId: `lupin_${track.id}`,
        partySize: 1,
        partyMax: 10,
        joinSecret: `lupin_party_${track.id}`,
        buttons
      };

      this.rpc.setActivity(activityPayload).then(() => {
        console.log(`[DiscordRPC] 🎵 Activity updated: "${safeTitle}" - ${safeArtist} (${status})`);
      }).catch((e: any) => {
        console.warn('[DiscordRPC] setActivity failed:', e?.message || e);
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
    this.emitStatus();
  }
}
