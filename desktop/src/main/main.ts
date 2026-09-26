import { app, BrowserWindow, ipcMain, shell, screen, clipboard } from 'electron';
import * as path from 'path';
import { BotServer } from './api/bot-server.js';
import { DiscordRpcManager } from './api/discord-rpc.js';
import { InnerTubeService } from './api/innertube.js';
import { AudioEngine } from './api/audio-engine.js';
import { AppStore } from './store/index.js';
import { PartyService } from './api/party.js';
import type { Track, PlaybackStatus, AppSettings } from '../types/index.js';

// Marka adi Electron varsayilani (package.json name) yerine urun adi olur;
// app.getPath('userData') yolunu da belirler (%APPDATA%\Lupin Music).
// Dev, kurulu surumle ayni userData + tek-instance kilidini paylasmasin diye
// ayri ad kullanir — iki uygulama paralel acilabilir.
if (app.isPackaged) {
  app.setName('Lupin Music');
} else {
  app.setName('Lupin Music Dev');
}
// Gorev cubugu / medya tuslari kimligi: installer appId ile ayni, dev ayri grup.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.lupin.music' : 'com.lupin.music.dev');
}

// Prevent YouTube / Google from blocking automated browser features & autoplay policy
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const existingFeatures = app.commandLine.getSwitchValue('enable-features');
app.commandLine.appendSwitch('enable-features', existingFeatures ? `${existingFeatures},ClientHints,UserAgentClientHint` : 'ClientHints,UserAgentClientHint');

let mainWindow: BrowserWindow | null = null;
const botServer = new BotServer(9863);const store = new AppStore();
const initialSettings = store.getSettings();
const discordRpc = new DiscordRpcManager(initialSettings.discordRpcEnabled, initialSettings.discordAppId);
const innerTube = new InnerTubeService();
const audioEngine = new AudioEngine();
const party = new PartyService();
// Birlikte Dinle relay adresi (site ile ayni origin; oda + kart sunucusu)
const PARTY_RELAY = process.env.LUPIN_PARTY_RELAY || 'https://lupinmusic.vercel.app';
audioEngine.setAdblockEnabled(initialSettings.adblockEnabled !== false).catch(() => {});
// Aninda baslatma: YT sayfasi isinirken dogrudan akisla sesi hemen ver
audioEngine.setStreamProvider(async (videoId: string) => {
  try {
    const player = await innerTube.getPlayer(videoId);
    return player?.streamUrl || null;
  } catch {
    return null;
  }
});

let currentTrack: Track | null = null;
// Birlikte Dinle: renderer'in bildirdigi kuyruk + motorun gordugu gercek durum
let partyQueue: { id: string; title: string; artist: string; duration: number }[] = [];
let partyLocal = { trackId: '', position: 0, playing: false };

// Motor gecisi sirasinda eski videodan gelen bayat raporlari eleme.
// playTrack istendiginde kurulur, motor yeni videoyu dogrulayinca temizlenir.
let pendingVideoId: string | null = null;
let pendingVideoTimer: NodeJS.Timeout | null = null;

function setPendingVideoId(id: string): void {
  pendingVideoId = id;
  if (pendingVideoTimer) clearTimeout(pendingVideoTimer);
  pendingVideoTimer = setTimeout(() => { pendingVideoId = null; }, 2000);
}

function clearPendingVideoId(): void {
  pendingVideoId = null;
  if (pendingVideoTimer) {
    clearTimeout(pendingVideoTimer);
    pendingVideoTimer = null;
  }
}

// Deep Link Protocol (lupin://) and Single Instance Lock
// Yalnizca kurulu (packaged) uretim kaydeder: dev electron.exe kendi kaydini
// yazarsa Windows 'Electron adli uygulama acilsin mi' diyalogunu gosterir.
if (app.isPackaged) {
  app.setAsDefaultProtocolClient('lupin');
}

// Uygulama kapaliyken tiklanan lupin:// linki argv ile gelir; pencere ve
// renderer hazir olana kadar bekletilir (did-finish-load sonrasi flush).
let pendingDeepLinkUrl: string | null = null;

