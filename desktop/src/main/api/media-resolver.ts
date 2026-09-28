// Hizli baslatma: dogrudan ses akisi durum sorgusu (fast-path <audio> elementi)
export const FAST_POLL_JS = `(() => {
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
export const RESOLVE_MEDIA_JS = `(() => {
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
        // YouTube player API'si arada cansizlasir: pstate=-1 verirken
        // getCurrentTime() DONUMSAL bir deger dondurur, oysa <video> gercekten
        // oynuyor. Bu durumda <video> dogrusu esas alinir (yoksa ilerleme
        // cubugu / parti konumu hep eski kalir).
        if (pstate === -1 && v.currentTime && !isNaN(v.currentTime)) {
          cur = v.currentTime;
        }
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
      const isAd0 = rawAd && vdur > 0 && vdur < 120;
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
      const vid = apiVid;

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
              const afterParts = afterDash.split(/\\s*[|,\u2022\u00B7]\\s*/);
              title = beforeDash;
              if (!artist) artist = afterParts[0] || '';
            } else {
              const parts = cleaned.split(/\s*[|•·]\s*/).filter(Boolean);
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
              const parts = t.split(/[\u2022\u00B7]/).map((s) => s.trim());
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
        isAd: isAd0,
        adSignal: rawAd ? (adSignal + '|vdur=' + vdur) : '',
        adState: (() => { try { return typeof mp.getAdState === 'function' ? mp.getAdState() : -1; } catch (e) { return -1; } })(),
        adOverlay: (() => {
          try {
            const ov = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-image-overlay, .ytp-ad-text');
            return !!(ov && ov.offsetParent !== null);
          } catch (e) { return false; }
        })(),
        adDuration: vdur,
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
