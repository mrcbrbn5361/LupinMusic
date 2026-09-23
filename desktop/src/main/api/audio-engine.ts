import { BrowserWindow, session } from 'electron';

const MUSIC_PARTITION = 'persist:lupin_music';
const WATCH_URL = 'https://music.youtube.com/watch?v=';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CHROME_MAJOR = '131';

// Reklam ve izleme alan adlarını ağ seviyesinde blokla
const AD_BLOCK_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googleadservices.com/*',
  '*://*.googlesyndication.com/*',
  '*://*.googletagservices.com/*',
  '*://*.2mdn.net/*',
  '*://adservice.google.*/*',
  '*://*.youtube-nocookie.com/*',
  '*://*.youtube.com/pagead/*',
  '*://music.youtube.com/pagead/*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/api/stats/qoe*adformat*',
  '*://*.youtube.com/api/stats/atr*',
  '*://*.youtube.com/get_midroll_info*',
  '*://*.youtube.com/ptracking*',
  '*://pagead2.googlesyndication.com/*',
  '*://ad.doubleclick.net/*',
  '*://*.google.com/pagead/*',
  '*://*.youtube.com/youtubei/v1/att/get*'
];

const ADHIDE_CSS = `
  .ytp-ad-player-overlay,
  .ytp-ad-text,
  .ytp-ad-skip-button-container,
  .ytp-ad-message-container,
  .ytp-ad-image-overlay,
  #player-ads,
  .ytp-ad-module,
  .ytp-ad-overlay-container,
  ytmusic-mealbar-promo-renderer,
  ytmusic-upsell-dialog-renderer,
  .mealbar-promo-renderer,
  ytmusic-statement-banner-renderer,
  .ytd-consent-bump-v2-lightbox,
  ytmusic-consent-bump-v2-renderer {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
`;

// Reklamsız oynatma ve onay ekranlarını otomatik aşma betiği
const ADBLOCK_INJECTION_JS = `(() => {
  try {
    if (window.__lupin_engine_injected) return;
    window.__lupin_engine_injected = true;

    // Cookie ve rıza diyaloglarını otomatik onayla / kapat
    const dismissConsent = () => {
      try {
        const consentSelectors = [
          'button[aria-label*="Accept"]',
          'button[aria-label*="Kabul"]',
          'button[aria-label*="Agree"]',
          '#introAgreeButton',
          'form[action*="consent"] button',
          '.ytd-consent-bump-v2-lightbox button',
          'ytmusic-consent-bump-v2-renderer button',
          'tp-yt-paper-button#button',
          'yt-button-renderer#dismiss-button'
        ];
        for (const sel of consentSelectors) {
          const btns = document.querySelectorAll(sel);
          for (const b of btns) {
            try { b.click(); } catch {}
          }
        }
      } catch {}
    };
    dismissConsent();

    // Reklam JSON alanlarını ayıkla
    const cleanPlayerResponse = (data) => {
      if (!data || typeof data !== 'object') return;
      try {
        if (data.adPlacements) delete data.adPlacements;
        if (data.playerAds) delete data.playerAds;
        if (data.adSlots) delete data.adSlots;
      } catch {}
    };

    if (window.ytInitialPlayerResponse) {
      cleanPlayerResponse(window.ytInitialPlayerResponse);
    }
    let _origInit = window.ytInitialPlayerResponse;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        get() { return _origInit; },
        set(v) { cleanPlayerResponse(v); _origInit = v; },
        configurable: true
      });
    } catch {}

    // Fetch API üzerinden gelen reklam verilerini filtrele
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (url && (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next'))) {
          const clone = response.clone();
          const json = await clone.json();
          cleanPlayerResponse(json);
          return new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      } catch {}
      return response;
    };

    // Reklam butonlarını anında geçme ve consent nöbetçisi
    setInterval(() => {
      try {
        dismissConsent();
        const mp = document.getElementById('movie_player');
        if (mp && typeof mp.skipAd === 'function') {
          try { mp.skipAd(); } catch {}
        }
        const sel = [
          '.ytp-ad-skip-button',
          '.ytp-ad-skip-button-modern',
          '.ytp-skip-ad-button',
          '.ytp-ad-skip-button-slot button',
          'button.ytp-ad-skip-button'
        ];
        for (const s of sel) {
          for (const b of document.querySelectorAll(s)) {
            try { b.click(); } catch {}
          }
        }
        const isAd = (mp && typeof mp.getAdState === 'function' && mp.getAdState() === 1)
          || (mp && mp.classList && (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting')));
        if (isAd) {
          const v = document.querySelector('video');
          if (v && v.duration && !isNaN(v.duration) && v.duration > 0) {
            v.muted = true;
            v.currentTime = v.duration;
          }
        }
      } catch {}
    }, 250);
  } catch (e) {}
})();`;

