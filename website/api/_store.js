// Lupin Music — relay ortak depo katmani (room.js + card.js birlikte kullanir).
// URETIM NOTU (MUST): Webhook/token/sir hicbir zaman istemciye INMEZ ve
// repoya/historia/log'a YAZILMAZ. Tek sir `LUPIN_WEBHOOK_URL` ve o da yalnizca
// sunucu ortam degiskenindedir (card.js okur, asla disari vermez).
'use strict';

const ROOM_TTL_SEC = 60 * 60 * 6;
const ROOM_RE = /^[a-z0-9]{6,20}$/i;
const MAX_MEMBERS = 50;
const MAX_QUEUE = 20;

const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const BUS = (process.env.LUPIN_PARTY_BUS === undefined ? 'https://ntfy.sh' : String(process.env.LUPIN_PARTY_BUS)).replace(/\/$/, '');
const BUS_TOPIC_PREFIX = process.env.LUPIN_PARTY_TOPIC_PREFIX || 'lupin-room-';
const BUS_WINDOW = '2m';

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

async function busGet(room) {
  if (!BUS) return null;
  const res = await fetch(`${BUS}/${BUS_TOPIC_PREFIX}${room}/json?poll=1&since=${BUS_WINDOW}&limit=60`, {
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`bus get ${res.status}`);
  const text = await res.text();
  if (!text || !text.trim()) return null;
  let list = null;
  try { list = JSON.parse(text); } catch { return null; }
  const items = Array.isArray(list) ? list : (list ? [list] : []);
  if (!items.length) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i];
    if (m.event && m.event !== 'message') continue;
    try {
      const parsed = JSON.parse(m.message || '');
      if (parsed && parsed.room === room) return parsed;
    } catch {}
  }
  return null;
}

async function busSet(room, value) {
  if (!BUS) return false;
  const res = await fetch(`${BUS}/${BUS_TOPIC_PREFIX}${room}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`bus set ${res.status}`);
  return true;
}

async function roomGet(room) {
  if (KV_URL && KV_TOKEN) {
    try { return await kvGet(`lupin:party:${room}`); } catch { /* bus'a dus */ }
  }
  if (BUS) {
    try {
      let v = null;
      for (const wait of [0, 600, 1500]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        v = await busGet(room);
        if (v) break;
      }
      return v;
    } catch { /* bellege dus */ }
  }
  const hit = memory.get(room);
  if (!hit) return null;
  if (Date.now() > hit.expires) { memory.delete(room); return null; }
  return hit.value;
}

async function roomSet(room, value) {
  if (KV_URL && KV_TOKEN) {
    try { return await kvSet(`lupin:party:${room}`, value, ROOM_TTL_SEC); } catch { /* bus'a dus */ }
  }
  if (BUS) {
    try { return await busSet(room, value); } catch { /* bellege dus */ }
  }
  memory.set(room, { value, expires: Date.now() + ROOM_TTL_SEC * 1000 });
  return true;
}

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

module.exports = {
  ROOM_TTL_SEC, ROOM_RE, MAX_MEMBERS, MAX_QUEUE,
  cors, json, sanitizeText, sanitizeId, sanitizeTrack,
  roomGet, roomSet, isStale, publicView
};
