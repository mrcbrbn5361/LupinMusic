import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
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
const existingFeatures = app.commandLine.getSwitchValue('enable-features');
app.commandLine.appendSwitch('enable-features', existingFeatures ? `${existingFeatures},ClientHints,UserAgentClientHint` : 'ClientHints,UserAgentClientHint');

let mainWindow: BrowserWindow | null = null;
const botServer = new BotServer(9863);
const store = new AppStore();
const initialSettings = store.getSettings();
const discordRpc = new DiscordRpcManager(initialSettings.discordRpcEnabled, initialSettings.discordAppId);
const innerTube = new InnerTubeService();
const audioEngine = new AudioEngine();

let currentTrack: Track | null = null;

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

  // Setup AudioEngine updates
  audioEngine.setOnUpdate((playback) => {
    // Autoplay / Radio track transition detection
    if (playback.videoId && (!currentTrack || currentTrack.id !== playback.videoId)) {
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

    const isPlaying = !playback.paused && playback.playerState === 1;
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

// Native AudioEngine IPC
ipcMain.handle('player:play', async (_event, track: Track) => {
  currentTrack = track;
  const ok = await audioEngine.play(track.id);
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
  return updated;
});
ipcMain.handle('store:getLikedTracks', () => store.getLikedTracks());
ipcMain.handle('store:toggleLike', (_event, track: Track) => store.toggleLikeTrack(track));
ipcMain.handle('store:getHistory', () => store.getHistory());
ipcMain.handle('store:addToHistory', (_event, track: Track) => store.addToHistory(track));
