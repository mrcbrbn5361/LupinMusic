// Lupin Music — /party SSR sayfasi (Vercel serverless, zero-dep)
// Discord acilimi (unfurl) icin og meta sunucuda uretilir; kutuphane yoktur.
'use strict';

const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtPos(sec) {
  const s = Math.max(0, Math.floor(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(r).padStart(2, '0')}`;
}

function page(title, artist, thumb, id, t, errorMsg, room, listeners) {
  const posLabel = t > 0 ? `⏳ Konum: <b>${esc(fmtPos(t))}</b>` : '⏳ Baştan başla';
  // Oda kodu varsa gercek senkron: uygulama host'a baglanir, parca degisince
  // katilimcilar da degisir. Yoksa tek parca + konum (eski davranis).
  const deepLink = room
    ? `lupin://party?room=${encodeURIComponent(room)}${id ? `&id=${encodeURIComponent(id)}&t=${t}` : ''}`
    : `lupin://party?id=${encodeURIComponent(id)}&t=${t}`;
  const ogTitle = `🎧 ${title} — Lupin Music'te Katıl`;
  const ogDesc = artist
    ? `Birlikte Dinle Partisi: ${artist} • Lupin Music'te${t > 0 ? ` konum ${fmtPos(t)}` : ''}`
    : 'Lupin Music Birlikte Dinle Partisi';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} — Lupin Music Birlikte Dinleme Partisi</title>
  <meta name="description" content="${esc(ogDesc)}" />
  <meta name="theme-color" content="#090214" />
  <meta property="og:type" content="music.song" />
  <meta property="og:site_name" content="Lupin Music" />
  <meta property="og:title" content="${esc(ogTitle)}" />
  <meta property="og:description" content="${esc(ogDesc)}" />
  <meta property="og:image" content="${esc(thumb)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(ogTitle)}" />
  <meta name="twitter:description" content="${esc(ogDesc)}" />
  <meta name="twitter:image" content="${esc(thumb)}" />
  <link rel="icon" type="image/png" href="/logo.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
  <style>
    :root { --bg:#090214; --card:#130626; --surface:#1b0a33; --accent:#ec4899; --accent-3:#d946ef; --glow:#8b5cf6; --glow-2:#a855f7; --glow-3:#7c3aed; --text:#fff; --body:#d8b4fe; --muted:#9333ea; --line:rgba(236,72,153,.18); --line-soft:rgba(168,85,247,.14); }
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      min-height:100vh; background:var(--bg); color:var(--body); font-family:"Inter","Segoe UI",system-ui,sans-serif;
      display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px 22px;
      -webkit-font-smoothing:antialiased;
    }
    body::before { content:""; position:fixed; inset:0; z-index:-1;
      background:
        radial-gradient(760px 460px at 78% -10%, rgba(139,92,246,.18), transparent 62%),
        radial-gradient(700px 440px at 8% 100%, rgba(236,72,153,.12), transparent 60%); }
    .brand { display:flex; align-items:center; gap:10px; font-family:"Space Grotesk",sans-serif; font-weight:700; color:var(--text); font-size:17px; margin-bottom:30px; }
    .brand img { width:34px; height:34px; border-radius:9px; box-shadow:0 0 18px rgba(236,72,153,.35); }
    .card {
      width:min(560px,100%); padding:34px 32px; border-radius:24px; text-align:center;
      background:linear-gradient(165deg, rgba(27,10,51,.8), rgba(15,4,30,.92));
      border:1px solid rgba(236,72,153,.3); box-shadow:0 34px 80px rgba(0,0,0,.6), 0 0 70px rgba(139,92,246,.14);
    }
    .badge { display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
      color:var(--accent); background:rgba(236,72,153,.1); border:1px solid var(--line); border-radius:999px; padding:8px 18px; margin-bottom:24px; }
    .thumb { width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:16px; border:1px solid var(--line-soft);
      box-shadow:0 18px 44px rgba(0,0,0,.5); background:var(--surface); }
    h1 { font-family:"Space Grotesk",sans-serif; color:var(--text); font-size:clamp(21px,4vw,26px); line-height:1.2; margin:22px 0 6px; letter-spacing:-.02em; }
    .artist { color:var(--muted); font-style:italic; font-size:15.5px; }
    .pos { display:inline-flex; gap:8px; align-items:center; margin-top:18px; font-family:"JetBrains Mono","Cascadia Code",monospace;
      font-size:14px; color:var(--body); background:rgba(9,2,20,.7); border:1px solid var(--line-soft); border-radius:10px; padding:9px 16px; }
    .pos b { color:var(--accent-3); font-weight:600; }
    .actions { display:grid; gap:12px; margin-top:26px; }
    .btn { display:flex; align-items:center; justify-content:center; gap:10px; padding:16px 26px; border-radius:14px; font-weight:600; font-size:16px;
      text-decoration:none; transition:transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease; }
    .btn:active { transform:translateY(1px) scale(.99); }
    .btn-primary { background:linear-gradient(135deg,#ec4899 0%,#d946ef 55%,#7c3aed 100%); color:#fff;
      box-shadow:0 8px 28px rgba(236,72,153,.3), inset 0 1px 0 rgba(255,255,255,.22); cursor:pointer; border:none; font-family:inherit; }
    .btn-primary:hover { box-shadow:0 10px 34px rgba(236,72,153,.45); transform:translateY(-2px); }
    .btn-ghost { background:rgba(27,10,51,.55); border:1px solid var(--line-soft); color:var(--text); }
    .btn-ghost:hover { border-color:rgba(168,85,247,.45); box-shadow:0 0 24px rgba(168,85,247,.28); transform:translateY(-2px); }
    .hint { margin-top:18px; font-size:13.5px; color:var(--muted); background:rgba(236,72,153,.06);
      border:1px dashed rgba(236,72,153,.35); border-radius:12px; padding:14px 16px; text-align:left; display:none; }
    .hint.show { display:block; animation:up 320ms ease; }
    .hint b { color:var(--text); }
    @keyframes up { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:none;} }
    .foot { margin-top:24px; font-size:12.5px; color:rgba(147,51,234,.8); text-align:center; }
    .err .thumb { display:none; }
  </style>
</head>
<body>
  <a class="brand" href="/"><img src="/logo.png" alt="" /> Lupin Music</a>
  <main class="card${errorMsg ? ' err' : ''}">
    <span class="badge">🎧 Birlikte Dinleme Partisi</span>
    ${errorMsg
      ? `<h1>${esc(errorMsg)}</h1>
    <p class="artist">Davet linkinde şarkı kimliği bulunamadı.</p>
    <div class="actions"><a class="btn btn-ghost" href="/">Lupin Music'e Dön</a></div>`
      : `<img class="thumb" src="${esc(thumb)}" alt="" />
    <h1>${esc(title)}</h1>
    <p class="artist">${esc(artist || 'Lupin Music')}</p>
    <div class="pos">${posLabel}</div>
    ${listeners > 0 ? `<div class="pos">👥 Şu anda <b>${esc(String(listeners))} kişi</b> birlikte dinliyor</div>` : ''}
    <div class="actions">
      <button class="btn btn-primary" id="join" type="button">${room ? '✨ Birlikte Dinle' : "✨ Lupin Music'te Katıl"}</button>
      <a class="btn btn-ghost" href="https://github.com/mrcbrbn5361/LupinMusic/releases" target="_blank" rel="noopener">🚀 Uygulamayı İndir</a>
    </div>
    <div class="hint" id="hint">
      ${room
        ? `<b>Bu bir birlikte dinleme odası.</b><br />
           Katılınca sunucunun oynattığı şarkıyı <b>o anki konumdan</b> duyacaksın; şarkı değişince sen de değişeceksin.
           Kendi listeni seçersen partiden ayrılırsın.`
        : `<b>Uygulama açılmadı mı?</b><br />
           Tarayıcı <b>"Masaüstünde aç"</b> / <b>"Lupin Music'i aç"</b> diye sorarsa izin ver.
           Henüz yüklü değilse uygulamayı indirip tekrar bu linki aç — kaldığın saniyeden devam eder.`}
    </div>`}
  </main>
  <p class="foot">© 2026 Lupin Music • MIT • Windows &amp; macOS</p>
  <script>
    (function () {
      var btn = document.getElementById('join');
      if (!btn) return;
      var opened = false;
      window.addEventListener('blur', function () { opened = true; });
      btn.addEventListener('click', function () {
        try { window.location.href = ${JSON.stringify(deepLink)}; } catch (e) {}
        setTimeout(function () {
          if (!opened && !document.hidden) {
            var h = document.getElementById('hint');
            if (h) h.classList.add('show');
          }
        }, 1600);
      });
    })();
  </script>
</body>
</html>`;
}

async function fetchMeta(id) {
  const fallback = {
    title: 'Lupin Music Partisi',
    artist: 'Lupin Music',
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 2500);
    const watchUrl = `https://www.youtube.com/watch?v=${id}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { signal: ctrl.signal, headers: { 'User-Agent': 'LupinMusic/1.0' } }
    );
    clearTimeout(timer);
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      title: data.title || fallback.title,
      artist: data.author_name || fallback.artist,
      thumb: (data.thumbnail_url || fallback.thumb).replace('http://', 'https://')
    };
  } catch (e) {
    return fallback;
  }
}