function handleDeepLink(rawUrl: string): void {
  try {
    const clean = rawUrl.replace(/^lupin:\/\/?/, 'http://localhost/');
    const parsed = new URL(clean);
    const videoId = parsed.searchParams.get('id') || parsed.searchParams.get('v') || parsed.pathname.replace(/^\//, '');
    const seekTime = Number(parsed.searchParams.get('t')) || 0;
    const room = (parsed.searchParams.get('room') || '').toLowerCase();
    if (!videoId) return;
    // Parti odasi: host'a katil (senkron room.state -> renderer hizalama)
    if (room && /^[a-z0-9]{6,20}$/.test(room)) {
      party.setName(store.getSettings().discordDisplayName || 'Misafir');
      party.join(room).then((ok) => {
        console.log(`[Party] deep link join room=${room} ok=${ok}`);
      }).catch(() => {});
    }
    const send = (meta?: { title?: string; artist?: string; duration?: number }) => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
        if (meta) {
          // Zenginlestirme AYRI aksiyon: oynatmayi yeniden baslatmasin,
          // sadece baslik/sure bilgisini doldursun.
          mainWindow.webContents.send('bot:remote-control', 'playTrackMeta', { id: videoId, ...meta });
        } else {
          mainWindow.webContents.send('bot:remote-control', 'playTrack', { id: videoId, seek: seekTime });
        }
      }
    };
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
      // Once hemen baslat (gecikme olmasin), sonra gercek baslik/sure ile
      // zenginlestir: kullanici "Lupin Track / 00:00" gormesin.
      send();
      innerTube.getPlayer(videoId).then((info: { title?: string; artist?: string; duration?: number } | null) => {
        if (info) send({ title: info.title, artist: info.artist, duration: info.duration });
      }).catch(() => {});
    } else {
      pendingDeepLinkUrl = rawUrl;
    }
  } catch (e) {
    console.warn('[Main] Deep link parse error:', e);
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    const deepArg = commandLine.find(arg => arg.startsWith('lupin://'));
    if (deepArg) handleDeepLink(deepArg);
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Tekrarli cagriyi keser: before-quit / window-all-closed / closed olaylari
// quitApplication icindeki app.quit() ve destroy() ile yeniden tetikleniyordu
// (Maximum call stack size exceeded -> ani kapanis).
let quitting = false;

function quitApplication(): void {
  if (quitting) return;
  quitting = true;
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

  // Soğuk-start derin bağlantı: pencere renderer'ı yükleyince bekleyen linki uygula
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (pendingDeepLinkUrl) {
        const url = pendingDeepLinkUrl;
        pendingDeepLinkUrl = null;
        handleDeepLink(url);
      }
    });
  }
  const coldDeepArg = process.argv.find((arg) => arg.startsWith('lupin://'));
  if (coldDeepArg) handleDeepLink(coldDeepArg);

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
    // (reklam oynarken adopt YOK: reklam videosu parca sanilip kuyruk/bot kirlenmez)
    if (playback.videoId && !playback.isAd && (!currentTrack || currentTrack.id !== playback.videoId)) {
      // Prewarm'da bekleyen duraklatilmis videoyu parca sanma (henuz hic calinmadiysa)
      if (!currentTrack && playback.paused) {
        clearPendingVideoId();
      } else {
        console.log(`[AudioEngine] 🎵 Track transitioned in player: ${playback.videoId} - "${playback.title || 'Unknown'}" by ${playback.artist || 'Unknown'}`);
        currentTrack = {
          id: playback.videoId,
          title: playback.title || 'Lupin Music',
          artist: playback.artist || 'Lupin Audio',
          thumbnail: playback.thumbnail || `https://i.ytimg.com/vi/${playback.videoId}/hqdefault.jpg`,
          duration: playback.duration || 0
        };
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('player:track-changed', currentTrack);
        }
      }
    } else if (currentTrack && currentTrack.id === playback.videoId) {
      if (playback.duration && (!currentTrack.duration || currentTrack.duration <= 0)) {
        currentTrack.duration = playback.duration;
      }
      if (playback.title && currentTrack.title === 'Lupin Music' && playback.title !== 'YouTube Music') {
        currentTrack.title = playback.title;
      }
      if (playback.artist && currentTrack.artist === 'Lupin Audio') {
        currentTrack.artist = playback.artist;
      }
      if (playback.thumbnail && (!currentTrack.thumbnail || currentTrack.thumbnail.includes('hqdefault.jpg'))) {
        currentTrack.thumbnail = playback.thumbnail;
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('player:update', playback);
    }

    const isPlaying = !playback.paused && (playback.playerState === 1 || playback.playerState === 3);
    const status: PlaybackStatus = isPlaying ? 'playing' : (currentTrack ? 'paused' : 'stopped');
    const dur = playback.duration || currentTrack?.duration || 0;
    const progress = dur > 0 ? (playback.currentTime / dur) * 100 : 0;
    // Parti senkronu icin motorun gordugu gercek durum
    partyLocal = { trackId: currentTrack?.id || '', position: playback.currentTime || 0, playing: isPlaying };

    // Reklam sirasinda bot/Discord durumunu dondur: gercek sarkinin konumu korunur.
    // updatedAt yine de tazelenir ki bot bayatlik sanmasin.
    if (!playback.isAd) {
      botServer.updatePlaybackState({
        status,
        isPlaying,
        track: currentTrack,
        currentTime: playback.currentTime,
        duration: dur,
        progress
      });

      discordRpc.update(currentTrack, status, playback.currentTime);
    } else {
      botServer.updatePlaybackState({});
      // Reklam katmaninda bile gercek duraklama Discord'a yansisin: takili
      // isAd sinyali presence'i 'playing'de kilitliyor, kullanici pause
      // etse bile bot/RPC o duragi gormuyordu.
      if (playback.paused) {
        discordRpc.update(currentTrack, currentTrack ? 'paused' : 'stopped', playback.currentTime);
      }
    }
  });

  // ------------------------------------------------------------------
  // Birlikte Dinle (party): host durumu relay'e yazar, katilimci host'tan
  // hizalanir. Renderer kuyrugu main'e bildirir; uygulama ici ayar gerektirmez.
  // ------------------------------------------------------------------
  party.configure({
    getState: () => ({
      track: currentTrack ? {
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        duration: Math.round(currentTrack.duration || 0)
      } : null,
      position: partyLocal.position,
      playing: partyLocal.playing,
      queue: partyQueue
    }),
    onFollow: (state) => {
      if (!state.track) return;
      const action = party.needsCorrection(state, partyLocal.trackId, partyLocal.position, partyLocal.playing);
      if (action && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('party:sync', action);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('party:status', {
          role: 'follower',
          room: state.room,
          hostName: state.hostName,
          listeners: state.listeners || 0,
          track: state.track,
          position: state.position,
          playing: state.playing,
          closed: false
        });
      }
    },
    onSnapshot: (snap) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('party:status', snap);
      }
    },
    onClosed: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('party:closed', { reason: 'host-left' });
      }
    }
  });

  // Apply initial volume
  audioEngine.setVolume(initialSettings.volume || 0.8);

  // Start local Bot REST API
  await botServer.start();
  botServer.setControlCallback((action, payload) => {
    // Henuz hic parca secilmediyse play/resume motoru direkt calistirmaz:
    // prewarm videosu hayalet parca olurdu. Bunun yerine renderer kuyruga karar verir.
    if (!currentTrack && (action === 'play' || action === 'resume')) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Renderer yalnizca 'play' aksiyonunu anlar; alias'i normalize et
        mainWindow.webContents.send('bot:remote-control', 'play', payload);
      }
      return;
    }
    if (action === 'play' || action === 'resume') {
      audioEngine.resume();
      // Discord presence'i aninda yansit: poll'a birakmak isAd/bot duraginda
      // "hâlâ çalıyor" goruntusunu birakiyordu.
      if (currentTrack) discordRpc.update(currentTrack, 'playing');
    } else if (action === 'pause') {
      audioEngine.pause();
      if (currentTrack) discordRpc.update(currentTrack, 'paused');
    } else if (action === 'volume' && typeof payload === 'number') audioEngine.setVolume(payload);
    else if (action === 'seek' && typeof payload === 'number') audioEngine.seek(payload);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot:remote-control', action, payload);
    }
  });

  // Connect Discord RPC
  discordRpc.connect().catch(() => {});
  discordRpc.setOnStatusChange((s) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('discord:rpc-status', s);
    }
  });

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

