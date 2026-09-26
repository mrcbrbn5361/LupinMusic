import * as http from 'http';
import type { BotServerState, Track, PlaybackStatus } from '../../types/index.js';

export class BotServer {
  private server: http.Server | null = null;
  private port: number = 9863;
  private isRunning: boolean = false;
  private state: BotServerState = {
    app: 'Lupin Music',
    version: '1.0.0',
    status: 'stopped',
    isPlaying: false,
    track: null,
    currentTime: 0,
    duration: 0,
    progress: 0,
    updatedAt: Date.now()
  };

  private onControlCallback?: (action: string, payload?: any) => void;
  private retriedPort: boolean = false;

  constructor(port: number = 9863) {
    this.port = port;
  }

  public setControlCallback(cb: (action: string, payload?: any) => void): void {
    this.onControlCallback = cb;
  }

  public updatePlaybackState(partial: {
    status?: PlaybackStatus;
    isPlaying?: boolean;
    track?: Track | null;
    currentTime?: number;
    duration?: number;
    progress?: number;
  }): void {
    // Disari acik API siniri: sonsuz/devasa degerler asla yayinlanmaz
    // (or. bos durumda duration=121601512 goruldu).
    const sane = (v: number | undefined, fallback = 0): number => {
      const n = Number(v);
      if (!isFinite(n) || n < 0) return fallback;
      return Math.min(n, 12 * 3600);
    };
    const next = { ...partial };
    if (next.currentTime !== undefined) next.currentTime = sane(next.currentTime);
    if (next.duration !== undefined) next.duration = sane(next.duration);
    if (next.progress !== undefined) {
      const p = Number(next.progress);
      next.progress = isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
    }
    this.state = {
      ...this.state,
      ...next,
      updatedAt: Date.now()
    };
  }

  public getState(): BotServerState {
    return this.state;
  }

  public start(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isRunning) {
        return resolve(true);
      }

      this.server = http.createServer((req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }

        const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

        if (req.method === 'GET' && (url.pathname === '/api/v1/state' || url.pathname === '/state')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(this.state));
        }

        // Discord Webhook & Bot Uyumlu Özel Renkli Lupin Music Embed Çıktısı
        if (req.method === 'GET' && (url.pathname === '/api/v1/discord/embed' || url.pathname === '/discord/embed')) {
          const track = this.state.track;
          const fmt = (sec: number) => {
            if (isNaN(sec) || sec < 0) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return `${m}:${s < 10 ? '0' : ''}${s}`;
          };

          const isPink = url.searchParams.get('color') !== 'purple';
          // Lupin Pembe: #ec4899 (15485081), Lupin Mor: #8b5cf6 (9133302)
          const embedColor = isPink ? 0xec4899 : 0x8b5cf6;

          const embed = {
            embeds: [
              {
                title: track ? `🎵 ${track.title}` : 'Lupin Music • Çalma Sırası Boş',
                description: track
                  ? `**Sanatçı:** ${track.artist}\n**Durum:** ${this.state.isPlaying ? '▶️ Çalıyor' : '⏸️ Duraklatıldı'}\n\n[🎧 Birlikte Dinle (Lupin Party)](https://discord.gg/Rma8w8JrQH)`
                  : 'Şu anda Lupin Music uygulamasında aktif bir şarkı çalmıyor.',
                color: embedColor,
                author: {
                  name: 'Lupin Music • Birlikte Dinle',
                  icon_url: 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png'
                },
                thumbnail: {
                  url: track?.thumbnail || 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png'
                },
                fields: [
                  {
                    name: '⏳ Süre',
                    value: `\`${fmt(this.state.currentTime)} / ${fmt(this.state.duration)}\``,
                    inline: true
                  },
                  {
                    name: '🔊 İlerleme',
                    value: `%${Math.round(this.state.progress || 0)}`,
                    inline: true
                  },
                  {
                    name: '👥 Katılım',
                    value: '[Birlikte Dinle](https://discord.gg/Rma8w8JrQH)',
                    inline: true
                  }
                ],
                footer: {
                  text: 'Lupin Music • Ultra Luxury Sound Experience',
                  icon_url: 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png'
                },
                timestamp: new Date().toISOString()
              }
            ]
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(embed));
        }

        if (req.method === 'GET' && url.pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'ok', app: 'Lupin Music', port: this.port }));
        }

        if (req.method === 'POST' && url.pathname === '/api/v1/playback') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (typeof parsed.action !== 'string' || !parsed.action) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing action' }));
                return;
              }
              if (this.onControlCallback) {
                this.onControlCallback(parsed.action, parsed.payload);
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, action: parsed.action }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            }
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && !this.retriedPort) {
          this.retriedPort = true;
          console.warn(`[BotServer] Port ${this.port} in use, retrying once in 3s...`);
          setTimeout(() => {
            if (!this.isRunning) this.start();
          }, 3000);
        } else if (err.code === 'EADDRINUSE') {
          console.warn(`[BotServer] Port ${this.port} still in use, giving up (single retry done).`);
        } else {
          console.error('[BotServer] Server error:', err);
        }
        resolve(false);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        this.isRunning = true;
        console.log(`[BotServer] ✅ Lupin Bot Server listening on http://127.0.0.1:${this.port}`);
        resolve(true);
      });
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.isRunning = false;
      console.log('[BotServer] Stopped');
    }
  }
}
