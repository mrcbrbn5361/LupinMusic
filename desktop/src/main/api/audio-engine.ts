import { app, BrowserWindow, session } from 'electron';

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
  '*://adservice.google.com/*',
  '*://*.adservice.google.com/*',
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

        let isAdNow = false;
        try { if (typeof mp.getAdState === 'function' && mp.getAdState() === 1) isAdNow = true; } catch {}
        if (!isAdNow && mp && mp.classList && (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting'))) isAdNow = true;
        // Yedek sinyal YALNIZCA gorunur overlay: gizli DOM kalintisi gercek reklam sayilip
        // sarkinin sonuna sarmasina yol acamaz (hizli baslat-durdur dongusu kaynagi).
        if (!isAdNow) {
          try {
            const ov = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-image-overlay, .ytp-ad-text');
            if (ov && ov.offsetParent !== null) isAdNow = true;
          } catch {}
        }
        if (!isAdNow) return;

        if (mp && typeof mp.skipAd === 'function') {
          try { mp.skipAd(); } catch {}
        }

        const skipBtns = document.querySelectorAll(
          '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot button, button.ytp-ad-skip-button'
        );
        for (const b of skipBtns) {
          try { b.click(); } catch {}
        }

        // Duraklatilmis icerige asla dokunma: seek/speed degisimi "sarki bitti"
        // sinyali uretip kendiliginden sira ilerlemesine yol acmasin.
        // SURE KORUMASI: sarki basindaki gecici ad-sinyali uzun icerigi sessize
        // almasin/sona sarmasIN — mute dahil her sey yalnizca KISA (<120sn) videoda.
        if (v && isAdNow && !v.paused && !v.ended) {
          const vd2 = v.duration;
          if (vd2 && !isNaN(vd2) && vd2 > 0 && vd2 < 120) {
            v.muted = true;
            v.playbackRate = 16;
            v.currentTime = vd2;
          }
        }
      } catch {}
    };

    // 4. Periyodik denetim ve yetkisiz duraklatmayı otomatik devam ettirme (Keep-alive)
    // Hizli-ses koprusu aktifken (fast_hold) YT videosuna dokunma: cift ses olmasin
    setInterval(() => {
      dismissDialogs();
      skipAds();
      try {
        if (window.__lupin_should_play && !window.__lupin_fast_hold) {
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

// Hizli baslatma: dogrudan ses akisi durum sorgusu (fast-path <audio> elementi)
const FAST_POLL_JS = `(() => {
  try {
    const a = window.__lupin_fast;
    if (!a) return { ok: false };
    if (a.error) return { ok: false, error: true };
    // Kopru aktifken YT standby'da kalsin: kendi basina uyanirsa cift ses olur
    if (window.__lupin_fast_hold) {
      for (const v of document.querySelectorAll('video')) {
        try { if (!v.muted) v.muted = true; if (!v.paused) v.pause(); } catch {}
      }
    }
    return { ok: true, cur: a.currentTime || 0, dur: a.duration || 0, paused: !!a.paused, ended: !!a.ended };
  } catch (e) {
    return { ok: false };
  }
})()`;

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
      let rawAd = false;
      let adSignal = '';
      try { if (typeof mp.getAdState === 'function' && mp.getAdState() === 1) { rawAd = true; adSignal = 'adState=1'; } } catch {}
      if (!rawAd && mp.classList && (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting'))) {
        rawAd = true;
        adSignal = mp.classList.contains('ad-showing') ? 'cls:ad-showing' : 'cls:ad-interrupting';
      }
      // Yedek sinyal: gorunur reklam overlay elementi (gizli DOM kalintilarini sayma)
      // DIKKAT: bu blok executeJavaScript STRING'idir — TS sozdizimi (as, <T>) YAZILAMAZ,
      // tarayicida SyntaxError tum RESOLVE'u oldurur (2026-09-25 kok nedeni).
      if (!rawAd) {
        try {
          const ov = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-image-overlay');
          if (ov && ov.offsetParent !== null) { rawAd = true; adSignal = 'overlay'; }
        } catch {}
      }

      let vd = null;
      try { vd = mp.getVideoData ? mp.getVideoData() : null; } catch {}

      let cur = 0, dur = 0, pstate = -1;
      try { cur = mp.getCurrentTime ? mp.getCurrentTime() : 0; } catch {}
      try { dur = mp.getDuration ? mp.getDuration() : 0; } catch {}
      try { pstate = mp.getPlayerState ? mp.getPlayerState() : -1; } catch {}

      const v = document.querySelector('video');
      if (v) {
        if ((!cur || cur <= 0) && v.currentTime && !isNaN(v.currentTime)) {
          cur = v.currentTime;
        }
        if ((!dur || dur <= 0) && v.duration && !isNaN(v.duration)) {
          dur = v.duration;
        }
        if (pstate === -1 && !v.paused) {
          pstate = 1;
        }
      }

      // SURE KORUMASI (2026-09-25): reklam siniflari/API'si sarki BASINDA gecici
      // olarak takiliyordu; isIcegi gercek sarkiya sona sariyordu (kayit: ad-skip
      // seek dur=280/328/346). Gercek reklam video elementinde KISA (<120sn)
      // gorunur; sinyal + kisa sure birlikte = reklam. Uzun surede sinyal ne olursa
      // olsun reklam sayilmaz, mute/seek asla uygulanmaz.
      let vdur = 0;
      if (v && v.duration > 0 && isFinite(v.duration)) vdur = v.duration;
      else if (dur > 0 && isFinite(dur)) vdur = dur;
      const isAd = rawAd && vdur > 0 && vdur < 120;
      const apiVid = (vd && (vd.video_id || vd.videoId)) || '';
      let urlObjVid = '';
      try {
        const u = mp.getVideoUrl ? mp.getVideoUrl() : '';
        const m = u.match(/[?&]v=([^&]+)/);
        if (m) urlObjVid = m[1];
      } catch {}
      // Dikkat: sayfa location (?v) warm loadVideoById gecislerinde HIC degismez;
      // ilk acilan sarkida takilir. Onun icin id kaynagi olarak ASLA kullanilmaz.
      // vd bosken bilinmiyordur: bos don (motor kendi current'ini korur, bayat id benimsemez).
      const vid = apiVid || urlObjVid;

      // Extract Title and Artist (vid apiVid tabanli oldugu icin vd verisi tazedir)
      let title = '';
      let artist = '';
      const apiDataFresh = !!vd;
      if (vd) {
        title = vd.title || '';
        artist = vd.author || '';
      }

      // DKKAT: vd tazeyse (var ama bos bile olsa) document.title / player-bar
      // fallback'ine ASLA dusulmez. Reklam/araya geciste vd.video_id hedefe
      // gecmisken vd.title bos kalir; o fallback'ler ESKI (prewarm) sayfanin
      // basligini sizar ve yanlis deger placeholder'i bir kez tuketir.
      // Taze-vd'de bos baslik bir poll placeholder olarak kalir, sonrasi dogru veriyi alir.
      if (!apiDataFresh && !title) {
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

      // Fallback 2: ytmusic-player-bar DOM (yalnizca vd yokken)
      if (!apiDataFresh && (!title || !artist)) {
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
        // <video> elementinin gercek durumu: pstate 3 (buffering) icinde de
        // ses akabiliyor; duraklatma zorlamasi buna bakar.
        vPaused: v ? !!v.paused : null,
        playerState: pstate,
        isAd,
        adSignal: rawAd ? (adSignal + '|vdur=' + vdur) : '',
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
      vPaused: !!v.paused,
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
  /** Ham reklam sinyalinin kaynagi (tanim disi: adState/cls/overlay + vdur); yalnizca tanilik */
  adSignal?: string;
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
  // YT id adopt disiplini: tek poll'daki farkli id hemen benimsenmez
  private idCandidate: string = '';
  private idStreak: number = 0;
  private lastPlayAt: number = 0;
  // Gecis dogrulamasi: idConfirmed=false iken motor henuz yeni parcaya gecmemistir;
  // replacedVideoId bilerek cikilan onceki sarkidir, asla yeniden benimsenmez.
  private idConfirmed: boolean = false;
  private replacedVideoId: string = '';
  private switchRetryCount: number = 0;
  private coldReloadDone: boolean = false;
  private resolveFailStreak: number = 0;
  private lastSnapBackAt: number = 0;
  // Duraklatma zorlamasi: kullanici pause ettiyse YT kendi akisini (reklam sonu
  // gecisi, autonav) geri baslatsa bile motor sesi yeniden kapatir.
  private lastPauseEnforceAt: number = 0;
  // Duraklatma anindaki konum: konum gercekten ilerliyorsa yeniden duraklat,
  // buffering kilidinde hic dokunma (ac-kapa dongusu olusurdu).
  private pauseAnchor: number = -1;
  // YouTube zorla devam ederken <video>'nun ulastigi gercek konum: resume'da
  // farki 2 sn'den buyukse kullanicinin birakigi yere geri sarilir.
  private pauseRealCur: number = -1;
  // Baslik gecis korumasi: vid degistigi halde baslik henuz degismemis ise o deger
  // onceki videonundur; yeni baslik gelene (veya kisa pencereye) kadar kullanilmaz.
  private lastStateVid: string = '';
  private lastStateTitle: string = '';
  private staleTitleValue: string = '';
  private staleTitleUntil: number = 0;
  private currentEnded: boolean = false;
  private endPending: boolean = false;
  private endReported: boolean = false;
  private lastOursDur: number = 0;
  private lastRawAdSignal: string = '';
  // Hizli baslatma (fast-path): YT oynatici hazir olana kadar dogrudan akisla cal
  private fastAudio: boolean = false;
  private fastMeta: { title?: string; artist?: string; thumbnail?: string; duration?: number } = {};
  private streamProvider?: (videoId: string) => Promise<string | null>;
  private streamCache = new Map<string, { url: string; at: number }>();
  private fastPending: { gen: number; url: string } | null = null;
  private static STREAM_TTL_MS = 45 * 60 * 1000;

  /** Dogrudan ses URL saglayici (main tarafindan InnerTube ile baglanir). */
  public setStreamProvider(provider: (videoId: string) => Promise<string | null>): void {
    this.streamProvider = provider;
  }

  constructor() {
    // session.fromPartition app.ready ister; modul yuklemesinde erken kurulursa
    // Session setup error verip ag-reklam-blokmani sessizce olur birakirdi.
    if (app.isReady()) {
      this.setupSession();
    } else {
      app.whenReady().then(() => this.setupSession()).catch(() => {});
    }
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

  /** Hizli elementi durdur ve kaldir (yeni parca / handoff / hata durumlari). */
  private async stopFastElement(): Promise<void> {
    this.fastAudio = false;
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          const a = window.__lupin_fast;
          if (a) { try { a.pause(); } catch {} try { a.removeAttribute('src'); } catch {} try { a.load(); } catch {} }
        } catch {}
      })()`, true).catch(() => {});
    } catch {}
  }

  /** Hizli-ses hold'unu birak; istenirse YT videosunu sesli devam ettir. */
  private async clearFastHold(resumeYt: boolean): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return;
    // Kullanici duraklattiysa hold birakilsa bile oynatici UYANDIRILMAZ:
    // kopru yerlestigi/settle oldugu anda sarki kendiliginden devam ediyor,
    // Discord presence'i de 'playing'e donuyordu (pause flapping).
    const mayResume = resumeYt && this.shouldPlay;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          window.__lupin_fast_hold = false;
          ${mayResume ? `
          const mp = document.getElementById('movie_player') || window.__hmp;
          if (mp && typeof mp.playVideo === 'function') mp.playVideo();
          const v = document.querySelector('video');
          if (v) { v.muted = false; v.play().catch(() => {}); }` : ''}
        } catch {}
      })()`, true).catch(() => {});
    } catch {}
  }

  /**
   * Hizli baslatma 1. asama: istege bagli hold + akis URL fetch.
   * - cold (holdEarly): sayfa zaten yukleniyor; hold erken konur, element kurulumu
   *   loadURL sonrasinda play() tarafindan yapilir (attachNow=false).
   * - warm (attachNow): fetch sirasinda YT'ye dokunulmaz; hazir degilse kopru kurulur,
   *   hazirsa (ready-precheck) kopru iptal edilip oynatici oldugu gibi birakilir.
   */
  private async startFastPath(videoId: string, gen: number, attachNow: boolean, holdEarly: boolean): Promise<void> {
    try {
      if (!this.streamProvider || !this.win || this.win.isDestroyed()) return;
      if (holdEarly) {
        await this.win.webContents.executeJavaScript(
          'window.__lupin_fast_hold = true;', true
        ).catch(() => {});
      }

      const now = Date.now();
      const cached = this.streamCache.get(videoId);
      let url = (cached && now - cached.at < AudioEngine.STREAM_TTL_MS) ? cached.url : '';
      if (!url) {
        url = (await this.streamProvider(videoId).catch(() => null)) || '';
        if (url) this.streamCache.set(videoId, { url, at: now });
      }
      if (gen !== this.playGen) return;
      if (!url) {
        // Hold vardiysa sadece bayragi birak: eski sayfada playVideo tetiklenmesin
        if (holdEarly) await this.clearFastHold(false);
        return;
      }
      this.fastPending = { gen, url };
      if (attachNow) {
        await this.attachFastElement(true);
      } else {
        // Cold: sayfa henuz yukleniyor olabilir; simdi de dene (gen korumali).
        // Basarisiz olursa fastPending kalir, play() loadURL sonrasi tekrar dener.
        this.attachFastElement(false).catch(() => {});
      }
    } catch {
      if (gen !== this.playGen) return;
      await this.stopFastElement().catch(() => {});
      if (holdEarly) await this.clearFastHold(false).catch(() => {});
    }
  }

  /**
   * Hizli baslatma 2. asama: <audio> elementini MEVCUT sayfada kurar.
   * Navigasyon oncesi eski sayfada cagrilirsa ise yaramaz; play() soguk yolda
   * loadURL sonrasi tekrar denenir. Gen disi cagrilar no-op'tur.
   */
  private async attachFastElement(resumeOnFail: boolean = true): Promise<boolean> {
    const p = this.fastPending;
    if (!p || p.gen !== this.playGen || !this.win || this.win.isDestroyed()) return false;

    // Ready-precheck: YT bu parcai suresiyle hazir ve oynuyorsa kopruya gerek yok.
    // Hazir oynaticiyi tutup cipher beklemek baslatmayi geciktirirdi (Antigravity notu).
    const ready: boolean = await this.win.webContents.executeJavaScript(`(() => {
      try {
        const mp = document.getElementById('movie_player') || window.__hmp;
        if (!mp || !mp.isConnected || typeof mp.getDuration !== 'function') return false;
        const vd = (typeof mp.getVideoData === 'function') ? mp.getVideoData() : null;
        const vid = (vd && (vd.video_id || vd.videoId)) || '';
        const d = mp.getDuration();
        const st = (typeof mp.getPlayerState === 'function') ? mp.getPlayerState() : -1;
        return vid === ${JSON.stringify(this.currentVideoId)} && d > 0 && (st === 1 || st === 3);
      } catch (e) { return false; }
    })()`, true).catch(() => false);

    if (p.gen !== this.playGen) return false;
    if (ready === true) {
      // Oynatici zaten hazir: kopru iptal, YT oldugu gibi devam etsin
      this.fastPending = null;
      await this.clearFastHold(resumeOnFail);
      return false;
    }

    const started: boolean = await this.win.webContents.executeJavaScript(`(() => {
      try {
        let a = window.__lupin_fast;
        if (!a || !a.isConnected) {
          a = new Audio();
          a.id = '__lupin_fast';
          a.preload = 'auto';
          document.documentElement.appendChild(a);
        }
        a.volume = ${this.volume};
        const target = ${JSON.stringify(p.url)};
        if (a.getAttribute('src') !== target) a.src = target;
        // Kopru devrede: hold + YT standby (sayfa videolari sessiz + duraklatilmis)
        window.__lupin_fast_hold = true;
        for (const v of document.querySelectorAll('video')) {
          try { v.muted = true; v.pause(); } catch {}
        }
        if (${this.shouldPlay ? 'true' : 'false'}) {
          a.play().catch(() => {});
        } else {
          a.pause();
        }
        return true;
      } catch (e) {
        return false;
      }
    })()`, true).catch(() => false);

    if (p.gen !== this.playGen) return false;
    if (started !== true) {
      if (resumeOnFail) {
        this.fastPending = null;
        await this.stopFastElement();
        await this.clearFastHold(true);
      }
      // resumeOnFail=false (cold, navigasyon oncesi): fastPending korunur;
      // play() loadURL sonrasindaki cagrida tekrar denenir
      return false;
    }
    this.fastPending = null;
    this.fastAudio = true;
    this.startPolling();
    this.pollOnce().catch(() => {});
    return true;
  }

  /** Hizli mod poll: durumu <audio>'dan uret; YT hazirsa konuma devam ederek devret. */
  private async pollFast(): Promise<'fast' | 'settle'> {
    const gen = this.playGen;
    const vid = this.currentVideoId;
    const win = this.win;
    if (!win || win.isDestroyed()) {
      this.fastAudio = false;
      return 'settle';
    }
    const f: any = await win.webContents.executeJavaScript(FAST_POLL_JS, true).catch(() => null);
    // Araya yeni parca girdiyse bu koprunun hukum kalmadi: yeni holder'a dokunma
    if (gen !== this.playGen || vid !== this.currentVideoId) return 'settle';
    if (!f || !f.ok || f.error) {
      console.log(`[AudioEngine] fast-path stream lost (err=${f?.error || 'no-element'}) -> YT fallback`);
      // Akis oldu: YT'ye don (akisi cache'den dusur)
      this.streamCache.delete(this.currentVideoId);
      await this.stopFastElement();
      await this.clearFastHold(true);
      return 'settle';
    }
    // YT ayni videoyu suresiyle hazir ettiyse devral
    const yt: any = await win.webContents.executeJavaScript(RESOLVE_MEDIA_JS, true).catch(() => null);
    if (gen !== this.playGen || vid !== this.currentVideoId) return 'settle';
    if (yt && yt.ok && yt.videoId === this.currentVideoId && Number(yt.duration) > 0) {
      const pos = Math.max(0, Number(f.cur) || 0);
      console.log(`[AudioEngine] fast-path settle at ${pos.toFixed(2)}s (yt ready)`);
      await this.settleFastPath(pos);
      return 'settle';
    }
    const ended = !!f.ended;
    this.updateCallback?.({
      currentTime: Number(f.cur) || 0,
      duration: Number(f.dur) || this.fastMeta.duration || 0,
      paused: !this.shouldPlay || !!f.paused,
      playerState: ended ? 0 : (f.paused ? 2 : 1),
      videoId: this.currentVideoId,
      title: this.fastMeta.title || undefined,
      artist: this.fastMeta.artist || undefined,
      thumbnail: this.fastMeta.thumbnail || undefined,
      isAd: false
    });
    return 'fast';
  }

  /** Hizli moddan YT oynaticiya gecis (konum korunur). */
  private async settleFastPath(posSeconds: number): Promise<void> {
    await this.stopFastElement();
    if (!this.win || this.win.isDestroyed()) return;
    // Duraklatma kopru devrede yapildiysa devralma yalnizca konumlandirir,
    // oynatici duraklatilmis kalir ( aksi halde pause aninda sarki geri doner).
    const keepPaused = !this.shouldPlay;
    try {
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          window.__lupin_fast_hold = false;
          const s = ${Number(posSeconds) || 0};
          const mp = document.getElementById('movie_player') || window.__hmp;
          if (mp && typeof mp.seekTo === 'function' && typeof mp.getDuration === 'function') {
            const d = mp.getDuration();
            if (d > 0) mp.seekTo(Math.min(s, Math.max(0, d - 0.5)), true);
          }
          ${keepPaused ? `
          if (mp && typeof mp.pauseVideo === 'function') mp.pauseVideo();
          const v0 = document.querySelector('video');
          if (v0) { v0.playbackRate = 1; v0.muted = true; v0.pause(); }` : `
          if (mp && typeof mp.playVideo === 'function') mp.playVideo();
          const v = document.querySelector('video');
          if (v) { v.playbackRate = 1; v.muted = false; v.play().catch(() => {}); }`}
        } catch {}
      })()`, true).catch(() => {});
      await this.setVolume(this.volume);
    } catch {}
  }

  private setupSession(): void {
    if (this.adblockInstalled) return;
    try {
      const ses = session.fromPartition(MUSIC_PARTITION);
      // Flag yalnizca session alindiktan sonra konur: once konursa basarisiz
      // kurulum (app.ready oncesi) tekrar denenemezdi.
      this.adblockInstalled = true;

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
        this.win?.webContents.executeJavaScript(`window.__lupin_should_play = ${this.shouldPlay ? 'true' : 'false'};`, true).catch(() => {});
      } catch {}
    });

    this.win.webContents.on('did-finish-load', () => {
      try {
        this.win?.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
        this.win?.webContents.executeJavaScript(DISABLE_AUTOPLAY_JS, true).catch(() => {});
        this.setAdblockEnabled(this.adblockEnabled).catch(() => {});
        this.win?.webContents.executeJavaScript(`window.__lupin_should_play = ${this.shouldPlay ? 'true' : 'false'};`, true).catch(() => {});
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

  public async play(videoId: string, meta?: { title?: string; artist?: string; thumbnail?: string; duration?: number }): Promise<boolean> {
    if (!videoId || this.isDestroyed) return false;
    const gen = ++this.playGen;
    this.replacedVideoId = this.currentVideoId;
    this.currentVideoId = videoId;
    this.idConfirmed = false;
    this.switchRetryCount = 0;
    this.coldReloadDone = false;
    this.resolveFailStreak = 0;
    this.currentEnded = false;
    this.endPending = false;
    this.endReported = false;
    this.lastOursDur = 0;
    this.shouldPlay = true;
    this.fastMeta = {
      title: meta?.title || 'Lupin Music',
      artist: meta?.artist || 'Lupin Audio',
      thumbnail: meta?.thumbnail || '',
      duration: meta?.duration || 0
    };
    // Onceki hizli-ses varsa durdur (sicak geciste cift ses olmasin)
    this.fastAudio = false;
    this.fastPending = null;
    this.stopFastElement().catch(() => {});
    this.clearFastHold(false).catch(() => {});
    this.idCandidate = '';
    this.idStreak = 0;
    this.lastPlayAt = Date.now();
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
                if (v) { v.playbackRate = 1; v.muted = false; v.play().catch(() => {}); }
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
      // Await sonrasi gen kontrolu: ara sira baska parca baslatildiysa bayat sonuc islenmez
      if (gen !== this.playGen) return true;

      if (instantSwitched) {
        this.setVolume(this.volume).catch(() => {});
        this.win?.webContents.executeJavaScript(DISABLE_AUTOPLAY_JS, true).catch(() => {});
        // Sicak geciste YT yeni akisi hazirlarken kopru ile aninda ses:
        // hazir oynatici ready-precheck ile oldugu birakilir (gecikme olmaz)
        this.startFastPath(videoId, gen, true, false).catch(() => {});
        this.startPolling();
        setTimeout(() => { this.pollOnce().catch(() => {}); }, 60);
        return true;
      }

      // 2. Eger movie_player ile aninda gecis yapilamadiysa:
      //    paralel hizli-ses koprusu + tam URL yukleme
      this.startFastPath(videoId, gen, false, true).catch(() => {});
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

      // Navigasyon tamamladi: bekleyen hizli-ses URL'si varsa elementi simdi kur
      if (gen === this.playGen) {
        await this.attachFastElement(true).catch(() => false);
      }

      // Oynatıcı hazır olana kadar bekle ve KESİN olarak çalmayı başlat
      // (hizli-ses hold aktifse YT standby'da kalir: sessiz + duraklatilmis)
      win.webContents.executeJavaScript(`(() => {
        return new Promise((resolve) => {
          let tries = 0;
          const attempt = () => {
            // Kullanici bu arada duraklattiyse isle birak (yoksa playVideo
            // dongusu pause'u ezip "ac-kapa" yapardi)
            if (window.__lupin_should_play === false) return resolve(false);
            try {
              window.__lupin_should_play = true;
              const hold = window.__lupin_fast_hold === true;
              const mp = document.getElementById('movie_player')
                || document.querySelector('ytmusic-player-bar')?.querySelector('#movie_player')
                || window.__hmp;
              const v = document.querySelector('video');
              if (mp && typeof mp.playVideo === 'function') {
                if (!hold) {
                  mp.playVideo();
                  if (v && v.paused) { v.playbackRate = 1; v.muted = false; v.play().catch(() => {}); }
                } else if (v) {
                  try { v.muted = true; v.pause(); } catch {}
                }
                return resolve(true);
              }
              if (v) {
                if (!hold) {
                  v.playbackRate = 1;
                  v.muted = false;
                  v.play().catch(() => {});
                } else {
                  try { v.muted = true; v.pause(); } catch {}
                }
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
    this.pauseAnchor = -1;
    if (!this.win || this.win.isDestroyed()) return;
    const js = `(() => {
        try {
          window.__lupin_should_play = false;
          const mp = document.getElementById('movie_player') || window.__hmp;
          if (mp && typeof mp.pauseVideo === 'function') mp.pauseVideo();
          // Sesi de kapat: YouTube reklam sonu/autonav akisinda videoyu
          // kendiliginden tekrar baslatirsa duyulabilir "ac-kapa" olmasin.
          for (const v of document.querySelectorAll('video, audio')) {
            try { v.muted = true; v.pause(); } catch {}
          }
        } catch {}
      })()`;
    // Navigasyon sirasinda ilk deneme kaybolabilir: bayrak sayfaya inmeden
    // pes etme (keep-alive aksi halde sarkiyi yeniden baslatabilir)
    for (let i = 0; i < 3; i++) {
      try {
        await this.win.webContents.executeJavaScript(js, true);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    try { await this.pollOnce(); } catch {}
  }

  public async resume(): Promise<void> {
    this.shouldPlay = true;
    // YouTube duraklatma sirasinda zorla ilerlediyse, kullanici birakigi
    // konuma geri sar ve oradan devam et
    const anchor = this.pauseAnchor;
    const real = this.pauseRealCur;
    this.pauseAnchor = -1;
    this.pauseRealCur = -1;
    if (!this.win || this.win.isDestroyed()) return;
    try {
      if (anchor >= 0 && real >= 0 && real - anchor > 2) {
        const back = Math.max(0, anchor);
        this.win.webContents.executeJavaScript(`(() => {
          try {
            const mp = document.getElementById('movie_player') || window.__hmp;
            if (mp && typeof mp.seekTo === 'function') mp.seekTo(${back}, true);
            const v = document.querySelector('video');
            if (v) v.currentTime = ${back};
          } catch {}
        })()`, true).catch(() => {});
      }
      await this.win.webContents.executeJavaScript(`(() => {
        try {
          window.__lupin_should_play = true;
          const hold = window.__lupin_fast_hold === true;
          // Hizli-ses koprusu devrede: onu devam ettir, YT standby'da kalsin
          const fa = document.getElementById('__lupin_fast');
          if (fa && hold) { try { fa.muted = false; fa.play().catch(() => {}); } catch {} }
          // pause() medyayi susturmustu: geri ac
          for (const v of document.querySelectorAll('video, audio')) { try { v.muted = false; } catch {} }
          if (!hold) {
            const mp = document.getElementById('movie_player') || window.__hmp;
            if (mp && typeof mp.playVideo === 'function') mp.playVideo();
            for (const v of document.querySelectorAll('video')) { v.play().catch(() => {}); }
          }
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
          const fa = document.getElementById('__lupin_fast');
          if (fa) { try { fa.currentTime = ${Number(seconds)}; } catch {} }
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
          const fa = document.getElementById('__lupin_fast');
          if (fa) { try { fa.volume = ${this.volume}; } catch {} }
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
    // Hizli-ses koprusu aktifken durum <audio>'dan uret
    if (this.fastAudio) {
      try {
        const mode = await this.pollFast();
        if (mode === 'fast') return;
      } catch {}
    }
    try {
      const state: any = await this.win.webContents.executeJavaScript(RESOLVE_MEDIA_JS, true);
      if (state && state.ok) {
        this.resolveFailStreak = 0;
        if (!this.updateCallback) return;
        let cur = Number(state.currentTime) || 0;
        let dur = Number(state.duration) || 0;
        let pstate = typeof state.playerState === 'number' ? state.playerState : -1;

        // Gecis dogrulamasi:
        // - idConfirmed: motor gercekten bu parcaya gecti mi?
        // - replacedVideoId: bilerek cikilan onceki sarki; asla yeniden benimsenmez.
        // - onaylanmadan gorulen yabanci id (bayat yanki) benimsenmez.
        const isRecentUserSwitch = Date.now() - this.lastPlayAt < 3000;
        const stateVid = state.videoId || '';
        let forceEnd = false;

        if (stateVid && stateVid === this.currentVideoId) {
          if (!this.idConfirmed) {
            console.log(`[AudioEngine] ✓ id confirmed: ${stateVid} after ${Date.now() - this.lastPlayAt}ms`);
          }
          this.idConfirmed = true;
          this.idCandidate = '';
          this.idStreak = 0;
          if (dur > 0) this.lastOursDur = dur;
          if (dur > 0 && cur > 0 && cur >= dur - 1.0) {
            // Bitis bolgesi goruldu: sonraki poll'da yabanci id gelse bile
            // "sarki bitti" bilgisi kaybolmasin (ilerleme renderer'in isidir)
            if (!this.endPending) {
              console.log(`[AudioEngine] endPending set: cur=${cur.toFixed(2)} dur=${dur.toFixed(2)} pstate=${pstate} vid=${stateVid}`);
            }
            this.endPending = true;
          }
          if (this.endPending && pstate === 0) {
            this.currentEnded = true;
            this.endReported = true; // bitis raporu dogal yoldan gitti
          } else if (this.endPending && !this.endReported && dur > 0 && cur >= dur - 0.5 && pstate !== 0) {
            // Bitiste pstate0 poll'u kacti (hemen post-roll reklam basladi):
            // sure tam sondayken bitis raporunu burada zorla (bir kez).
            this.currentEnded = true;
            this.endReported = true;
            forceEnd = true;
          } else if (!this.endReported && this.endPending && cur < dur - 2 && dur > 0) {
            this.endPending = false; // kullanici geri sardi: bitis sayilmaz
          }
        } else if (stateVid && (stateVid === this.replacedVideoId || !this.idConfirmed)) {
          // Bayat yanki ya da onaylanmamis gecisteki yabanci id: ele
          this.idCandidate = '';
          this.idStreak = 0;
        } else if (stateVid && state.isAd !== true) {
          if (this.endPending || this.endReported) {
            // Bizim parca bitti: YT autonav'i yalnizca susturulur (tekrar
            // baslamasin), ilerleme + sira renderer'dir. Bitis raporu bir kez.
            if (!this.endReported) {
              this.endReported = true;
              this.currentEnded = true;
              forceEnd = true;
            }
            console.log(`[AudioEngine] ↩ autonav silenced after end: ${stateVid} (raw cur=${cur.toFixed(2)} dur=${dur.toFixed(2)} pstate=${pstate} endPending=${this.endPending})`);
            this.win?.webContents.executeJavaScript(`(() => {
              try {
                const mp = document.getElementById('movie_player') || window.__hmp;
                if (mp && typeof mp.pauseVideo === 'function') mp.pauseVideo();
                const v = document.querySelector('video');
                if (v) v.pause();
              } catch {}
            })()`, true).catch(() => {});
          } else {
            // YABANCI id (parca ortasinda): YT up-next/radyo autonav kendi
            // kendine video yukledi. Benimseme YOK — 2 poll teyit + 1.5sn
            // rate-limit ile kendi parcaya snap-back donulur.
            if (stateVid === this.idCandidate) {
              this.idStreak += 1;
            } else {
              this.idCandidate = stateVid;
              this.idStreak = 1;
            }
            if (this.idStreak >= 2 && Date.now() - this.lastSnapBackAt > 1500) {
              this.lastSnapBackAt = Date.now();
              this.idCandidate = '';
              this.idStreak = 0;
              if (!this.shouldPlay) {
                console.log(`[AudioEngine] ↩ autonav silenced (paused): ${stateVid}`);
                this.win?.webContents.executeJavaScript(`(() => {
                  try {
                    const mp = document.getElementById('movie_player') || window.__hmp;
                    if (mp && typeof mp.pauseVideo === 'function') mp.pauseVideo();
                    const v = document.querySelector('video');
                    if (v) v.pause();
                  } catch {}
                })()`, true).catch(() => {});
              } else {
                console.log(`[AudioEngine] ↩ autonav rejected: ${stateVid} -> snap back to ${this.currentVideoId}`);
                const snapTo = JSON.stringify(this.currentVideoId);
                this.win?.webContents.executeJavaScript(`(() => {
                  try {
                    window.__lupin_should_play = true;
                    const mp = document.getElementById('movie_player') || window.__hmp;
                    if (mp && typeof mp.loadVideoById === 'function') {
                      if (typeof mp.setAutonav === 'function') { try { mp.setAutonav(false); } catch {} }
                      mp.loadVideoById(${snapTo});
                      if (typeof mp.playVideo === 'function') mp.playVideo();
                      const v = document.querySelector('video');
                      if (v) { v.playbackRate = 1; v.muted = false; v.play().catch(() => {}); }
                    }
                  } catch {}
                })()`, true).catch(() => {});
              }
            }
          }
        } else {
          this.idCandidate = '';
          this.idStreak = 0;
        }
        const effectiveVideoId = this.currentVideoId;

        // Bayat kaynaktan gelen sure/konum yeni parcaya sizmasin:
        // onaylanmamis gecis, bilinen tombstone (replaced) ve yabanci id'ler
        // hep stale sayilir; sure meta'dan, konum sifirdan raporlanir.
        const staleSource = !this.idConfirmed ||
          (this.replacedVideoId && stateVid === this.replacedVideoId) ||
          (stateVid && stateVid !== this.currentVideoId);
        if (staleSource) {
          cur = 0;
          const metaDur = Number(this.fastMeta.duration) || 0;
          if (metaDur > 0) dur = metaDur;
          if (pstate === 0) pstate = 3;
        }

        // Bitis raporu (bir kez): son poll'da yabanci id'ye atlansa bile
        // renderer "sarki bitti" (pstate 0 + son konum) gorur ve ilerler.
        if (forceEnd) {
          pstate = 0;
          cur = this.lastOursDur || (Number(this.fastMeta.duration) || dur);
        }

        // Gecis takildiysa (id henuz onaylanmadi): once sicak tekrar, sonra tam
        // yeniden yukleme ile kendini toparla. Boylece "sure baslamiyor / eski
        // sarkiya donme" durumu 4-9 sn icinde kendiliginden iyilesir.
        if (!this.idConfirmed && this.shouldPlay && !this.fastAudio && this.currentVideoId) {
          const waited = Date.now() - this.lastPlayAt;
          if (waited > 4000 + this.switchRetryCount * 2500 && this.switchRetryCount < 2) {
            this.switchRetryCount += 1;
            console.log(`[AudioEngine] switch retry #${this.switchRetryCount} after ${waited}ms (stateVid=${stateVid || 'none'}, pstate=${pstate}, cur=${cur.toFixed(2)}, dur=${dur.toFixed(2)})`);
            const vidRetry = JSON.stringify(this.currentVideoId);
            this.win?.webContents.executeJavaScript(`(() => {
              try {
                window.__lupin_should_play = true;
                const mp = document.getElementById('movie_player') || window.__hmp;
                if (mp && typeof mp.loadVideoById === 'function') {
                  mp.loadVideoById(${vidRetry});
                  if (typeof mp.playVideo === 'function') mp.playVideo();
                  const v = document.querySelector('video');
                  if (v) { v.playbackRate = 1; v.muted = false; v.play().catch(() => {}); }
                  return true;
                }
              } catch (e) {}
              return false;
            })()`, true).catch(() => {});
          } else if (waited > 9000 && !this.coldReloadDone) {
            this.coldReloadDone = true;
            console.log(`[AudioEngine] cold reload after ${waited}ms (stateVid=${stateVid || 'none'})`);
            const genReload = this.playGen;
            const vidReload = this.currentVideoId;
            this.win?.webContents.loadURL(`${WATCH_URL}${encodeURIComponent(vidReload)}`).then(async () => {
              if (genReload !== this.playGen) return;
              try {
                await this.win?.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
                await this.win?.webContents.executeJavaScript(
                  `window.__lupin_should_play = ${this.shouldPlay ? 'true' : 'false'};`, true
                ).catch(() => {});
              } catch {}
            }).catch(() => {});
          }
        }

        // Duraklatma zorlamasi: kullanici pause ettiyse YT kendi akisini
        // (reklam sonu gecisi, autonav) geri baslatabiliyor. Motor iki onlemle
        // kapatir: (1) medya SESSIZE alinir (pause() aninda bir kez) — boylece
        // YouTube arada ne zaman baslarsa baslasin ses cikmaz; (2) konum
        // GERCEKTEN ilerliyorsa yeniden duraklatilir. Buffering sirasinda
        // (pstate 3, konum ~kilitli) hicbir seye dokunulmaz: her 1 sn'de
        // pauseVideo() atmak sesi "ac-kapa" yapip oynatmaya devam ediyordu.
        if (!this.shouldPlay) {
          const drift = this.pauseAnchor >= 0 ? cur - this.pauseAnchor : 0;
          if (state.vPaused === false && drift > 0.35 && Date.now() - this.lastPauseEnforceAt > 700) {
            this.lastPauseEnforceAt = Date.now();
            this.pauseRealCur = cur;
            console.log(`[AudioEngine] pause enforced at ${new Date().toTimeString().slice(0, 8)}: YT resumed while paused (cur=${cur.toFixed(2)} pstate=${pstate})`);
            // Cok kaydiysa videoyu da geri sar: akis durur, sarki sonuna
            // dogru kayan sessiz bir ilerleme olmaz.
            const rewind = this.pauseAnchor >= 0 && cur - this.pauseAnchor > 5 ? this.pauseAnchor : -1;
            this.win?.webContents.executeJavaScript(`(() => {
              try {
                window.__lupin_should_play = false;
                const mp = document.getElementById('movie_player') || window.__hmp;
                if (mp && typeof mp.pauseVideo === 'function') mp.pauseVideo();
                for (const v of document.querySelectorAll('video, audio')) {
                  try { v.muted = true; v.pause(); } catch {}
                }
                ${rewind >= 0 ? `
                const rv = document.querySelector('video');
                if (rv) { try { rv.currentTime = ${rewind}; } catch {} }` : ''}
              } catch {}
            })()`, true).catch(() => {});
          } else if (state.vPaused !== false && drift < 0.2) {
            this.pauseAnchor = cur;
            this.pauseRealCur = cur;
          }
          // Raporlanan konum DONDURULUR: YouTube sessizce ilerliyorsa bile
          // ilerleme cubugu oynamaz, sarki "bitti" sayilmaz.
          if (this.pauseAnchor >= 0 && cur > this.pauseAnchor) cur = this.pauseAnchor;
        } else {
          this.pauseAnchor = -1;
          this.pauseRealCur = -1;
        }

        // Erken 'ended'/'paused' (playerState 0 veya 2) korumasi:
        // YALNIZCA sarki baslangicinda (ilk 2.5 sn) henuz baslamamis oynatici
        // 'bitti/durakladi' sanilmasin: gecis sayilir, play poke gonderilir.
        // Gercek sarki bittiginde pstate 0 olarak kalmali ki siradakine gecilsin.
        if ((pstate === 0 || pstate === 2) && dur > 10 && cur < 2 && isRecentUserSwitch) {
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
        // duraklatılmışsa (paused === true) ve şarkı henüz bitmediyse, otomatik olarak uyandır
        // (yalnizca gecis onaylanmissa: onaylanmamisken eski video uyandirilabilir)
        if (this.shouldPlay && this.idConfirmed && state.paused && pstate === 2 && dur > 0 && cur < dur - 2) {
          this.win?.webContents.executeJavaScript(`(() => {
            try {
              const mp = document.getElementById('movie_player') || window.__hmp;
              if (mp && typeof mp.playVideo === 'function') mp.playVideo();
              const v = document.querySelector('video');
              if (v && v.paused) v.play().catch(() => {});
            } catch {}
          })()`, true).catch(() => {});
        }

        const isPaused = !this.shouldPlay || (state.paused && pstate === 2) || pstate === 0;
        const isAd = state.isAd === true;
        if ((state.adSignal || '') !== this.lastRawAdSignal) {
          this.lastRawAdSignal = state.adSignal || '';
          if (this.lastRawAdSignal) {
            console.log(`[AudioEngine] ad raw signal: ${this.lastRawAdSignal} (gated isAd=${isAd} cur=${cur.toFixed(2)} dur=${dur.toFixed(2)})`);
          }
        }

        // Reklam savunmasi: art arda dogrulanan reklamda sesi motor seviyesinde kes
        // ve reklami sonuna sar (sarki suresi ne olursa olsun; gercek icerige dokunulmaz
        // cunku yalnizca isAd bayragi kalkmayinca devreye girer).
        if (isAd && this.adblockEnabled && Date.now() - this.lastPlayAt > 3000) {
          // Grace: gecis/ilk-baslangic pencerelerinde (<=3sn) reklam sinyalleri
          // gecici takiliyor; motorun mute/seek'i bu pencerede ASLA dokunmaz.
          if (!this.engineMuted) {
            this.engineMuted = true;
            try { this.win?.webContents.setAudioMuted(true); } catch {}
          }
          const streakKey = state.videoId || this.currentVideoId;
          this.adStreak = (this.adStreakKey === streakKey) ? this.adStreak + 1 : 1;
          this.adStreakKey = streakKey;
          if (this.adStreak === 2) {
            console.log(`[AudioEngine] ad detected: vid=${streakKey} cur=${cur.toFixed(2)} dur=${dur.toFixed(2)} pstate=${pstate} stateVid=${stateVid} signal=${state.adSignal || ''}`);
          }
          // Duraklatilmisken reklami sona sarma: YouTube reklam bitince icerigi
          // kendiliginden baslatip pause flapping uretiyordu.
          if (this.adStreak >= 2 && this.adSeeks < 3 && dur > 0 && this.shouldPlay) {
            this.adSeeks += 1;
            console.log(`[AudioEngine] ad-skip seek #${this.adSeeks} (dur=${dur.toFixed(2)})`);
            this.win?.webContents.executeJavaScript(`(() => {
              try {
                const v = document.querySelector('video');
                // DIKKAT: mp.seekTo YAPILMAZ — reklam slotunda mp API içerik
                // zaman cizelgesine yazar (sarkiyi 20sn'ye geri sariyordu).
                // Reklam kisa surede bitirilir; içerik timeline'ina dokunulmaz.
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

        // DOM'da baska bir video (prewarm/onceki parca) oynarken state.title
        // BAYAT olur; isMatchingTrack false iken asla kullanilmaz — yalnizca
        // fastMeta (gercek baslik) veya placeholder doner. Boylece deep-link'te
        // placeholder guard bir kez yanlis beslenmez, gercek baslik sonrasi
        // poll'da normal bilesir.
        // Gecis sinirinda bayat baslik: vid degistigi halde baslik ayni kalmis
        // ise o, onceki videonun basligidir (prewarm/onceki parcadan sizar).
        // Yeni baslik gorulene kadar kullanilmaz; boylece deep-link placeholder
        // guard'i yanlis degerle bir kez tuketilmez, gercek baslik sonrasi poll'da
        // normal bilesir. 3sn pencere ayni baslikli iki videoyu kilitlemez.
        if (stateVid && stateVid !== this.lastStateVid) {
          if (this.lastStateTitle && state.title && state.title === this.lastStateTitle) {
            this.staleTitleValue = state.title;
            this.staleTitleUntil = Date.now() + 3000;
          }
          this.lastStateVid = stateVid;
        }
        if (state.title && state.title !== this.staleTitleValue) {
          this.staleTitleValue = '';
          this.staleTitleUntil = 0;
        }
        this.lastStateTitle = state.title || '';
        const metaStale = Boolean(
          this.staleTitleValue &&
          Date.now() < this.staleTitleUntil &&
          (state.title === this.staleTitleValue || !state.title)
        );

        const isMatchingTrack = Boolean(state.videoId && state.videoId === effectiveVideoId);
        const resolvedTitle = (isMatchingTrack && !metaStale && state.title && state.title !== 'YouTube Music')
          ? state.title
          : (this.fastMeta.title !== 'Lupin Music' ? this.fastMeta.title : 'Lupin Music');
        const resolvedArtist = (isMatchingTrack && !metaStale && state.artist)
          ? state.artist
          : (this.fastMeta.artist !== 'Lupin Audio' ? this.fastMeta.artist : 'Lupin Audio');
        const resolvedThumbnail = (isMatchingTrack && state.thumbnail)
          ? state.thumbnail
          : (this.fastMeta.thumbnail || (effectiveVideoId ? `https://i.ytimg.com/vi/${effectiveVideoId}/hqdefault.jpg` : undefined));

        this.updateCallback({
          currentTime: cur,
          duration: dur,
          paused: isPaused,
          playerState: pstate,
          videoId: effectiveVideoId,
          title: resolvedTitle,
          artist: resolvedArtist,
          thumbnail: resolvedThumbnail,
          isAd
        });
      } else {
        this.onResolveFail().catch(() => {});
      }
    } catch {
      this.onResolveFail().catch(() => {});
    }
  }

  /** RESOLVE surekli basarisizsa motor uyusmustur: betikleri tazele, gerekirse sifirla. */
  private async onResolveFail(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return;
    this.resolveFailStreak += 1;
    try {
      if (this.resolveFailStreak === 6) {
        // ~2.4sn: betikleri yeniden enjekte et + oynatmayi nazikce uyar
        await this.win.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
        await this.win.webContents.executeJavaScript(`(() => {
          try {
            window.__lupin_should_play = ${this.shouldPlay ? 'true' : 'false'};
            if (window.__lupin_should_play && !window.__lupin_fast_hold) {
              const mp = document.getElementById('movie_player') || window.__hmp;
              if (mp && typeof mp.playVideo === 'function') mp.playVideo();
              const v = document.querySelector('video');
              if (v && v.paused) v.play().catch(() => {});
            }
          } catch {}
        })()`, true).catch(() => {});
      } else if (this.resolveFailStreak === 15 && this.currentVideoId && !this.coldReloadDone) {
        // ~6sn: tam yeniden yukleme ile kendini toparla (gen korumali)
        this.coldReloadDone = true;
        const gen = this.playGen;
        const vid = this.currentVideoId;
        await this.win.webContents.loadURL(`${WATCH_URL}${encodeURIComponent(vid)}`);
        if (gen !== this.playGen) return;
        await this.win.webContents.executeJavaScript(ADBLOCK_INJECTION_JS, true).catch(() => {});
        await this.win.webContents.executeJavaScript(
          `window.__lupin_should_play = ${this.shouldPlay ? 'true' : 'false'};`, true
        ).catch(() => {});
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