// ------------------------------------------------------------------
// Birlikte Dinle (party) IPC
// ------------------------------------------------------------------
ipcMain.handle('party:host', async (_event, payload: { room?: string; name?: string }) => {
  if (payload?.name) party.setName(payload.name);
  const relayOk = await party.host(payload?.room);
  const room = party.getRoom();
  return {
    success: true,
    relayOk,
    room,
    role: 'host',
    link: room ? `https://lupinmusic.vercel.app/party?room=${room}` : ''
  };
});

ipcMain.handle('party:join', async (_event, payload: { room: string; name?: string }) => {
  if (payload?.name) party.setName(payload.name);
  const ok = await party.join(payload?.room || '');
  return { success: ok, role: party.getRole(), room: party.getRoom() };
});

ipcMain.handle('party:leave', async () => {
  await party.leave('manual');
  return { success: true, role: party.getRole() };
});

ipcMain.handle('party:status', () => ({
  role: party.getRole(),
  room: party.getRoom()
}));

ipcMain.on('party:queue', (_event, queue: { id: string; title: string; artist: string; duration?: number }[]) => {
  partyQueue = (Array.isArray(queue) ? queue : [])
    .filter((t) => t && typeof t.id === 'string' && t.id)
    .slice(0, 20)
    .map((t) => ({
      id: String(t.id).slice(0, 20),
      title: String(t.title || 'Lupin Music').slice(0, 120),
      artist: String(t.artist || 'Lupin Audio').slice(0, 120),
      duration: Math.max(0, Math.round(Number(t.duration) || 0))
    }));
});