module.exports = async function handler(req, res) {
  const q = (req && req.query) || {};
  let id = String(q.id || q.v || '');
  let t = parseInt(q.t, 10);
  if (!Number.isFinite(t) || t < 0) t = 0;
  if (t > 86400) t = 0;
  // Birlikte Dinle odasi (host tarafindan uretilir)
  const room = String(q.room || '').toLowerCase();
  const roomOk = /^[a-z0-9]{6,20}$/.test(room) ? room : '';

  // Oda odasi: parca bilgisi relay'den gelir (linkte id yoksa da calisir)
  let live = null;
  if (roomOk) {
    try {
      const r = await fetch(`https://lupinmusic.vercel.app/api/room?room=${roomOk}&clientId=web&action=state`, {
        signal: AbortSignal.timeout(4000)
      });
      if (r.ok) live = await r.json();
    } catch (e) {}
    if (live && live.track && !id) {
      id = String(live.track.id || '');
      t = Math.max(0, Math.floor(Number(live.position) || 0));
    }
  }

  const valid = ID_RE.test(id) || (roomOk && live && live.track);
  const meta = valid && ID_RE.test(id) ? await fetchMeta(id) : null;
  const html = page(
    valid ? ((meta && meta.title) || (live && live.track && live.track.title) || 'Birlikte dinleme') : 'Parti bulunamadı',
    valid ? ((meta && meta.artist) || (live && live.track && live.track.artist) || '') : '',
    valid ? ((meta && meta.thumb) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`) : '',
    valid ? id : '',
    valid ? t : 0,
    valid ? null : 'Bu davet linki eksik görünüyor',
    roomOk,
    roomOk && live && !live.closed ? (live.listeners || 0) : 0
  );

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
  return res.end(html);
};
