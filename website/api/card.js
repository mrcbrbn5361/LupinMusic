// Lupin Music — Discord kart proxy'si ("Birlikte Dinle" görsel kartı)
// Webhook URL'si SUNUCUDA kalır; kullanıcılar hiçbir yere URL girmaz.
// Relay, uygulamadan gelen PNG + payload_json'ı Discord webhook'una iletir.
// Limitler: gövde <= 6 MB, IP basina kisa sureli hiz siniri.
'use strict';

const WEBHOOK_ENV = 'LUPIN_WEBHOOK_URL';
const MAX_BODY = 6 * 1024 * 1024;   // 6 MB
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 12;                 // 10 dakikada IP basina gonderim

const hits = new Map();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, body) {
  cors(res);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function str(v, max) {
  return String(v == null ? '' : v).slice(0, max || 300);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Yalnızca POST' });

  // Ortam degiskeni istege gore okunur (test/sicak baslangic dostu)
  const WEBHOOK = String(process.env[WEBHOOK_ENV] || '').trim();
  if (!WEBHOOK.startsWith('https://') && !WEBHOOK.startsWith('http://')) {
    return json(res, 503, { error: 'Kart sunucusu yapılandırılmamış (LUPIN_WEBHOOK_URL)' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'local';
  if (rateLimited(ip)) return json(res, 429, { error: 'Çok sık gönderim, lütfen bekleyin' });

  let raw = '';
  let tooBig = false;
  await new Promise((resolve) => {
    req.on('data', (c) => {
      if (tooBig) return;
      raw += c;
      if (raw.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on('close', resolve);
    req.on('end', resolve);
  });
  if (tooBig) return json(res, 413, { error: 'Kart görseli çok büyük' });

  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'Geçersiz JSON' }); }

  const b64 = String(body.imageBase64 || '');
  if (!b64) return json(res, 400, { error: 'Kart görseli yok' });
  let png;
  try { png = Buffer.from(b64, 'base64'); } catch { return json(res, 400, { error: 'Görsel çözülemedi' }); }
  if (!png.length || png.length > 5 * 1024 * 1024) return json(res, 413, { error: 'Görsel boyutu uygun değil' });

  const payload = {
    username: str(body.username, 80) || 'Lupin Music • Birlikte Dinle',
    avatar_url: str(body.avatarUrl, 300) || 'https://raw.githubusercontent.com/mrcbrbn5361/LupinMusic/main/desktop/assets/icon.png'
  };
  if (body.content) payload.content = str(body.content, 1000);
  if (Array.isArray(body.components)) payload.components = body.components.slice(0, 3);

  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), 'lupin-now-playing.png');

  try {
    const upstream = await fetch(WEBHOOK, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
    if (upstream.ok || upstream.status === 204) return json(res, 200, { success: true });
    const text = await upstream.text().catch(() => '');
    return json(res, 502, { error: `Discord ${upstream.status}`, detail: text.slice(0, 200) });
  } catch (e) {
    return json(res, 502, { error: 'Discord webhook gönderimi başarısız', detail: String(e && e.message) });
  }
};
