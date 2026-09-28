// Lupin Music — Discord kart proxy'si ("Birlikte Dinle" görsel kartı)
//
// GUVENLIK MODELI (MUST — 2026-09-28 webhook ele gecirme olayi sonrasi):
//  1) Webhook URL'si YALNIZCA sunucu ortam degiskenindedir (LUPIN_WEBHOOK_URL).
//     Istemci, repo, log veya yanit govdesi bu URL'yi ASLA gormez/ilemez.
//  2) Her kart CANLI bir odaya baglanmalidir: relay odanin gercekten acik
//     oldugunu ve karttaki parcayla odadaki parcanin AYNI oldugunu dogrular.
//     Rastgele POST'lar 403 alir — acik uctan spam atilamaz.
//  3) Hiz sinirlari: IP basina 10 dk'da 12, oda basina 10 dk'da 6 gonderim.
//  4) Engelleme listesi: LUPIN_BLOCKED_ROOMS="oda1,oda2" veya hos pesi.
//     Asiri gonderen host 10 dk sessize alinir (bellek + KV'de degil).
'use strict';

const store = require('./_store.js');
const { ROOM_RE, cors, json, sanitizeId, roomGet, isStale } = store;

const WEBHOOK_ENV = 'LUPIN_WEBHOOK_URL';
const MAX_BODY = 6 * 1024 * 1024;   // 6 MB
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_IP = 12;
const RATE_MAX_ROOM = 6;

const ipHits = new Map();
const roomHits = new Map();
const hostMuteUntil = new Map();   // hostId -> timestamp (asiri gonderim)

function limited(map, key, max) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= max) { map.set(key, list); return true; }
  list.push(now);
  map.set(key, list);
  if (map.size > 5000) map.clear();
  return false;
}

function str(v, max) {
  return String(v == null ? '' : v).slice(0, max || 300);
}

function blockedRooms() {
  return String(process.env.LUPIN_BLOCKED_ROOMS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Yalnızca POST' });

  const WEBHOOK = String(process.env[WEBHOOK_ENV] || '').trim();
  if (!WEBHOOK.startsWith('https://') && !WEBHOOK.startsWith('http://')) {
    return json(res, 503, { error: 'Kart sunucusu yapılandırılmamış (LUPIN_WEBHOOK_URL)' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'local';
  if (limited(ipHits, ip, RATE_MAX_IP)) return json(res, 429, { error: 'Çok sık gönderim, lütfen bekleyin' });

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

  // ---- 1) Canli oda zorunlulugu: kart hangi odaya ait? ----
  const room = String(body.room || '').toLowerCase();
  const trackId = sanitizeId(body.trackId || '');
  if (!ROOM_RE.test(room)) {
    return json(res, 403, { error: 'Canlı parti odası gerekli (room eksik)' });
  }
  if (blockedRooms().includes(room)) {
    return json(res, 403, { error: 'Bu oda engellendi' });
  }
  if (limited(roomHits, room, RATE_MAX_ROOM)) {
    return json(res, 429, { error: 'Bu oda çok sık kart gönderiyor' });
  }

  let state = null;
  try { state = await roomGet(room); } catch (e) {
    return json(res, 503, { error: 'Oda okunamadı, sonra tekrar dene' });
  }
  if (!state || isStale(state) || !state.track || !state.track.id) {
    return json(res, 403, { error: 'Oda kapalı veya parça yok — önce birlikte dinlemeyi başlat' });
  }
  if (trackId && state.track.id !== trackId) {
    return json(res, 403, { error: 'Karttaki parça odadaki parça ile eşleşmiyor' });
  }

  // Asiri gonderen host'u sessize al
  const hostId = String(state.hostId || '');
  const muteUntil = hostMuteUntil.get(hostId) || 0;
  if (hostId && Date.now() < muteUntil) {
    return json(res, 403, { error: 'Bu yayıncı geçici olarak sessize alındı' });
  }

  const b64 = String(body.imageBase64 || '');
  if (!b64) return json(res, 400, { error: 'Kart görseli yok' });
  let png;
  try { png = Buffer.from(b64, 'base64'); } catch { return json(res, 400, { error: 'Görsel çözülemedi' }); }
  if (!png.length || png.length > 5 * 1024 * 1024) return json(res, 413, { error: 'Görsel boyutu uygun değil' });

  // PNG imzasi dogrulamasi: base64 sarilmis metin degil gercek resim olmali
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(PNG_SIG)) {
    return json(res, 400, { error: 'Görsel PNG değil' });
  }

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
    if (upstream.ok || upstream.status === 204) {
      // Basarili gonderimde host sayaci: spam yapan otomatik sessize alinir
      if (hostId) {
        const key = `card:${hostId}`;
        const nowList = (roomHits.get(key) || []).filter((t) => Date.now() - t < RATE_WINDOW_MS);
        nowList.push(Date.now());
        roomHits.set(key, nowList);
        if (nowList.length > RATE_MAX_ROOM * 2) {
          hostMuteUntil.set(hostId, Date.now() + RATE_WINDOW_MS);
        }
      }
      return json(res, 200, { success: true });
    }
    const text = await upstream.text().catch(() => '');
    // 404/410 = webhook silinmis/uzerinden cekilmis -> bunu AÇIKCA bildir ki
    // uygulama sahibi fark edip yeni webhook kursun
    if (upstream.status === 404 || upstream.status === 410) {
      return json(res, 502, { error: 'Discord webhook geçersiz (silinmiş olabilir)', code: 'webhook_invalid' });
    }
    return json(res, 502, { error: `Discord ${upstream.status}`, detail: text.slice(0, 200) });
  } catch (e) {
    return json(res, 502, { error: 'Discord webhook gönderimi başarısız', detail: String(e && e.message) });
  }
};