// Shadow DOM derin taramasıyla movie_player ve video elementlerini bulup durum döndürür
const RESOLVE_MEDIA_JS = `(() => {
  try {
    const findPlayer = () => {
      if (window.__hmp && window.__hmp.isConnected) return window.__hmp;
      let mp = null;
      try { mp = document.getElementById('movie_player'); } catch {}
      if (!mp) {
        try {
          mp = document.querySelector('ytmusic-player-bar')?.querySelector('#movie_player')
            || document.querySelector('ytmusic-player #movie_player');
        } catch {}
      }
      if (!mp) {
        const walk = (root, depth = 0) => {
          if (depth > 4) return null;
          try { const m = root.getElementById('movie_player'); if (m) return m; } catch {}
          for (const el of root.children || []) {
            if (el.shadowRoot) { const r = walk(el.shadowRoot, depth + 1); if (r) return r; }
          }
          return null;
        };
        mp = walk(document);
      }
      if (mp) window.__hmp = mp;
      return mp;
    };

    const mp = findPlayer();
    const hasApi = !!(mp && typeof mp.getPlayerState === 'function');

    if (hasApi) {
      let isAd = false;
      try { if (typeof mp.getAdState === 'function' && mp.getAdState() === 1) isAd = true; } catch {}
      if (!isAd && mp.classList && mp.classList.contains('ad-showing')) isAd = true;

      let vd = null;
      try { vd = mp.getVideoData ? mp.getVideoData() : null; } catch {}

      let cur = 0, dur = 0, pstate = -1;
      try { cur = mp.getCurrentTime ? mp.getCurrentTime() : 0; } catch {}
      try { dur = mp.getDuration ? mp.getDuration() : 0; } catch {}
      try { pstate = mp.getPlayerState ? mp.getPlayerState() : -1; } catch {}

      // Video ID: Check URL first (autoplay updates URL immediately), fallback to getVideoData
      let urlVid = '';
      try { urlVid = new URLSearchParams(window.location.search).get('v') || ''; } catch {}
      const apiVid = (vd && vd.video_id) || '';
      const vid = urlVid || apiVid;

      // Extract Title and Artist
      let title = '';
      let artist = '';
      const apiDataFresh = !urlVid || !apiVid || urlVid === apiVid;
      if (apiDataFresh && vd) {
        title = vd.title || '';
        artist = vd.author || '';
      }

      // Fallback 1: document.title parse
      if (!title) {
        try {
          const dt = (document.title || '').trim();
          let cleaned = dt.replace(/\\s*[|\\-–]\\s*YouTube Music\\s*$/i, '').trim();
          if (cleaned && cleaned !== 'YouTube Music') {
            const dashIdx = cleaned.indexOf(' - ');
            if (dashIdx > 0 && dashIdx < cleaned.length - 3) {
              const beforeDash = cleaned.substring(0, dashIdx).trim();
              const afterDash = cleaned.substring(dashIdx + 3).trim();
              const afterParts = afterDash.split(/\\s*[|,•·]\\s*/);
              title = beforeDash;
              if (!artist) artist = afterParts[0] || '';
            } else {
              const parts = cleaned.split(/\\s*[•·]\\s*/).filter(Boolean);
              if (parts.length >= 2) {
                title = parts[0];
                if (!artist) artist = parts[1];
              } else {
                title = cleaned;
              }
            }
          }
        } catch {}
      }

      // Fallback 2: ytmusic-player-bar DOM
      if (!title || !artist) {
        try {
          const pb = document.querySelector('ytmusic-player-bar');
          if (pb) {
            const tEl = pb.querySelector('.title, .byline + .title, yt-formatted-string.title');
            const bEl = pb.querySelector('.byline, yt-formatted-string.byline');
            if (!title && tEl) title = (tEl.textContent || '').trim();
            if (!artist && bEl) {
              const t = (bEl.textContent || '').trim();
              const parts = t.split(/[•·]/).map((s) => s.trim());
              artist = parts[0] || t;
            }
          }
        } catch {}
      }

      return {
        ok: true,
        currentTime: cur || 0,
        duration: dur || 0,
        paused: pstate !== 1,
        playerState: pstate,
        isAd,
        videoId: vid || '',
        title: title || '',
        artist: artist || '',
        thumbnail: vid ? ('https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg') : ''
      };
    }

    // Shadow DOM Video Elementi Yedek Taraması
    const walkV = (root, depth = 0) => {
      if (depth > 5) return null;
      for (const tag of ['video', 'audio']) {
        const list = root.querySelectorAll(tag);
        if (list.length) return list[0];
      }
      for (const e of root.children || []) {
        if (e.shadowRoot) { const r = walkV(e.shadowRoot, depth + 1); if (r) return r; }
      }
      return null;
    };

    const v = walkV(document);
    if (!v) return null;

    let urlVid = '';
    try { urlVid = new URLSearchParams(window.location.search).get('v') || ''; } catch {}

    return {
      ok: true,
      currentTime: v.currentTime || 0,
      duration: v.duration || 0,
      paused: v.paused,
      playerState: v.ended ? 0 : (v.paused ? 2 : 1),
      isAd: false,
      videoId: urlVid || '',
      title: '',
      artist: '',
      thumbnail: urlVid ? ('https://i.ytimg.com/vi/' + urlVid + '/hqdefault.jpg') : ''
    };
  } catch (e) {
    return null;
  }
})()`;

