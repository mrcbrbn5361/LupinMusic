import { app, BrowserWindow, ipcMain, shell, screen, clipboard } from 'electron';
import * as path from 'path';
import { BotServer } from './api/bot-server.js';
import { DiscordRpcManager } from './api/discord-rpc.js';
import { InnerTubeService } from './api/innertube.js';
import { AudioEngine } from './api/audio-engine.js';
import { AppStore } from './store/index.js';
import type { Track, PlaybackStatus, AppSettings } from '../types/index.js';

// Prevent YouTube / Google from blocking automated browser features & autoplay policy
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const existingFeatures = app.commandLine.getSwitchValue('enable-features');
app.commandLine.appendSwitch('enable-features', existingFeatures ? `${existingFeatures},ClientHints,UserAgentClientHint` : 'ClientHints,UserAgentClientHint');

let mainWindow: BrowserWindow | null = null;
const botServer = new BotServer(9863);
const store = new AppStore();
const initialSettings = store.getSettings();
const discordRpc = new DiscordRpcManager(initialSettings.discordRpcEnabled, initialSettings.discordAppId);
const innerTube = new InnerTubeService();
const audioEngine = new AudioEngine();
audioEngine.setAdblockEnabled(initialSettings.adblockEnabled !== false).catch(() => {});

let currentTrack: Track | null = null;

// Motor gecisi sirasinda eski videodan gelen bayat raporlari eleme.
// playTrack istendiginde kurulur, motor yeni videoyu dogrulayinca temizlenir.
let pendingVideoId: string | null = null;
let pendingVideoTimer: NodeJS.Timeout | null = null;

function setPendingVideoId(id: string): void {
  pendingVideoId = id;
  if (pendingVideoTimer) clearTimeout(pendingVideoTimer);
  pendingVideoTimer = setTimeout(() => { pendingVideoId = null; }, 10000);
}

function clearPendingVideoId(): void {
  pendingVideoId = null;
  if (pendingVideoTimer) {
    clearTimeout(pendingVideoTimer);
    pendingVideoTimer = null;
  }
}

// Single-instance lock: duplicate instances will restore current window instead of spawning multiple processes
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

function quitApplication(): void {
  try { audioEngine.destroy(); } catch {}
  try { botServer.stop(); } catch {}
  try { discordRpc.destroy(); } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.destroy(); } catch {}
    mainWindow = null;
  }
  try { app.quit(); } catch {}
  setTimeout(() => {
    try { app.exit(0); } catch {}
    try { process.exit(0); } catch {}
  }, 100);
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function ensureWindowWithinBounds(w: number, h: number): { x?: number; y?: number } {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  const x = Math.max(0, Math.floor((width - w) / 2));
  const y = Math.max(0, Math.floor((height - h) / 2));
  return { x, y };
}

function createWindow(): void {
  const width = 1200;
  const height = 800;
  const bounds = ensureWindowWithinBounds(width, height);

  const baseDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const iconPath = process.platform === 'win32'
    ? path.join(baseDir, 'icon.ico')
    : path.join(baseDir, 'icon.png');

  mainWindow = new BrowserWindow({
    width,
    height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#090214',
      symbolColor: '#ec4899',
      height: 38
    } : false,
    backgroundColor: '#090214',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true
    }
  });

  // Safe external URL handler
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', () => {
    quitApplication();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    quitApplication();
  });
}

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  audioEngine.prewarm();

  // Setup AudioEngine updates
  audioEngine.setOnUpdate((playback) => {
    // Gecis sirasinda eski videonun bayat raporu: secimi geri almasin diye yoksay
    if (playback.videoId && pendingVideoId && playback.videoId !== pendingVideoId
        && currentTrack && playback.videoId !== currentTrack.id) {
      return;
    }
    if (playback.videoId && pendingVideoId && playback.videoId === pendingVideoId) {
      clearPendingVideoId();
    }
    // Autoplay / Radio track transition detection
    if (playback.videoId && (!currentTrack || currentTrack.id !== playback.videoId)) {
      // Prewarm'da bekleyen duraklatilmis videoyu parca sanma (henuz hic calinmadiysa)
      if (!currentTrack && playback.paused) {
        pendingVideoId = null;
      } else {
        console.log(`[AudioEngine] 🎵 Track transitioned in player: ${playback.videoId} - "${playback.title || 'Unknown'}" by ${playback.artist || 'Unknown'}`);
        currentTrack = {
          id: playback.videoId,
          title: playback.title || currentTrack?.title || 'Lupin Music',
          artist: playback.artist || currentTrack?.artist || 'Lupin Audio',
          thumbnail: playback.thumbnail || `https://i.ytimg.com/vi/${playback.videoId}/hqdefault.jpg`,
          duration: playback.duration || currentTrack?.duration || 0
        };
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('player:track-changed', currentTrack);
        }
      }
    } else if (currentTrack) {
      if (playback.duration && (!currentTrack.duration || currentTrack.duration <= 0)) {
        currentTrack.duration = playback.duration;
      }
      if (playback.title && currentTrack.title === 'Lupin Music') {
        currentTrack.title = playback.title;
      }
      if (playback.artist && currentTrack.artist === 'Lupin Audio') {
        currentTrack.artist = playback.artist;
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('player:update', playback);
    }

    const isPlaying = !playback.paused && (playback.playerState === 1 || playback.playerState === 3);
    const status: PlaybackStatus = isPlaying ? 'playing' : (currentTrack ? 'paused' : 'stopped');
    const dur = playback.duration || currentTrack?.duration || 0;
    const progress = dur > 0 ? (playback.currentTime / dur) * 100 : 0;

    botServer.updatePlaybackState({
      status,
      isPlaying,
      track: currentTrack,
      currentTime: playback.currentTime,
      duration: dur,
      progress
    });

    discordRpc.update(currentTrack, status, playback.currentTime);
  });

  // Apply initial volume
  audioEngine.setVolume(initialSettings.volume || 0.8);

  // Start local Bot REST API
  await botServer.start();
  botServer.setControlCallback((action, payload) => {
    if (action === 'play') audioEngine.resume();
    else if (action === 'pause') audioEngine.pause();
    else if (action === 'volume' && typeof payload === 'number') audioEngine.setVolume(payload);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot:remote-control', action, payload);
    }
  });

  // Connect Discord RPC
  discordRpc.connect().catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  quitApplication();
});

