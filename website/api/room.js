// Lupin Music - Birlikte Dinle oda (party room) relay'i
// Depo katmani website/api/_store.js icindedir (card.js ile ortak).
"use strict";

const store = require("./_store.js");
const { ROOM_RE, MAX_QUEUE, cors, json, sanitizeText, sanitizeId, sanitizeTrack, roomGet, roomSet, isStale, publicView } = store;
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
    // Hicbir depo erisilemiyorsa oda sessizce calisir (katilimci yine de
    // deep link ile konuma oturur) — 503 yerine bos oda dondur.
    console.warn('[Room] store okunamadi:', e && e.message);
    state = null;
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
