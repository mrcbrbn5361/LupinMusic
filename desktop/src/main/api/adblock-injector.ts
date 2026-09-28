// Reklam ve reklam-olcum alan adlarini ag seviyesinde blokla
// (YouTube cekirdek butunluk, video icerik ve oynatici uclari haric)
export const AD_BLOCK_PATTERNS = [
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

export const ADHIDE_CSS = `
  /* Reklam katmanlari: oynatici uzeri, panel, dilim ve cerceveler gizlenir.
     Sansur/reklam gosterge (badge) JS ile de kaldirilir. */
  .ytp-ad-player-overlay,
  .ytp-ad-text,
  .ytp-ad-preview-container,
  .ytp-ad-skip-button-container,
  .ytp-ad-message-container,
  .ytp-ad-image-overlay,
  .ytp-ad-overlay-container,
  .ytp-ad-overlay-slot,
  .ytp-ad-module,
  .ytp-ad-badge,
  .ytp-ad-overlay-close-button,
  .ytp-ad-overlay-close-button-ad,
  .ytp-ad-overlay-close-button-ad-container,
  .video-ads,
  .ytp-ad-visible,
  #player-ads,
  #masthead-ad,
  #panels-full-bleed-container > .ytd-ads-player,
  ytd-ad-slot-renderer,
  .ytd-ad-slot-renderer,
  ytd-display-ad-renderer,
  ytd-promoted-sparkles-web-renderer,
  ytd-in-feed-ad-layout-renderer,
  ytd-action-companion-ad-renderer,
  ytd-engagement-panel-section-list-renderer[target-id*="ads"],
  ytmusic-mealbar-promo-renderer,
  ytmusic-upsell-dialog-renderer,
  .mealbar-promo-renderer,
  ytmusic-statement-banner-renderer,
  .ytmusic-inline-ad-renderer,
  .ytmusic-promoted-item-renderer,
  ytmusic-player-bar-ad-renderer,
  .ytd-consent-bump-v2-lightbox,
  ytmusic-consent-bump-v2-renderer {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    opacity: 0 !important;
  }
  /* Oynatici cercevesini kaplayan reklam katmanlari */
  .html5-video-player.ad-showing .ytp-chrome-bottom,
  .html5-video-player.ad-showing .ytp-pause-overlay,
  .html5-video-player.ad-showing .ytp-gradient-bottom,
  .html5-video-player.ad-showing .ytp-gradient-top {
    display: none !important;
  }
`;

// Reklamsız oynatma, onay ekranları ve arka plan görünürlük koruma betiği
export const ADBLOCK_INJECTION_JS = `(() => {
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

        // YIKICI ISLEM (mute/16x/sona sarma) yalnizca ASIL reklam belirteci
        // varsa: getAdState()===1 veya gorunur overlay. Sadece takilmis
        // 'ad-showing' sinifi 120sn'den kisa gercek parcalari sona sardi.
        let adAuthoritative = false;
        try { if (typeof mp.getAdState === 'function' && mp.getAdState() === 1) adAuthoritative = true; } catch {}
        if (!adAuthoritative) {
          try {
            const ov = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-image-overlay, .ytp-ad-text');
            if (ov && ov.offsetParent !== null) adAuthoritative = true;
          } catch {}
        }

        // Duraklatilmis icerige asla dokunma: seek/speed degisimi "sarki bitti"
        // sinyali uretip kendiliginden sira ilerlemesine yol acmasin.
        // SURE KORUMASI: sarki basindaki gecici ad-sinyali uzun icerigi sessize
        // almasin/sona sarmasIN — mute dahil her sey yalnizca KISA (<120sn) videoda.
        if (v && adAuthoritative && !v.paused && !v.ended) {
          const vd2 = v.duration;
          if (vd2 && !isNaN(vd2) && vd2 > 0 && vd2 < 120) {
            v.muted = true;
            v.playbackRate = 16;
            v.currentTime = vd2;
          }
        }
      } catch {}
    };

    // 3b. Reklam DOM'unu surekli temizle: gosterge/panel/overlay eklenirse silinir
    // (CSS tek sefer uygulandigi icin YouTube'un sonradan ekledigi dugumler kalir).
    const hideAdDom = () => {
      try {
        const sels = [
          '.ytp-ad-badge', '.ytp-ad-overlay-slot', '.ytp-ad-module',
          '.ytp-ad-preview-container', '.ytp-ad-skip-button-container',
          '.ytp-ad-message-container', '.ytp-ad-overlay-close-button',
          '#player-ads', '#masthead-ad', '.video-ads',
          'ytd-ad-slot-renderer', '.ytd-ad-slot-renderer',
          'ytd-display-ad-renderer', 'ytd-in-feed-ad-layout-renderer',
          'ytmusic-statement-banner-renderer', 'ytmusic-mealbar-promo-renderer'
        ];
        for (const sel of sels) {
          for (const el of document.querySelectorAll(sel)) {
            try { el.remove(); } catch {}
          }
        }
      } catch {}
    };

    // 4. Periyodik denetim ve yetkisiz duraklatmayı otomatik devam ettirme (Keep-alive)
    // Hizli-ses koprusu aktifken (fast_hold) YT videosuna dokunma: cift ses olmasin
    setInterval(() => {
      dismissDialogs();
      skipAds();
      hideAdDom();
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
export const DISABLE_AUTOPLAY_JS = `(() => {
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
