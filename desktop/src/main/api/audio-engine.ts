import { BrowserWindow, session } from 'electron';

const MUSIC_PARTITION = 'persist:lupin_music';
const WATCH_URL = 'https://music.youtube.com/watch?v=';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CHROME_MAJOR = '131';

// Reklam ve reklam-olcum alan adlarini ag seviyesinde blokla
// (YouTube cekirdek butunluk, video icerik ve oynatici uclari haric)
const AD_BLOCK_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googleadservices.com/*',
  '*://*.googlesyndication.com/*',
  '*://*.googletagservices.com/*',
  '*://*.2mdn.net/*',
  '*://*.moatads.com/*',
  '*://*.ads.youtube.com/*',
  '*://*.s.youtube.com/*',
  '*://adservice.google.*/*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/api/stats/ads*',
  '*://music.youtube.com/pagead/*',
  '*://music.youtube.com/ptracking*',
  '*://music.youtube.com/api/stats/ads*',
  '*://pagead2.googlesyndication.com/*',
  '*://ad.doubleclick.net/*',
  '*://*.google.com/pagead/*',
  '*://*.google-analytics.com/*'
];

const ADHIDE_CSS = `
  .ytp-ad-player-overlay,
  .ytp-ad-text,
  .ytp-ad-preview-container,
  .ytp-ad-skip-button-container,
  .ytp-ad-message-container,
  .ytp-ad-image-overlay,
  .ytp-ad-overlay-container,
  .video-ads,
  #player-ads,
  #masthead-ad,
  .ytp-ad-module,
  ytd-ad-slot-renderer,
  .ytd-ad-slot-renderer,
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

// Reklamsız oynatma, onay ekranları ve arka plan görünürlük koruma betiği
const ADBLOCK_INJECTION_JS = `(() => {
  try {
    if (window.__lupin_engine_injected) return;
    window.__lupin_engine_injected = true;

    // 1. Page Visibility API taklidi (Arka planda / gizli pencerede YouTube Music'in durmasını engeller)
    try {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true
      });
      Object.defineProperty(document, 'hidden', {
        get: () => false,
        configurable: true
      });
      Object.defineProperty(document, 'webkitVisibilityState', {
        get: () => 'visible',
        configurable: true
      });
      Object.defineProperty(document, 'webkitHidden', {
        get: () => false,
        configurable: true
      });
      if (typeof document.hasFocus === 'function') {
        document.hasFocus = () => true;
      }
      const blockEvents = ['visibilitychange', 'webkitvisibilitychange', 'blur'];
      for (const ev of blockEvents) {
        window.addEventListener(ev, (e) => e.stopImmediatePropagation(), true);
        document.addEventListener(ev, (e) => e.stopImmediatePropagation(), true);
      }
      document.onvisibilitychange = null;
    } catch (e) {}

    // 2. Cookie, onay ve "Dinlemeye devam etmek istiyor musunuz?" popuplarını anında kapat
    const dismissDialogs = () => {
      try {
        const youThereBtn = document.querySelector('ytmusic-you-there-renderer button, yt-button-renderer#dismiss-button, #confirm-button');
        if (youThereBtn) {
          youThereBtn.click();
        }

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
          for (const b of document.querySelectorAll(sel)) {
            try { b.click(); } catch {}
          }
        }
      } catch {}
    };
    dismissDialogs();

    // 3. Guvenli reklam atlama mantigi (Asil sarkiyi asla kesmez veya sona sarmaz)
    const skipAds = () => {
      try {
        if (window.__lupin_adblock === false) return;
        const mp = document.getElementById('movie_player') || window.__hmp;
        const isAd = (mp && typeof mp.getAdState === 'function' && mp.getAdState() === 1)
          || (mp && mp.classList && (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting')));

        const v = document.querySelector('video');

        if (!isAd) {
          // Reklam bitti: hiz ve sessizligi normale dondur (sarki 16x'te veya sessiz kalmasin)
          try {
            if (window.__lupin_should_play && v) {
              if (v.playbackRate !== 1) v.playbackRate = 1;
              if (v.muted) v.muted = false;
            }
          } catch {}
          return;
        }

        if (mp && typeof mp.skipAd === 'function') {
          try { mp.skipAd(); } catch {}
        }

        const skipBtns = document.querySelectorAll(
          '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot button, button.ytp-ad-skip-button'
        );
        for (const b of skipBtns) {
          try { b.click(); } catch {}
        }

        if (v) {
          v.muted = true;
          // Sadece video suresi belirgin bir reklam boyutundaysa (< 60s) ve gercek reklam durumundaysa
          if (v.duration && !isNaN(v.duration) && v.duration < 60 && typeof mp.getAdState === 'function' && mp.getAdState() === 1) {
            v.playbackRate = 16;
            v.currentTime = v.duration;
          }
        }
      } catch {}
    };

    // 4. Periyodik denetim ve yetkisiz duraklatmayı otomatik devam ettirme (Keep-alive)
    setInterval(() => {
      dismissDialogs();
      skipAds();
      try {
        if (window.__lupin_should_play) {
          const mp = document.getElementById('movie_player') || window.__hmp;
          const v = document.querySelector('video');
          if (v && v.paused && !v.ended) {
            if (mp && typeof mp.playVideo === 'function') {
              mp.playVideo();
            } else {
              v.play().catch(() => {});
            }
          }
        }
      } catch {}
    }, 250);
  } catch (e) {}
})();`;

// YouTube Music'in kendi "otomatik siradaki" ozelligini kapatma denemesi.
// Kuyruk disi parca atlamasini engeller; seciciler bulunamazsa etkisizdir (zararsiz).
const DISABLE_AUTOPLAY_JS = `(() => {
  try {
    const mp = document.getElementById('movie_player') || window.__hmp;
    if (mp) {
      if (typeof mp.setAutonav === 'function') { try { mp.setAutonav(false); } catch {} }
      if (typeof mp.setAutonavState === 'function') { try { mp.setAutonavState(false); } catch {} }
    }
    const bar = document.querySelector('ytmusic-player-bar');
    if (bar) {
      const btns = bar.querySelectorAll('button, tp-yt-paper-icon-button, yt-icon-button');
      for (const b of btns) {
        try {
          const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase();
          const pressed = b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true';
          if (pressed && /autoplay|otomatik|up next|siradaki/.test(label)) { b.click(); break; }
        } catch {}
      }
    }
  } catch {}
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
      if (!isAd && mp.classList && (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting'))) isAd = true;
      // Yedek sinyal: gorunur reklam overlay elementi (gizli DOM kalintilarini sayma)
      if (!isAd) {
        try {
          const ov = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-image-overlay');
          if (ov && (ov as HTMLElement).offsetParent !== null) isAd = true;
        } catch {}
      }

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
  /** true ise o an reklam oynuyor; UI adopt/ilerleme bu bayraga gore donar */
  isAd?: boolean;
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
  private shouldPlay: boolean = false;
  private adblockEnabled: boolean = true;
  private engineMuted: boolean = false;
  private adStreak: number = 0;
  private adStreakKey: string = '';
  private adSeeks: number = 0;

  constructor() {
    this.setupSession();
  }

  /** Reklam engelleyiciyi ac/kapat (ag blok + sayfa ici atlama). */
  public async setAdblockEnabled(enabled: boolean): Promise<void> {
    this.adblockEnabled = enabled;
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript(
        `window.__lupin_adblock = ${enabled ? 'true' : 'false'};`, true
      ).catch(() => {});
    } catch {}
  }

  public isAdblockEnabled(): boolean {
    return this.adblockEnabled;
  }

  private setupSession(): void {
    if (this.adblockInstalled) return;
    this.adblockInstalled = true;
    try {
      const ses = session.fromPartition(MUSIC_PARTITION);

      // 1. Google/YouTube reklam domainlerini iptal et (kapatilabilir)
      ses.webRequest.onBeforeRequest({ urls: AD_BLOCK_PATTERNS }, (_details, cb) => {
        if (!this.adblockEnabled) return cb({});
        return cb({ cancel: true });
      });

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
    this.win.webContents.setBackgroundThrottling(false);
    this.win.webContents.setUserAgent(CHROME_UA);
    this.win.webContents.on('before-input-event', (e) => e.preventDefault());

    this.win.webContents.on('did-start-navigation', () => {
      try { this.win?.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {}); } catch {}
    });

    this.win.webContents.on('dom-ready', () => {
      try {
        this.win?.webContents.insertCSS(ADHIDE_CSS).catch(() => {});
        this.win?.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
        if (this.shouldPlay) {
          this.win?.webContents.executeJavaScript('window.__lupin_should_play = true;', true).catch(() => {});
        }
      } catch {}
    });

    this.win.webContents.on('did-finish-load', () => {
      try {
        this.win?.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
        this.win?.webContents.executeJavaScript(DISABLE_AUTOPLAY_JS, true).catch(() => {});
        this.setAdblockEnabled(this.adblockEnabled).catch(() => {});
        if (this.shouldPlay) {
          this.win?.webContents.executeJavaScript('window.__lupin_should_play = true;', true).catch(() => {});
        }
      } catch {}
      this.pollOnce().catch(() => {});
    });

    return this.win;
  }

  public prewarm(): void {
    if (this.isDestroyed) return;
    try {
      const win = this.ensureWindow();
      const currentUrl = win.webContents.getURL();
      if (!currentUrl || currentUrl === 'about:blank') {
        console.log('[AudioEngine] ⚡ Pre-warming audio stream engine on /watch...');
        win.loadURL('https://music.youtube.com/watch?v=jfKfPfyJRdk').then(() => {
          win.webContents.executeJavaScript(`(() => {
            try {
              const mp = document.getElementById('movie_player') || window.__hmp;
              if (mp && typeof mp.pauseVideo === 'function') mp.pauseVideo();
              const v = document.querySelector('video');
              if (v) { v.muted = true; v.pause(); }
            } catch {}
          })()`).catch(() => {});
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[AudioEngine] Pre-warm error:', e);
    }
  }

  public setOnUpdate(cb: (state: PlaybackState) => void): void {
    this.updateCallback = cb;
  }

  public async play(videoId: string): Promise<boolean> {
    if (!videoId || this.isDestroyed) return false;
    const gen = ++this.playGen;
    this.currentVideoId = videoId;
    this.shouldPlay = true;
    // Yeni parca: reklam savunma durumunu sifirla
    this.adStreak = 0;
    this.adStreakKey = '';
    this.adSeeks = 0;
    if (this.engineMuted) {
      this.engineMuted = false;
      try { this.win?.webContents.setAudioMuted(false); } catch {}
    }
    const win = this.ensureWindow();

    try {
      let instantSwitched = false;
      const currentUrl = win.webContents.getURL();

      if (currentUrl && currentUrl.includes('/watch')) {
        try {
          const switchResult = await win.webContents.executeJavaScript(`(() => {
            try {
              window.__lupin_should_play = true;
              const mp = document.getElementById('movie_player')
                || document.querySelector('ytmusic-player-bar')?.querySelector('#movie_player')
                || (window.__hmp && window.__hmp.isConnected ? window.__hmp : null);
              if (mp && typeof mp.loadVideoById === 'function') {
                mp.loadVideoById('${videoId}');
                if (typeof mp.playVideo === 'function') mp.playVideo();
                const v = document.querySelector('video');
                if (v) { v.muted = false; v.play().catch(() => {}); }
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

      if (instantSwitched) {
        this.setVolume(this.volume).catch(() => {});
        this.win?.webContents.executeJavaScript(DISABLE_AUTOPLAY_JS, true).catch(() => {});
        this.startPolling();
        setTimeout(() => { this.pollOnce().catch(() => {}); }, 60);
        return true;
      }

      // 2. Eğer movie_player ile anında geçiş yapılamadıysa, tam URL yükle
      try {
        await win.loadURL(`${WATCH_URL}${encodeURIComponent(videoId)}`);
      } catch (e: any) {
        if (gen !== this.playGen) return true;
      }

      if (gen !== this.playGen || win.isDestroyed()) return true;

      // Betikleri enjekte et ve sesi uygula
      await win.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
      await win.webContents.executeJavaScript('window.__lupin_should_play = true;', true).catch(() => {});
      win.webContents.executeJavaScript(DISABLE_AUTOPLAY_JS, true).catch(() => {});
      await this.setVolume(this.volume);

      // Oynatıcı hazır olana kadar bekle ve KESİN olarak çalmayı başlat
      win.webContents.executeJavaScript(`(() => {
        return new Promise((resolve) => {
          let tries = 0;
          const attempt = () => {
            tries++;
            try {
              window.__lupin_should_play = true;
              const mp = document.getElementById('movie_player')
                || document.querySelector('ytmusic-player-bar')?.querySelector('#movie_player')
                || window.__hmp;
              const v = document.querySelector('video');
              if (mp && typeof mp.playVideo === 'function') {
                mp.playVideo();
                if (v && v.paused) { v.muted = false; v.play().catch(() => {}); }
                return resolve(true);
              }
              if (v) {
                v.muted = false;
                v.play().catch(() => {});
                return resolve(true);
              }
            } catch (e) {}
            if (tries >= 35) return resolve(false);
            setTimeout(attempt, 80);
          };
          attempt();
        });
      })()`, true).catch(() => {});

      this.startPolling();
      setTimeout(() => { this.pollOnce().catch(() => {}); }, 150);
      return true;
    } catch (err) {
      console.error('[AudioEngine] Play failed:', err);
      return false;
    }
  }

  public async pause(): Promise<void> {
    this.shouldPlay = false;
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          window.__lupin_should_play = false;
          const mp = document.getElementById('movie_player') || window.__hmp;
          if (mp && typeof mp.pauseVideo === 'function') mp.pauseVideo();
          for (const v of document.querySelectorAll('video, audio')) { v.pause(); }
        } catch {}
      })()`, true);
      await this.pollOnce();
    } catch {}
  }

  public async resume(): Promise<void> {
    this.shouldPlay = true;
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          window.__lupin_should_play = true;
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

        let pstate = typeof state.playerState === 'number' ? state.playerState : -1;
        const cur = Number(state.currentTime) || 0;
        const dur = Number(state.duration) || 0;

        // Erken 'ended' (playerState 0) koruması:
        // Eğer şarkı süresi 10 saniyeden uzun ama henüz sonuna gelinmemişse (örneğin ilk 3 saniyede
        // bir reklam bitişi, geçici duraklama veya tampon yenilenmesi olduysa),
        // bunu kesinlikle şarkı bitti (0) olarak iletme. Oynatmayı devam ettir.
        if (pstate === 0 && dur > 10 && cur < dur - 3) {
          pstate = 3; // Buffering / geçiş
          if (this.shouldPlay) {
            this.win?.webContents.executeJavaScript(`(() => {
              try {
                const mp = document.getElementById('movie_player') || window.__hmp;
                if (mp && typeof mp.playVideo === 'function') mp.playVideo();
                const v = document.querySelector('video');
                if (v && v.paused) v.play().catch(() => {});
              } catch {}
            })()`, true).catch(() => {});
          }
        }

        // Eğer kullanıcı şarkıyı çalmak istiyor (shouldPlay === true) ama video arka planda
        // duraklatılmışsa (paused === true), otomatik olarak uyandır
        if (this.shouldPlay && state.paused && pstate === 2 && dur > 0 && cur < dur - 2) {
          this.win?.webContents.executeJavaScript(`(() => {
            try {
              const mp = document.getElementById('movie_player') || window.__hmp;
              if (mp && typeof mp.playVideo === 'function') mp.playVideo();
              const v = document.querySelector('video');
              if (v && v.paused) v.play().catch(() => {});
            } catch {}
          })()`, true).catch(() => {});
        }

        const isPaused = !this.shouldPlay || (state.paused && pstate === 2);
        const isAd = state.isAd === true;

        // Reklam savunmasi: art arda dogrulanan reklamda sesi motor seviyesinde kes
        // ve reklami sonuna sar (sarki suresi ne olursa olsun; gercek icerige dokunulmaz
        // cunku yalnizca isAd bayragi kalkmayinca devreye girer).
        if (isAd && this.adblockEnabled) {
          if (!this.engineMuted) {
            this.engineMuted = true;
            try { this.win?.webContents.setAudioMuted(true); } catch {}
          }
          const streakKey = state.videoId || this.currentVideoId;
          this.adStreak = (this.adStreakKey === streakKey) ? this.adStreak + 1 : 1;
          this.adStreakKey = streakKey;
          if (this.adStreak >= 2 && this.adSeeks < 3 && dur > 0) {
            this.adSeeks += 1;
            this.win?.webContents.executeJavaScript(`(() => {
              try {
                const mp = document.getElementById('movie_player') || window.__hmp;
                if (mp && typeof mp.seekTo === 'function' && typeof mp.getDuration === 'function') {
                  const d = mp.getDuration();
                  if (d > 0) mp.seekTo(d, true);
                }
                const v = document.querySelector('video');
                if (v && v.duration > 0) { v.muted = true; v.playbackRate = 16; v.currentTime = v.duration; }
              } catch {}
            })()`, true).catch(() => {});
          }
        } else {
          this.adStreak = 0;
          this.adStreakKey = '';
          this.adSeeks = 0;
          if (this.engineMuted) {
            this.engineMuted = false;
            try { this.win?.webContents.setAudioMuted(false); } catch {}
          }
        }

        this.updateCallback({
          currentTime: cur,
          duration: dur,
          paused: isPaused,
          playerState: pstate,
          videoId: state.videoId || this.currentVideoId,
          title: state.title || undefined,
          artist: state.artist || undefined,
          thumbnail: state.thumbnail || undefined,
          isAd
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
