import { contextBridge, ipcRenderer } from 'electron';
import type { Track, AppSettings } from '../types/index.js';

const api = {
  isMac: process.platform === 'darwin',
  platform: process.platform,

  // Window Controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Music Search & Explore
  search: (query: string) => ipcRenderer.invoke('music:search', query),
  getExplore: () => ipcRenderer.invoke('music:explore'),
  getRelatedTracks: (videoId: string) => ipcRenderer.invoke('music:getRelated', videoId),

  // Audio Engine Playback Controls
  playTrack: (track: Track) => ipcRenderer.invoke('player:play', track),
  pause: () => ipcRenderer.invoke('player:pause'),
  resume: () => ipcRenderer.invoke('player:resume'),
  seek: (seconds: number) => ipcRenderer.invoke('player:seek', seconds),
  setVolume: (val: number) => ipcRenderer.invoke('player:setVolume', val),

  // Events from Main AudioEngine
  onPlaybackUpdate: (callback: (playback: {
    currentTime: number;
    duration: number;
    paused: boolean;
    playerState: number;
    videoId?: string;
    title?: string;
    artist?: string;
    thumbnail?: string;
    isAd?: boolean;
  }) => void) => {
    ipcRenderer.on('player:update', (_event, playback) => callback(playback));
  },
  onTrackChanged: (callback: (track: Track) => void) => {
    ipcRenderer.on('player:track-changed', (_event, track) => callback(track));
  },

  // Local Store
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('store:getSettings'),
  updateSettings: (partial: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('store:updateSettings', partial),
  getLikedTracks: (): Promise<Track[]> => ipcRenderer.invoke('store:getLikedTracks'),
  toggleLike: (track: Track): Promise<boolean> => ipcRenderer.invoke('store:toggleLike', track),
  getHistory: (): Promise<Track[]> => ipcRenderer.invoke('store:getHistory'),
  addToHistory: (track: Track): Promise<void> => ipcRenderer.invoke('store:addToHistory', track),

  // Remote Control Events
  onRemoteControl: (callback: (action: string, payload?: any) => void) => {
    ipcRenderer.on('bot:remote-control', (_event, action, payload) => callback(action, payload));
  },

  // Discord Webhook & Sharing
  sendDiscordWebhookInvite: (payload: { track: Track; currentTime?: number; duration?: number; webhookUrl?: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('discord:sendWebhookInvite', payload),
  copyToClipboard: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard:writeText', text),

  // Discord RPC durumu
  getRpcStatus: (): Promise<{ connected: boolean; enabled: boolean }> =>
    ipcRenderer.invoke('discord:getRpcStatus'),
  onRpcStatus: (callback: (s: { connected: boolean; enabled: boolean }) => void) => {
    ipcRenderer.on('discord:rpc-status', (_event, s) => callback(s));
  }
};

contextBridge.exposeInMainWorld('api', api);