export interface PlaybackState {
  currentTime: number;
  duration: number;
  paused: boolean;
  playerState: number; // 0: ended, 1: playing, 2: paused, 3: buffering
  videoId?: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
}

export class AudioEngine {
  private win: BrowserWindow | null = null;
  private currentVideoId: string = '';
  private volume: number = 0.8;
  private pollTimer: NodeJS.Timeout | null = null;
  private updateCallback?: (state: PlaybackState) => void;
  private isDestroyed: boolean = false;
  private playGen: number = 0;
  private adblockInstalled: boolean = false;

  constructor() {
    this.setupSession();
  }

  private setupSession(): void {
    if (this.adblockInstalled) return;
    this.adblockInstalled = true;
    try {
      const ses = session.fromPartition(MUSIC_PARTITION);

      // 1. Google/YouTube reklam domainlerini iptal et
      ses.webRequest.onBeforeRequest({ urls: AD_BLOCK_PATTERNS }, (_details, cb) => cb({ cancel: true }));

      // 2. Google Bot / Electron tespitini engelle ve Chrome Client Hints ekle
      ses.setUserAgent(CHROME_UA);
      ses.webRequest.onBeforeSendHeaders(
        { urls: ['*://*.google.com/*', '*://*.youtube.com/*', '*://*.googleusercontent.com/*'] },
        (details, cb) => {
          const h: Record<string, string> = { ...details.requestHeaders };
          h['User-Agent'] = CHROME_UA;
          h['Sec-CH-UA'] = `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`;
          h['Sec-CH-UA-Mobile'] = '?0';
          h['Sec-CH-UA-Platform'] = '"Windows"';
          h['Sec-CH-UA-Platform-Version'] = '"15.0.0"';
          h['Accept-Language'] = h['Accept-Language'] || 'tr-TR,tr;q=0.9,en;q=0.8';
          h['Accept'] = h['Accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
          delete h['X-Client-Data'];
          delete h['x-client-data'];
          delete h['X-Electron'];
          cb({ requestHeaders: h });
        }
      );

      // 3. YouTube/Google çerez onayını otomatik aşmak için SOCS çerezi ekle
      ses.cookies.set({
        url: 'https://music.youtube.com',
        name: 'SOCS',
        value: 'CAESEwgDEgk2MTU3NjM3NDgaAmVuIAEaBgiA_LyaBg',
        domain: '.youtube.com',
        path: '/',
        secure: true
      }).catch(() => {});

      console.log('[AudioEngine] ✅ Session and Adblock initialized.');
    } catch (e) {
      console.warn('[AudioEngine] Session setup error:', e);
    }
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) {
      return this.win;
    }

    this.win = new BrowserWindow({
      width: 800,
      height: 500,
      show: false, // Hidden background audio engine
      autoHideMenuBar: true,
      title: 'Lupin Audio Stream Engine',
      webPreferences: {
        partition: MUSIC_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false
      }
    });

    this.win.webContents.setAudioMuted(false);
    this.win.webContents.setUserAgent(CHROME_UA);
    this.win.webContents.on('before-input-event', (e) => e.preventDefault());

    this.win.webContents.on('did-start-navigation', () => {
      try { this.win?.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {}); } catch {}
    });