app.on('before-quit', () => {
  quitApplication();
});

// Window control IPC
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => {
  quitApplication();
});

// Music and Streaming IPC
ipcMain.handle('music:search', async (_event, query: string) => {
  return innerTube.search(query, 'songs');
});

ipcMain.handle('music:explore', async () => {
  return innerTube.getExplore();
});

ipcMain.handle('music:getRelated', async (_event, videoId: string) => {
  return innerTube.getRelatedTracks(videoId);
});

// Native AudioEngine IPC
ipcMain.handle('player:play', async (_event, track: Track) => {
  currentTrack = track;
  setPendingVideoId(track.id);
  const ok = await audioEngine.play(track.id);
  if (!ok) clearPendingVideoId();
  return ok;
});

ipcMain.handle('player:pause', async () => {
  await audioEngine.pause();
  return true;
});

ipcMain.handle('player:resume', async () => {
  await audioEngine.resume();
  return true;
});

ipcMain.handle('player:seek', async (_event, seconds: number) => {
  await audioEngine.seek(seconds);
  return true;
});

ipcMain.handle('player:setVolume', async (_event, val: number) => {
  await audioEngine.setVolume(val);
  return true;
});

// Store IPC
ipcMain.handle('store:getSettings', () => store.getSettings());
ipcMain.handle('store:updateSettings', (_event, partial: Partial<AppSettings>) => {
  const updated = store.updateSettings(partial);
  if (typeof partial.discordRpcEnabled === 'boolean') {
    discordRpc.setEnabled(partial.discordRpcEnabled);
  }
  if (typeof partial.discordAppId === 'string') {
    discordRpc.setClientId(partial.discordAppId);
  }
  if (typeof partial.volume === 'number') {
    audioEngine.setVolume(partial.volume);
  }
  if (typeof partial.adblockEnabled === 'boolean') {
    audioEngine.setAdblockEnabled(partial.adblockEnabled).catch(() => {});
  }
  return updated;
});
ipcMain.handle('store:getLikedTracks', () => store.getLikedTracks());
ipcMain.handle('store:toggleLike', (_event, track: Track) => store.toggleLikeTrack(track));
ipcMain.handle('store:getHistory', () => store.getHistory());
ipcMain.handle('store:addToHistory', (_event, track: Track) => store.addToHistory(track));

// Discord Webhook & Sharing IPC
ipcMain.handle('discord:sendWebhookInvite', async (_event, payload: { track: Track; currentTime?: number; duration?: number; webhookUrl?: string }) => {
  try {
    const settings = store.getSettings();
    const webhookUrl = payload.webhookUrl || settings.discordWebhookUrl;
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      return { success: false, error: 'Discord Webhook URL ayarlanmamış.' };
    }

    const { track, currentTime = 0, duration = 0 } = payload;
    const fmt = (sec: number) => {
      if (isNaN(sec) || sec < 0) return '0:00';
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
    // Lupin Neon Pink: 0xec4899 (15485081)
    const embedColor = 0xec4899;

    const discordPayload = {
      username: 'Lupin Music • Birlikte Dinle',
      avatar_url: 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png',
      content: '🎵 **Lupin Music ile Birlikte Dinlemeye Davet Edildiniz!**',
      embeds: [
        {
          title: `🎶 ${track.title}`,
          description: `**Sanatçı:** ${track.artist}\n**Durum:** ▶️ Çalıyor\n\n🎧 **[Lupin Party'ye Katıl (Birlikte Dinle)](https://discord.gg/Rma8w8JrQH)**\n🔗 **YouTube:** [Şarkıyı Aç](https://youtu.be/${track.id})`,
          color: embedColor,
          author: {
            name: 'Lupin Music • Luxury Sound',
            icon_url: 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png',
            url: 'https://discord.gg/Rma8w8JrQH'
          },
          thumbnail: {
            url: track.thumbnail || `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`
          },
          fields: [
            {
              name: '⏳ Süre / İlerleme',
              value: `\`${fmt(currentTime)} / ${fmt(duration)}\` *(%${Math.round(progress)})*`,
              inline: true
            },
            {
              name: '👥 Topluluk Kanalı',
              value: '[Lupin Discord Sunucusu](https://discord.gg/Rma8w8JrQH)',
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

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload)
    });

    if (resp.ok || resp.status === 204) {
      return { success: true };
    } else {
      const errText = await resp.text().catch(() => '');
      console.warn('[DiscordWebhook] Failed sending webhook:', resp.status, errText);
      return { success: false, error: `Discord HTTP ${resp.status}: ${errText}` };
    }
  } catch (err: any) {
    console.error('[DiscordWebhook] Error sending invite:', err);
    return { success: false, error: err?.message || 'Bilinmeyen hata' };
  }
});

ipcMain.handle('clipboard:writeText', (_event, text: string) => {
  clipboard.writeText(text);
  return true;
});