ipcMain.handle('music:explore', async () => {
  return innerTube.getExplore();
});

// Sanatci / album / oynatma listesi detayi (tiklanan karta acilir)
ipcMain.handle('music:browse', async (_event, browseId: string) => {
  return innerTube.browse(browseId);
});

ipcMain.handle('music:getRelated', async (_event, videoId: string) => {
  return innerTube.getRelatedTracks(videoId);
});

// Native AudioEngine IPC
ipcMain.handle('player:play', async (_event, track: Track) => {
  if (!track || !track.id) return false;
  currentTrack = track;
  setPendingVideoId(track.id);
  discordRpc.update(track, 'playing', 0);
  const ok = await audioEngine.play(track.id, {
    title: track.title,
    artist: track.artist,
    thumbnail: track.thumbnail,
    duration: track.duration
  });
  if (!ok) clearPendingVideoId();
  return ok;
});

ipcMain.handle('player:pause', async () => {
  if (currentTrack) discordRpc.update(currentTrack, 'paused');
  await audioEngine.pause();
  return true;
});

ipcMain.handle('player:resume', async () => {
  if (currentTrack) discordRpc.update(currentTrack, 'playing');
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
ipcMain.handle('discord:sendWebhookInvite', async (_event, payload: { track: Track; currentTime?: number; duration?: number; webhookUrl?: string; cardPng?: string; room?: string }) => {
  try {
    const settings = store.getSettings();
    const ownWebhookUrl = payload.webhookUrl || settings.discordWebhookUrl || '';
    const room = (payload.room || party.getRoom() || '').toLowerCase();

    const { track, currentTime = 0, duration = 0, cardPng = '' } = payload;
    const fmt = (sec: number) => {
      if (isNaN(sec) || sec < 0) return '0:00';
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
    // Lupin Neon Pink: 0xec4899 (15485081)
    const embedColor = 0xec4899;
    const partyUrl = room
      ? `https://lupinmusic.vercel.app/party?room=${room}`
      : `https://lupinmusic.vercel.app/party?id=${track.id}&t=${Math.floor(currentTime)}`;
    const playUrl = `https://lupinmusic.vercel.app/play?id=${track.id}`;
    const logoUrl = 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png';

    // Buton satiri: Discord webhook'larinda components desteklenir (link butonlari).
    const actionRow = (urls: { label: string; url: string }[]) => ([{
      type: 1,
      components: urls.map((u) => ({ type: 2, style: 5, label: u.label, url: u.url }))
    }]);

    // 0) VARSAYILAN YOL: kart relay'i. Webhook URL'si sunucuda kalir;
    //    kullanici hicbir sey yapmadan calisir (Ayarlar'daki URL sadece
    //    baska bir kanala gondermek icin gecerli bir gecersdirme).
    if (cardPng) {
      try {
        const relayRes = await fetch(`${PARTY_RELAY}/api/card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'Lupin Music • Birlikte Dinle',
            avatarUrl: logoUrl,
            content: `🎧 **Birlikte Dinle:** ${partyUrl}\n🚀 **Lupin Uygulamasında Aç:** ${playUrl}`,
            components: actionRow([
              { label: '🎧 Birlikte Dinle Partisi', url: partyUrl },
              { label: '🚀 Lupin Uygulamasında Aç', url: playUrl },
              { label: '💜 Topluluk Kanalı', url: 'https://discord.gg/Rma8w8JrQH' }
            ]),
            imageBase64: cardPng
          }),
          signal: AbortSignal.timeout(20000)
        });
        if (relayRes.ok) return { success: true, via: 'relay' };
        const relayErr = await relayRes.text().catch(() => '');
        console.warn('[BirlikteDinle] Relay kart gonderimi basarisiz:', relayRes.status, relayErr.slice(0, 160));
      } catch (e: any) {
        console.warn('[BirlikteDinle] Relay erisilemiyor:', e?.message);
      }
    }

    // 1) Kullanici kendi webhook'unu kurduysa onu kullan
    if (ownWebhookUrl && ownWebhookUrl.startsWith('http')) {
      if (cardPng) {
        const form = new FormData();
        form.append('payload_json', JSON.stringify({
          username: 'Lupin Music • Birlikte Dinle',
          avatar_url: logoUrl,
          // Birlikte Dinle linki metin olarak da atilir (kart gorseli tiklanamaz)
          content: `🎧 **Birlikte Dinle:** ${partyUrl}\n🚀 **Lupin Uygulamasında Aç:** ${playUrl}`,
          components: actionRow([
            { label: '🎧 Birlikte Dinle Partisi', url: partyUrl },
            { label: '🚀 Lupin Uygulamasında Aç', url: playUrl },
            { label: '💜 Topluluk Kanalı', url: 'https://discord.gg/Rma8w8JrQH' }
          ])
        }));
        form.append('files[0]', new Blob([Buffer.from(cardPng, 'base64')], { type: 'image/png' }), 'lupin-now-playing.png');

        const cardResp = await fetch(ownWebhookUrl, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(15000)
        });
        if (cardResp.ok || cardResp.status === 204) return { success: true, via: 'own-webhook' };

        const cardErr = await cardResp.text().catch(() => '');
        console.warn('[DiscordWebhook] Kart gonderimi basarisiz, metin embedine dusuluyor:', cardResp.status, cardErr);
      }

      // 2) yedek yol: metin embed'i (kart cizilemezse)
      const discordPayload = {
      username: 'Lupin Music • Birlikte Dinle',
      avatar_url: 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png',
      content: '🎵 **Lupin Music ile Birlikte Dinlemeye Davet Edildiniz!**',
      embeds: [
        {
          title: `🎶 ${track.title}`,
          description: `**Sanatçı:** ${track.artist}\n**Durum:** ▶️ Çalıyor\n\n🎧 **[Lupin Birlikte Dinle Partisi'ne Katıl](https://lupinmusic.vercel.app/party?id=${track.id}&t=${Math.floor(currentTime)})**\n🚀 **[Lupin Uygulamasında Aç](https://lupinmusic.vercel.app/play?id=${track.id})**`,
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

      const resp = await fetch(ownWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload),
        signal: AbortSignal.timeout(10000)
      });

      if (resp.ok || resp.status === 204) {
        return { success: true, via: 'own-webhook' };
      } else {
        const errText = await resp.text().catch(() => '');
        console.warn('[DiscordWebhook] Failed sending webhook:', resp.status, errText);
        return { success: false, error: `Discord HTTP ${resp.status}: ${errText}` };
      }
    }

    return { success: false, error: 'Kart sunucusuna ulaşılamadı ve webhook URL’si ayarlanmamış.' };
  } catch (err: any) {
    console.error('[DiscordWebhook] Error sending invite:', err);
    return { success: false, error: err?.message || 'Bilinmeyen hata' };
  }
});

ipcMain.handle('clipboard:writeText', (_event, text: string) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('discord:getRpcStatus', () => discordRpc.getStatus());