    this.win.webContents.on('dom-ready', () => {
      try {
        this.win?.webContents.insertCSS(ADHIDE_CSS).catch(() => {});
        this.win?.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
      } catch {}
    });

    this.win.webContents.on('did-finish-load', () => {
      try { this.win?.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {}); } catch {}
      this.pollOnce().catch(() => {});
    });

    return this.win;
  }

  public setOnUpdate(cb: (state: PlaybackState) => void): void {
    this.updateCallback = cb;
  }

  public async play(videoId: string): Promise<boolean> {
    if (!videoId || this.isDestroyed) return false;
    const gen = ++this.playGen;
    this.currentVideoId = videoId;
    const win = this.ensureWindow();

    try {
      // 1. Eğer halihazırda açık bir sayfa ve movie_player varsa, sayfayı baştan yüklemek yerine
      // loadVideoById API'si ile ANINDA (100ms) çalmaya başla!
      let instantSwitched = false;
      const currentUrl = win.webContents.getURL();

      if (currentUrl && currentUrl.includes('music.youtube.com')) {
        try {
          const switchResult = await win.webContents.executeJavaScript(`(() => {
            try {
              const mp = document.getElementById('movie_player')
                || document.querySelector('ytmusic-player-bar')?.querySelector('#movie_player')
                || (window.__hmp && window.__hmp.isConnected ? window.__hmp : null);
              if (mp && typeof mp.loadVideoById === 'function') {
                mp.loadVideoById('${videoId}');
                if (typeof mp.playVideo === 'function') mp.playVideo();
                return true;
              }
            } catch (e) {}
            return false;
          })()`, true);

          if (switchResult === true) {
            instantSwitched = true;
          }
        } catch {}
      }

      // 2. Eğer anında geçiş yapılamadıysa (ilk şarkı veya sayfa hazır değilse), tam URL yükle
      if (!instantSwitched) {
        try {
          await win.loadURL(`${WATCH_URL}${encodeURIComponent(videoId)}`);
        } catch (e: any) {
          // Sayfa yüklenirken yeni bir istek geldiyse yoksay
          if (gen !== this.playGen) return false;
        }
      }

      if (gen !== this.playGen || win.isDestroyed()) return false;

      // Betikleri enjekte et ve sesi uygula
      await win.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
      await this.setVolume(this.volume);

      // Polling başlat
      this.startPolling();

      // Playback'in kesin olarak başladığını doğrula (autoplay bazen ikinci bir tetikleme gerektirir)
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 600));
        if (this.currentVideoId !== videoId || gen !== this.playGen || win.isDestroyed()) return false;

        const isPlaying = await win.webContents.executeJavaScript(`(() => {
          try {
            const mp = document.getElementById('movie_player')
              || document.querySelector('ytmusic-player-bar')?.querySelector('#movie_player')
              || window.__hmp;
            if (mp && typeof mp.getPlayerState === 'function') {
              const state = mp.getPlayerState();
              if (state === 1) return true;
              if (typeof mp.playVideo === 'function') mp.playVideo();
            } else {
              const v = document.querySelector('video');
              if (v) {
                if (!v.paused) return true;
                v.play().catch(() => {});
              }
            }
          } catch {}
          return false;
        })()`, true).catch(() => false);

        if (isPlaying) break;
      }

      // İlk durumu hemen bildir
      await this.pollOnce();
      return true;
    } catch (err) {
      console.error('[AudioEngine] Play failed:', err);
      return false;
    }
  }

  public async pause(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          const mp = document.getElementById('movie_player') || window.__hmp;
          if (mp && typeof mp.pauseVideo === 'function') mp.pauseVideo();
          for (const v of document.querySelectorAll('video, audio')) { v.pause(); }
        } catch {}
      })()`, true);
      await this.pollOnce();
    } catch {}
  }

  public async resume(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          const mp = document.getElementById('movie_player') || window.__hmp;
          if (mp && typeof mp.playVideo === 'function') mp.playVideo();
          for (const v of document.querySelectorAll('video, audio')) { v.play().catch(() => {}); }
        } catch {}
      })()`, true);
      await this.pollOnce();
    } catch {}
  }

  public async seek(seconds: number): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          const mp = document.getElementById('movie_player') || window.__hmp;
          if (mp && typeof mp.seekTo === 'function') {
            mp.seekTo(${Number(seconds)}, true);
          } else {
            const v = document.querySelector('video');
            if (v) v.currentTime = ${Number(seconds)};
          }
        } catch {}
      })()`, true);
      await this.pollOnce();
    } catch {}
  }

  public async setVolume(ratio: number): Promise<void> {
    this.volume = Math.max(0, Math.min(1, ratio));
    const ytVolume = Math.round(this.volume * 100);
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          const mp = document.getElementById('movie_player') || window.__hmp;
          if (mp && typeof mp.setVolume === 'function') {
            mp.setVolume(${ytVolume});
          }
          const v = document.querySelector('video');
          if (v) v.volume = ${this.volume};
        } catch {}
      })()`, true);
    } catch {}
  }

  private async pollOnce(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      const state: any = await this.win.webContents.executeJavaScript(RESOLVE_MEDIA_JS, true);
      if (state && state.ok && this.updateCallback) {
        if (state.videoId && state.videoId !== this.currentVideoId) {
          this.currentVideoId = state.videoId;
        }
        this.updateCallback({
          currentTime: Number(state.currentTime) || 0,
          duration: Number(state.duration) || 0,
          paused: !!state.paused,
          playerState: typeof state.playerState === 'number' ? state.playerState : -1,
          videoId: state.videoId || this.currentVideoId,
          title: state.title || undefined,
          artist: state.artist || undefined,
          thumbnail: state.thumbnail || undefined
        });
      }
    } catch {}
  }

  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch(() => {});
    }, 400);
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.win && !this.win.isDestroyed()) {
      try {
        this.win.webContents.stop();
        this.win.destroy();
      } catch {}
      this.win = null;
    }
  }
}
