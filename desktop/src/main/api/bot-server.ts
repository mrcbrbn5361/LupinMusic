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
    this.state = {
      ...this.state,
      ...partial,
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
              if (this.onControlCallback && parsed.action) {
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
        if (err.code === 'EADDRINUSE') {
          console.warn(`[BotServer] Port ${this.port} in use, retrying in 3s...`);
          setTimeout(() => {
            if (!this.isRunning) this.start();
          }, 3000);
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
