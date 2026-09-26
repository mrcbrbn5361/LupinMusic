// Lupin Music — Birlikte Dinle oda (party room) relay'i
// Zero-dep Vercel serverless. Oda durumu Upstash/Redis REST ile tutulur;
// KV yoksa gelistirme icin bellek yedegi kullanilir (sunucu yeniden
// baslayinca odalar silinir — uretim icin KV zorunludur).
'use strict';

const ROOM_TTL_SEC = 60 * 60 * 6;      // 6 saat
const ROOM_RE = /^[a-z0-9]{6,20}$/i;
const MAX_MEMBERS = 50;
const MAX_QUEUE = 20;

const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

// Bellek yedegi (KV yoksa)
const memory = new Map();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, body) {
  cors(res);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sanitizeText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 140);
}

function sanitizeId(v) {
  return String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

function sanitizeTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const id = sanitizeId(t.id);
  if (!id) return null;
  return {
    id,
    title: sanitizeText(t.title, 120) || 'Lupin Music',
    artist: sanitizeText(t.artist, 120) || 'Lupin Audio',
    duration: Math.max(0, Math.min(60 * 60 * 12, Math.floor(Number(t.duration) || 0)))
  };
}

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`kv get ${res.status}`);
  const data = await res.json();
  return data && data.result ? JSON.parse(data.result) : null;
}

async function kvSet(key, value, ttl) {
  if (!KV_URL || !KV_TOKEN) return false;
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', ttl]),
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`kv set ${res.status}`);
  return true;
}

async function roomGet(room) {
  if (KV_URL && KV_TOKEN) return kvGet(`lupin:party:${room}`);
  const hit = memory.get(room);
  if (!hit) return null;
  if (Date.now() > hit.expires) { memory.delete(room); return null; }
  return hit.value;
}

async function roomSet(room, value) {
  if (KV_URL && KV_TOKEN) return kvSet(`lupin:party:${room}`, value, ROOM_TTL_SEC);
  memory.set(room, { value, expires: Date.now() + ROOM_TTL_SEC * 1000 });
  return true;
}

/** Oda yoksayildi mi? (host 45 sn uzeri guncellemediyse) */
function isStale(room) {
  return !room || !room.updatedAt || Date.now() - room.updatedAt > 45000;
}

function publicView(room, clientId) {
  return {
    room: room.room,
    hostId: room.hostId,
    hostName: room.hostName || 'Lupin',
    track: room.track || null,
    position: Number(room.position) || 0,
    playing: room.playing !== false,
    queue: Array.isArray(room.queue) ? room.queue.slice(0, MAX_QUEUE) : [],
    members: Object.entries(room.members || {}).map(([id, m]) => ({
      id,
      name: (m && m.name) || 'Katılımcı',
      joinedAt: (m && m.joinedAt) || 0
    })).slice(0, MAX_MEMBERS),
    listeners: Object.keys(room.members || {}).length,
    updatedAt: room.updatedAt || 0,
    youAreHost: clientId ? clientId === room.hostId : false,
    closed: isStale(room)
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; return res.end(); }

  const url = new URL(req.url, 'https://relay.local');
  const body = req.method === 'POST'
    ? await new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 200000) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
      })
    : {};

  const action = String(body.action || url.searchParams.get('action') || 'state');
  const room = String(body.room || url.searchParams.get('room') || '').toLowerCase();
  const clientId = sanitizeId(body.clientId || url.searchParams.get('clientId') || '');

  if (!ROOM_RE.test(room)) return json(res, 400, { error: 'Geçersiz oda kodu' });
  if (!clientId) return json(res, 400, { error: 'Eksik istemci kimliği' });

  const now = Date.now();
  let state = null;
  try {
    state = await roomGet(room);
  } catch (e) {
    return json(res, 503, { error: 'Oda deposu erişilemiyor', detail: String(e && e.message) });
  }

  if (action === 'host') {
    const track = sanitizeTrack(body.track);
    if (!track) return json(res, 400, { error: 'Geçersiz parça' });
    const queue = (Array.isArray(body.queue) ? body.queue : [])
      .map(sanitizeTrack)
      .filter(Boolean)
      .slice(0, MAX_QUEUE);

    // Yeni host yalnizca oda bosken veya ayni istemciyse devralabilir
    if (state && !isStale(state) && state.hostId && state.hostId !== clientId) {
      return json(res, 409, { error: 'Oda başka biri tarafından yönetiliyor', state: publicView(state, clientId) });
    }
    const members = (state && state.members) || {};
    members[clientId] = { name: sanitizeText(body.name, 40) || 'Host', joinedAt: (members[clientId] && members[clientId].joinedAt) || now };
    state = {
      room,
      hostId: clientId,
      hostName: sanitizeText(body.name, 40) || 'Host',
      track,
      position: Math.max(0, Math.min(track.duration || 1e9, Number(body.position) || 0)),
      playing: body.playing !== false,
      queue,
      members,
      updatedAt: now
    };
    await roomSet(room, state);
    return json(res, 200, publicView(state, clientId));
  }

  if (action === 'join') {
    if (!state || isStale(state)) {
      return json(res, 404, { error: 'Oda bulunamadı veya süresi doldu', closed: true });
    }
    const members = state.members || (state.members = {});
    members[clientId] = { name: sanitizeText(body.name, 40) || 'Katılımcı', joinedAt: now };
    state.updatedAt = now;
    await roomSet(room, state);
    return json(res, 200, publicView(state, clientId));
  }

  if (action === 'leave') {
    if (state) {
      const members = state.members || {};
      delete members[clientId];
      if (state.hostId === clientId) {
        // Host ayrildi: oda hemen kapanir (katilimcilar cikip gitsin)
        await roomSet(room, { ...state, members: {}, updatedAt: 0 });
        return json(res, 200, { left: true, closed: true, room });
      }
      state.members = members;
      state.updatedAt = now;
      await roomSet(room, state);
    }
    return json(res, 200, { left: true, closed: false, room });
  }

  // action === 'state'
  if (!state || isStale(state)) {
    return json(res, 200, {
      room,
      closed: true,
      track: null,
      playing: false,
      position: 0,
      queue: [],
      members: [],
      listeners: 0,
      updatedAt: 0,
      youAreHost: false
    });
  }
  return json(res, 200, publicView(state, clientId));
};
