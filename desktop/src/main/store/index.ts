import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { Track, AppSettings, FollowedArtist } from '../../types/index.js';

export interface UserPlaylist {
  id: string;
  name: string;
  createdAt: number;
  tracks: Track[];
}

export interface LocalStoreData {
  settings: AppSettings;
  likedTracks: Track[];
  history: Track[];
  queue: Track[];
  playlists: UserPlaylist[];
  followedArtists: FollowedArtist[];
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
  queue: [],
  playlists: [],
  followedArtists: []
};

export class AppStore {
  private filePath: string;
  private data: LocalStoreData;

  constructor() {
    const userData = app.getPath('userData');
    this.filePath = path.join(userData, 'lupin_store.json');
    this.migrateLegacyStore(userData);
    this.data = this.load();
  }

  // app.setName('Lupin Music') sonrasi userData yolu degisti; eski adlandirma
  // altindaki (lupin-music-desktop / Electron) magaza ilk acilista kopyalanir.
  private migrateLegacyStore(userData: string): void {
    try {
      if (fs.existsSync(this.filePath)) return;
      for (const legacyName of ['Lupin Music', 'lupin-music-desktop', 'Electron']) {
        const legacyFile = path.join(app.getPath('appData'), legacyName, 'lupin_store.json');
        if (fs.existsSync(legacyFile)) {
          fs.mkdirSync(userData, { recursive: true });
          fs.copyFileSync(legacyFile, this.filePath);
          console.info(`[AppStore] Eski magaza tasindi: ${legacyFile}`);
          return;
        }
      }
    } catch (e) {
      console.warn('[AppStore] Legacy store migration failed:', e);
    }
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

  // ---- Kullanici calisma listeleri (yerel, Spotify tarzi) ----
  public getPlaylists(): UserPlaylist[] {
    if (!Array.isArray(this.data.playlists)) this.data.playlists = [];
    return this.data.playlists;
  }

  public createPlaylist(name: string, tracks: Track[]): UserPlaylist {
    const clean = (name || 'Yeni Liste').trim().slice(0, 60) || 'Yeni Liste';
    const pl: UserPlaylist = {
      id: `pl_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      name: clean,
      createdAt: Date.now(),
      tracks: (Array.isArray(tracks) ? tracks : []).filter((t) => t && t.id).slice(0, 500)
    };
    this.getPlaylists().unshift(pl);
    this.save();
    return pl;
  }

  public deletePlaylist(id: string): boolean {
    const arr = this.getPlaylists();
    const idx = arr.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    arr.splice(idx, 1);
    this.save();
    return true;
  }

  public playlistAdd(id: string, track: Track): boolean {
    const pl = this.getPlaylists().find((p) => p.id === id);
    if (!pl || !track || !track.id) return false;
    if (pl.tracks.some((t) => t.id === track.id)) return true;
    pl.tracks.push(track);
    this.save();
    return true;
  }

  public playlistRemoveTrack(id: string, trackId: string): boolean {
    const pl = this.getPlaylists().find((p) => p.id === id);
    if (!pl) return false;
    const before = pl.tracks.length;
    pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
    if (pl.tracks.length !== before) this.save();
    return pl.tracks.length !== before;
  }

  // ---- Takip Edilen Sanatcilar ----
  public getFollowedArtists(): FollowedArtist[] {
    if (!Array.isArray(this.data.followedArtists)) this.data.followedArtists = [];
    return this.data.followedArtists;
  }

  public followArtist(artist: FollowedArtist): boolean {
    if (!artist || !artist.id) return false;
    this.getFollowedArtists();
    const existingIdx = this.data.followedArtists.findIndex(a => a.id === artist.id);
    if (existingIdx >= 0) {
      this.data.followedArtists[existingIdx] = {
        ...this.data.followedArtists[existingIdx],
        ...artist
      };
      this.save();
      return true;
    }
    this.data.followedArtists.unshift({
      ...artist,
      followedAt: artist.followedAt || Date.now()
    });
    this.save();
    return true;
  }

  public unfollowArtist(artistId: string): boolean {
    this.getFollowedArtists();
    const before = this.data.followedArtists.length;
    this.data.followedArtists = this.data.followedArtists.filter(a => a.id !== artistId);
    if (this.data.followedArtists.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  public isArtistFollowed(artistId: string): boolean {
    return this.getFollowedArtists().some(a => a.id === artistId);
  }

  public toggleFollowArtist(artist: FollowedArtist): boolean {
    if (this.isArtistFollowed(artist.id)) {
      this.unfollowArtist(artist.id);
      return false;
    } else {
      this.followArtist(artist);
      return true;
    }
  }
}
