import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { Track, AppSettings } from '../../types/index.js';

export interface LocalStoreData {
  settings: AppSettings;
  likedTracks: Track[];
  history: Track[];
  queue: Track[];
}

const defaultData: LocalStoreData = {
  settings: {
    discordRpcEnabled: true,
    discordAppId: '',
    discordWebhookUrl: '',
    adblockEnabled: true,
    botServerPort: 9863,
    volume: 0.8,
    repeat: 'off',
    shuffle: false
  },
  likedTracks: [],
  history: [],
  queue: []
};

export class AppStore {
  private filePath: string;
  private data: LocalStoreData;

  constructor() {
    const userData = app.getPath('userData');
    this.filePath = path.join(userData, 'lupin_store.json');
    this.data = this.load();
  }

  private load(): LocalStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // settings'i derin birlestir: eski kayitlar yeni anahtarlari kaybetmesin
        return {
          ...defaultData,
          ...parsed,
          settings: { ...defaultData.settings, ...(parsed.settings || {}) }
        };
      }
    } catch (e) {
      console.warn('[AppStore] Failed to load store, using defaults:', e);
    }
    return { ...defaultData };
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[AppStore] Failed to save store:', e);
    }
  }

  public getSettings(): AppSettings {
    return this.data.settings;
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...partial };
    this.save();
    return this.data.settings;
  }

  public getLikedTracks(): Track[] {
    return this.data.likedTracks;
  }

  public toggleLikeTrack(track: Track): boolean {
    const idx = this.data.likedTracks.findIndex(t => t.id === track.id);
    if (idx >= 0) {
      this.data.likedTracks.splice(idx, 1);
      this.save();
      return false;
    } else {
      this.data.likedTracks.unshift(track);
      this.save();
      return true;
    }
  }

  public addToHistory(track: Track): void {
    this.data.history = this.data.history.filter(t => t.id !== track.id);
    this.data.history.unshift(track);
    if (this.data.history.length > 50) {
      this.data.history = this.data.history.slice(0, 50);
    }
    this.save();
  }

  public getHistory(): Track[] {
    return this.data.history;
  }
}
