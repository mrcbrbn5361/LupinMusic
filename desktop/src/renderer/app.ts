import { renderNowPlayingCard } from './playerCard';

// Declare window.api type from preload
declare global {
  interface Window {
    api: any;
  }
}

export {};

interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  duration?: number;
  durationFormatted?: string;
  /** Kuyruk kaynagi: kullanicinin sectigi parca mi, radyo ile eklenen mi */
  source?: 'pick' | 'radio';
}

// State
let currentQueue: Track[] = [];
let currentIndex: number = -1;
let currentTrack: Track | null = null;
let isPlaying: boolean = false;
let isShuffled: boolean = false;
let repeatMode: 'off' | 'all' | 'one' = 'off';
let likedTrackIds = new Set<string>();
let prevVolume: number = 0.8;
let currentDuration: number = 0;
let currentTime: number = 0;

// DOM Elements
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const cardsGrid = document.getElementById('cardsGrid') as HTMLDivElement;
const viewTitle = document.getElementById('viewTitle') as HTMLHeadingElement;
const navItems = document.querySelectorAll('.nav-item');
const toastContainer = document.getElementById('toastContainer') as HTMLDivElement;
const queueDrawer = document.getElementById('queueDrawer') as HTMLElement;
const queueList = document.getElementById('queueList') as HTMLElement;
const btnToggleQueue = document.getElementById('btnToggleQueue') as HTMLButtonElement;
const btnCloseQueue = document.getElementById('btnCloseQueue') as HTMLButtonElement;

// Player Bar Elements
const playerThumb = document.getElementById('playerThumb') as HTMLImageElement;
const playerTitle = document.getElementById('playerTitle') as HTMLElement;
const playerArtist = document.getElementById('playerArtist') as HTMLElement;
const btnLike = document.getElementById('btnLike') as HTMLButtonElement;
const btnPlayPause = document.getElementById('btnPlayPause') as HTMLButtonElement;
const playIcon = document.getElementById('playIcon') as HTMLElement;
const pauseIcon = document.getElementById('pauseIcon') as HTMLElement;
const btnPrev = document.getElementById('btnPrev') as HTMLButtonElement;
const btnNext = document.getElementById('btnNext') as HTMLButtonElement;
const btnShuffle = document.getElementById('btnShuffle') as HTMLButtonElement;
const btnRepeat = document.getElementById('btnRepeat') as HTMLButtonElement;
const progressBar = document.getElementById('progressBar') as HTMLElement;
const progressFill = document.getElementById('progressFill') as HTMLElement;
const currentTimeLabel = document.getElementById('currentTimeLabel') as HTMLElement;
const durationLabel = document.getElementById('durationLabel') as HTMLElement;
const volumeSlider = document.getElementById('volumeSlider') as HTMLInputElement;
const btnMute = document.getElementById('btnMute') as HTMLButtonElement;
const volumeIcon = document.getElementById('volumeIcon') as HTMLElement;
const equalizer = document.getElementById('equalizer') as HTMLElement;

// Window Controls
const titlebar = document.getElementById('titlebar');
const btnMin = document.getElementById('btnMin');
const btnMax = document.getElementById('btnMax');
const btnClose = document.getElementById('btnClose');

// Settings Modal Elements
const settingsModal = document.getElementById('settingsModal') as HTMLElement;
const btnOpenSettings = document.getElementById('btnOpenSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const settingDiscordRpc = document.getElementById('settingDiscordRpc') as HTMLInputElement;
const discordRpcStatus = document.getElementById('discordRpcStatus') as HTMLElement;
const settingAdblock = document.getElementById('settingAdblock') as HTMLInputElement;
const settingDiscordAppId = document.getElementById('settingDiscordAppId') as HTMLInputElement;
const btnSaveDiscordAppId = document.getElementById('btnSaveDiscordAppId') as HTMLButtonElement;
const settingDiscordWebhook = document.getElementById('settingDiscordWebhook') as HTMLInputElement;
const btnSaveDiscordWebhook = document.getElementById('btnSaveDiscordWebhook') as HTMLButtonElement;
const btnDiscordInvite = document.getElementById('btnDiscordInvite') as HTMLButtonElement;

// Toast Helper
function showToast(message: string) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

// Format duration helper
function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Window Controls Init
if (btnMin) btnMin.addEventListener('click', () => window.api?.minimize());
if (btnMax) btnMax.addEventListener('click', () => window.api?.maximize());
if (btnClose) btnClose.addEventListener('click', () => window.api?.close());

// Double-click titlebar to maximize / restore
if (titlebar) {
  titlebar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.win-btn')) return;
    window.api?.maximize();
  });
}

function applyCurrentTrackUI(track: Track) {
  currentTrack = track;
  playerTitle.textContent = track.title || 'Lupin Music';
  playerArtist.textContent = track.artist || 'Lupin Audio';
  playerThumb.src = track.thumbnail || './logo.png';
  playerThumb.onerror = () => { playerThumb.src = './logo.png'; };
  document.title = `${track.title || 'Lupin Music'} • ${track.artist || 'Lupin Audio'} — Lupin Music`;

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'Lupin Music',
        artist: track.artist || 'Lupin Audio',
        album: track.album || 'Lupin Luxury Music',
        artwork: [
          { src: track.thumbnail || './logo.png', sizes: '512x512', type: 'image/jpeg' }
        ]
      });
    } catch {}
  }

  updateLikeButton();
  highlightActiveCard();
  renderQueueList();
}

let activePlayReqId = 0;
let isFetchingRelated = false;
let lastRelatedVideoId = '';
let isTrackEnding = false;

// Kararli kuyruk / karisik-sira durumu
let shuffleOrder: number[] = []; // karisik modda kuyruk indexlerinin calinma sirasi
let shufflePos = 0; // shuffleOrder icinde su anki konum
let radioGen = 0; // bayat radyo fetch sonuclarini eleme sayaci

// Motor gecisi sirasinda eski videodan gelen bayat raporlari eleme
let pendingVideoId: string | null = null;
let pendingClearTimer: any = null;
let lastAdToastId: string | null = null;
// Gecis sirasinda verilen seek hedefi: motor onaylayinca tekrar uygulanir (yutulmaz)
let pendingSeek: { t: number; at: number } | null = null;
// Kullanicinin bilerek duraklatip duraklatmadigi (tekrar-bir karari icin)
let userPaused: boolean = false;

/** HTML enjeksiyonuna karsi metin kacirma (InnerTube verisi disaridandir). */
function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setPendingVideo(id: string): void {
  pendingVideoId = id;
  if (pendingClearTimer) clearTimeout(pendingClearTimer);
  pendingClearTimer = setTimeout(() => { pendingVideoId = null; }, 2000);
}

function clearPendingVideo(): void {
  pendingVideoId = null;
  if (pendingClearTimer) {
    clearTimeout(pendingClearTimer);
    pendingClearTimer = null;
  }
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Karisik mod acildiginda / kuyruk yenilendiginde calinma sirasini bir kez kurar. */
function rebuildShuffleOrder(): void {
  if (currentIndex < 0 || currentQueue.length === 0) {
    shuffleOrder = [];
    shufflePos = 0;
    return;
  }
  const rest = currentQueue.map((_, i) => i).filter(i => i !== currentIndex);
  shuffleOrder = [currentIndex, ...shuffled(rest)];
  shufflePos = 0;
}

function syncShufflePos(): void {
  if (!isShuffled) return;
  const pos = shuffleOrder.indexOf(currentIndex);
  if (pos !== -1) {
    shufflePos = pos;
  } else {
    shuffleOrder.splice(shufflePos + 1, 0, currentIndex);
    shufflePos += 1;
  }
}

/** Siradaki parcanin kuyruk indexi; sonda ise -1. Karisik modda onceden kurulu sira izlenir. */
function orderedNextIndex(): number {
  if (currentQueue.length === 0 || currentIndex < 0) return -1;
  if (isShuffled) {
    return shufflePos + 1 < shuffleOrder.length ? shuffleOrder[shufflePos + 1] : -1;
  }
  return currentIndex + 1 < currentQueue.length ? currentIndex + 1 : -1;
}

/** Onceki parcanin kuyruk indexi; basta ise -1. */
function orderedPrevIndex(): number {
  if (currentQueue.length === 0 || currentIndex < 0) return -1;
  if (isShuffled) {
    return shufflePos > 0 ? shuffleOrder[shufflePos - 1] : -1;
  }
  return currentIndex - 1 >= 0 ? currentIndex - 1 : -1;
}

async function fetchRelatedFresh(videoId: string): Promise<Track[]> {
  try {
    let related = await window.api?.getRelatedTracks?.(videoId);
    if (!Array.isArray(related) || related.length === 0) {
      related = await window.api?.getExplore?.();
    }
    if (Array.isArray(related)) {
      const recentIds = new Set(currentQueue.slice(Math.max(0, currentIndex - 30)).map((t: Track) => t.id));
      let filtered = related.filter((t: Track) => t && t.id && !recentIds.has(t.id));
      if (filtered.length === 0) {
        filtered = related.filter((t: Track) => t && t.id && t.id !== videoId);
      }
      return filtered;
    }
  } catch (err) {
    console.warn('Fetch related tracks error:', err);
  }
  return [];
}

/**
 * Radyo parcalarini SADECE kuyruk sonuna ekler; mevcut siralamayi asla bozmaz.
 * Eklenen indexleri doner. Kuyruk siserse calinmis basi budar.
 */
function appendRadioTracks(tracks: Track[]): number[] {
  const added: number[] = [];
  const existingIds = new Set(currentQueue.map((t: Track) => t.id));
  for (const t of tracks) {
    if (!t || !t.id || existingIds.has(t.id)) continue;
    existingIds.add(t.id);
    currentQueue.push({ ...t, source: 'radio' });
    added.push(currentQueue.length - 1);
  }
  if (added.length > 0 && isShuffled) {
    for (const i of shuffled(added)) shuffleOrder.push(i);
  }
  trimQueueHead();
  if (added.length > 0) {
    console.log(`[Player] radio +${added.length} (queue=${currentQueue.length})`);
    renderQueueList();
  }
  return added;
}

/** Kuyruk cok buyurse geride kalan calinmisleri buda (en fazla 50 kayit geriye bakilir). */
function trimQueueHead(): void {
  if (currentIndex > 50) {
    const drop = currentIndex - 50;
    currentQueue.splice(0, drop);
    currentIndex -= drop;
    if (isShuffled) {
      shuffleOrder = shuffleOrder.map(x => x - drop).filter(x => x >= 0);
      const pos = shuffleOrder.indexOf(currentIndex);
      shufflePos = pos !== -1 ? pos : 0;
    }
  }
}

/** Yeni secilen parca icin radyo listesini kurar; tohum degismisse bayat sonucu atar. */
async function attachRadio(seed: Track, gen: number): Promise<void> {
  const fresh = await fetchRelatedFresh(seed.id);
  if (gen !== radioGen) return;
  if (!currentQueue.some(t => t.id === seed.id)) return;
  if (fresh.length === 0) console.warn('[Player] radio fetch empty for', seed.id);
  appendRadioTracks(fresh);
}

/** Sira sonuna yaklasinca radyo sessizce uzatilir (siralama degismez, sadece eklenir). */
async function ensureRadioAhead(): Promise<void> {
  if (!currentTrack || isFetchingRelated) return;
  if (currentQueue.length - currentIndex > 3) return;
  if (lastRelatedVideoId === currentTrack.id) return;
  isFetchingRelated = true;
  try {
    const seed = currentTrack;
    const gen = radioGen;
    const before = currentQueue.length;
    await attachRadio(seed, gen);
    // Basarisiz fetch tekrar denemeyi engellemesin: eklenemediyse kilidi koyma
    if (currentQueue.length === before) return;
    lastRelatedVideoId = seed.id;
  } finally {
    isFetchingRelated = false;
  }
}

/** Sira tukendiginde son bir uzatma denemesi; eklenirse true doner. */
async function extendRadioNow(): Promise<boolean> {
  if (!currentTrack) return false;
  const gen = radioGen;
  try {
    let fresh = await fetchRelatedFresh(currentTrack.id);
    if (fresh.length === 0) {
      const explore = await window.api?.getExplore?.();
      if (Array.isArray(explore)) {
        fresh = explore.filter(t => t && t.id && t.id !== currentTrack?.id);
      }
    }
    if (gen !== radioGen || fresh.length === 0) return false;
    lastRelatedVideoId = currentTrack.id;
    return appendRadioTracks(fresh).length > 0;
  } catch {
    return false;
  }
}

/** Motorun kendi kendine gectigi (kuyruk disi) parcayi siraya isler; kuyruk hep gercegi soyler. */
function insertAdoptedTrack(t: Track): void {
  const at = currentIndex + 1;
  currentQueue.splice(at, 0, { ...t, source: 'radio' });
  if (isShuffled) {
    shuffleOrder = shuffleOrder.map(x => (x >= at ? x + 1 : x));
    shuffleOrder.splice(shufflePos + 1, 0, at);
    shufflePos += 1;
  }
  currentIndex = at;
  currentTrack = currentQueue[at];
  trimQueueHead();
}

// Playback Logic

/**
 * Şarkı başlatma:
 * - queueContext verilmişse (Beğenilenler, Geçmiş, Keşfet): tüm liste kuyruğa aktarılır, kullanıcı listesini dinler.
 * - queueContext verilmemişse (Arama sonucu tekil tıklama): tohum parça + arkasından otomatik radyo kurulur.
 */
async function playTrack(track: Track, queueContext?: Track[]) {
  radioGen += 1;
  const gen = radioGen;
  isTrackEnding = false;
  lastRelatedVideoId = '';

  if (queueContext && queueContext.length > 1) {
    currentQueue = queueContext.map(t => ({ ...t, source: 'pick' }));
    const idx = currentQueue.findIndex(t => t.id === track.id);
    currentIndex = idx !== -1 ? idx : 0;
    if (isShuffled) {
      rebuildShuffleOrder();
    } else {
      shuffleOrder = [];
      shufflePos = 0;
    }
    await startTrack(currentQueue[currentIndex]);
    renderQueueList();
    ensureRadioAhead().catch(() => {});
  } else {
    currentQueue = [{ ...track, source: 'pick' }];
    currentIndex = 0;
    if (isShuffled) {
      shuffleOrder = [0];
      shufflePos = 0;
    } else {
      shuffleOrder = [];
      shufflePos = 0;
    }

    await startTrack(currentQueue[0]);
    renderQueueList();
    attachRadio(currentQueue[0], gen).catch(() => {});
  }
}

/** Kuyruk ici gezinme (cekmece tiklamasi, ileri/geri, otomatik gecis). Kuyrugu bozmaz. */
async function playQueueIndex(i: number) {
  if (i < 0 || i >= currentQueue.length) return;
  isTrackEnding = false;
  currentIndex = i;
  syncShufflePos();
  await startTrack(currentQueue[i]);
  ensureRadioAhead().catch(() => {});
}

async function startTrack(track: Track) {
  isTrackEnding = false;
  userPaused = false;
  const reqId = ++activePlayReqId;
  setPendingVideo(track.id);
  applyCurrentTrackUI(track);

  // Anında (0ms) iyimser UI güncellemesi: Oynatıcıyı anında çalar duruma getir
  isPlaying = true;
  updatePlayPauseUI();

  // Yeni parça için süre ve ilerleme barını sıfırla
  currentTime = 0;
  currentDuration = track.duration || 0;
  currentTimeLabel.textContent = '0:00';
  durationLabel.textContent = formatTime(currentDuration);
  progressFill.style.width = '0%';

  try {
    const ok = await window.api.playTrack(track);
    if (reqId !== activePlayReqId) return;

    if (!ok) {
      clearPendingVideo();
      showToast('⚠️ Şarkı akışı bağlanamadı, tekrar deneyin.');
      isPlaying = false;
      updatePlayPauseUI();
      return;
    }
    // Gecmise yalnizca gercekten baslayan parca girer
    window.api?.addToHistory?.(track);
  } catch (err) {
    console.error('Play track failed:', err);
    if (reqId === activePlayReqId) {
      clearPendingVideo();
      isPlaying = false;
      updatePlayPauseUI();
    }
  }
}

async function togglePlayPause() {
  if (!currentTrack) {
    if (currentIndex >= 0 && currentQueue[currentIndex]) {
      playQueueIndex(currentIndex);
    } else if (currentQueue.length > 0) {
      playQueueIndex(0);
    }
    return;
  }

  // Buton durumunu beklemeden (0ms) anında güncelle
  if (isPlaying) {
    isPlaying = false;
    userPaused = true;
    updatePlayPauseUI();
    window.api?.pause?.().catch(() => {});
  } else {
    isPlaying = true;
    userPaused = false;
    updatePlayPauseUI();
    window.api?.resume?.().catch(() => {});
  }
}

function updatePlayPauseUI() {
  if (isPlaying) {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
    equalizer.classList.add('active');
  } else {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    equalizer.classList.remove('active');
  }
  highlightActiveCard();
}

/**
 * Sirada ilerleme: tekrar-bir aciksa basa sarar (otomatik geciste),
 * degilse siradaki parcaya gecer. Sonda: tekrar-tumu basa doner,
 * tekrar-kapaliysa radyo bir kez uzatilir, o da olmazsa durur.
 */
// Sona seek edildiginde motor poll'u bitisi kacirabilir (YT autonav hemen
// yabanci videoya atlarsa stale maske pstate 0'i gizler): seek hedefi son
// saniyedeyse kisa bir yedek zamanlayici ilerlemeyi garantiye alir.
let seekEndWatch: number | null = null;
function armSeekEndWatch(): void {
  if (seekEndWatch) window.clearTimeout(seekEndWatch);
  const trackId = currentTrack?.id || '';
  seekEndWatch = window.setTimeout(() => {
    seekEndWatch = null;
    if (isTrackEnding || userPaused || !trackId) return;
    if ((currentTrack?.id || '') !== trackId) return;
    console.log('[Player] seek-end fallback advance (poll missed the end)');
    advance(true).catch(() => {});
  }, 2200);
}

async function advance(auto: boolean) {
  if (seekEndWatch) { window.clearTimeout(seekEndWatch); seekEndWatch = null; }
  if (currentQueue.length === 0) return;

  if (auto && repeatMode === 'one' && currentTrack) {
    currentTime = 0;
    currentTimeLabel.textContent = '0:00';
    progressFill.style.width = '0%';
    window.api?.seek?.(0);
    // Kullanicinin bilerek duraklattigi parcayi uyandirma
    if (!userPaused) {
      window.api?.resume?.();
    }
    return;
  }

  let next = orderedNextIndex();
  console.log(`[Player] advance(auto=${auto}) queue=${currentQueue.length} idx=${currentIndex} next=${next} repeat=${repeatMode} shuffle=${isShuffled}`);
  if (next === -1) {
    if (repeatMode === 'all') {
      next = isShuffled ? (shuffleOrder[0] ?? 0) : 0;
    } else {
      const extended = await extendRadioNow();
      if (extended) next = orderedNextIndex();
      // Otomatik modda liste biterse durmak yerine baştan veya rastgele devam et (kesintisiz radyo)
      if (next === -1 && currentQueue.length > 0) {
        if (isShuffled) {
          rebuildShuffleOrder();
          next = shuffleOrder[0] ?? 0;
        } else {
          next = (currentIndex + 1) % currentQueue.length;
        }
      }
    }
  }

  if (next === -1) {
    if (auto) {
      isPlaying = false;
      userPaused = false;
      updatePlayPauseUI();
      window.api?.pause?.().catch(() => {});
      // Sonda dur: Play'e basilinca son parca bastan baslasin (bitis dongusu olmasin)
      currentTime = 0;
      currentTimeLabel.textContent = '0:00';
      progressFill.style.width = '0%';
      window.api?.seek?.(0).catch(() => {});
      showToast('Sıra bitti');
    } else {
      showToast('Sıranın sonundasın');
    }
    return;
  }

  await playQueueIndex(next);
}

function playNext() {
  advance(false).catch(() => {});
}

function playPrev() {
  if (currentQueue.length === 0) return;
  if (currentTime > 3) {
    const wasPlaying = isPlaying;
    currentTime = 0;
    currentTimeLabel.textContent = '0:00';
    progressFill.style.width = '0%';
    window.api?.seek?.(0);
    // Duraklatilmissa duraklatilmis kalsin; caliyorsa devam etsin
    if (wasPlaying && !isPlaying) {
      isPlaying = true;
      userPaused = false;
      updatePlayPauseUI();
      window.api?.resume?.().catch(() => {});
    }
    return;
  }
  const prev = orderedPrevIndex();
  if (prev === -1) {
    // Bastayiz: parcayi basa sar
    currentTime = 0;
    currentTimeLabel.textContent = '0:00';
    progressFill.style.width = '0%';
    window.api?.seek?.(0);
    return;
  }
  playQueueIndex(prev).catch(() => {});
}

// Listen for explicit Track Changed event from Main Process
window.api?.onTrackChanged?.((track: Track) => {
  if (!track) return;
  // Gecis sirasinda eski videonun yankisini yoksay
  if (pendingVideoId && track.id !== pendingVideoId) return;
  if (pendingVideoId && track.id === pendingVideoId) clearPendingVideo();
  const qIdx = currentQueue.findIndex(t => t.id === track.id);
  if (qIdx !== -1) {
    currentIndex = qIdx;
    syncShufflePos();
    currentTrack = currentQueue[qIdx];
  } else {
    insertAdoptedTrack(track);
    ensureRadioAhead().catch(() => {});
  }
  if (!currentTrack) return;
  applyCurrentTrackUI(currentTrack);
});

// Listen for AudioEngine updates from Main Process
window.api?.onPlaybackUpdate?.((playback: {
  currentTime: number;
  duration: number;
  paused: boolean;
  playerState: number;
  videoId?: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  isAd?: boolean;
}) => {
  // Reklam anonsu: parcada bir kez bilgi ver, gercek sarkinin ekranini koru
  if (playback.isAd) {
    if (currentTrack && lastAdToastId !== currentTrack.id) {
      lastAdToastId = currentTrack.id;
      showToast('Reklam atlanıyor…');
    }
    return;
  }
  // Motor baska bir videoya gectiyse (biz istedik ya da disaridan autoplay):
  // - Bekledigimiz videoyu gorduk: gecis onaylandi (esitlik disinda da temizle ki
  //   iyimser UI sonrasi gelen dogrulama beklemede takilmasin).
  // - Eski videonun bayat raporu: yoksay (secimi geri almasin diye erken don).
  // - Beklenmedik yeni video: kuyruga isle ki sira listesi gercegi soylesin.
  if (pendingVideoId && playback.videoId && playback.videoId === pendingVideoId) {
    clearPendingVideo();
    // Gecis sirasinda verilen seek yutulduysa simdi uygula
    if (pendingSeek && Date.now() - pendingSeek.at < 3000) {
      window.api?.seek?.(pendingSeek.t).catch(() => {});
    }
    pendingSeek = null;
  }
  if (playback.videoId && currentTrack && currentTrack.id !== playback.videoId) {
    if (pendingVideoId && playback.videoId !== pendingVideoId) return;
    if (pendingVideoId && playback.videoId === pendingVideoId) clearPendingVideo();
    const qIdx = currentQueue.findIndex(t => t.id === playback.videoId);
    if (qIdx !== -1) {
      currentIndex = qIdx;
      syncShufflePos();
      currentTrack = currentQueue[qIdx];
    } else {
      insertAdoptedTrack({
        id: playback.videoId,
        title: playback.title || 'Lupin Music',
        artist: playback.artist || 'Lupin Audio',
        thumbnail: playback.thumbnail || `https://i.ytimg.com/vi/${playback.videoId}/hqdefault.jpg`,
        duration: playback.duration || 0
      });
      ensureRadioAhead().catch(() => {});
    }
    applyCurrentTrackUI(currentTrack);
    window.api?.addToHistory?.(currentTrack);
  } else if (currentTrack && (!playback.videoId || playback.videoId === currentTrack.id)) {
    let patched = false;
    if (playback.title && currentTrack.title === 'Lupin Music' && playback.title !== 'YouTube Music') {
      currentTrack.title = playback.title;
      playerTitle.textContent = currentTrack.title;
      patched = true;
    }
    if (playback.artist && currentTrack.artist === 'Lupin Audio') {
      currentTrack.artist = playback.artist;
      playerArtist.textContent = currentTrack.artist;
      patched = true;
    }
    if (playback.thumbnail && (!currentTrack.thumbnail || currentTrack.thumbnail.includes('hqdefault.jpg'))) {
      currentTrack.thumbnail = playback.thumbnail;
      playerThumb.src = playback.thumbnail;
      patched = true;
    }
    if (patched) renderQueueList();
  }

  currentTime = playback.currentTime || 0;
  currentDuration = playback.duration || currentTrack?.duration || 0;

  currentTimeLabel.textContent = formatTime(currentTime);
  durationLabel.textContent = formatTime(currentDuration);

  if (currentDuration > 0) {
    const pct = Math.min(100, Math.max(0, (currentTime / currentDuration) * 100));
    progressFill.style.width = `${pct}%`;
  }

  const actuallyPlaying = !playback.paused && (playback.playerState === 1 || playback.playerState === 3);
  if (isPlaying !== actuallyPlaying) {
    if (userPaused && actuallyPlaying) {
      // Kullanıcı duraklattıysa, gecikmeli gelen bayat "çalıyor" paketleri UI'yı zıplatmasın
      return;
    }
    if (playback.playerState === 1 || playback.playerState === 3 || (playback.playerState === 2 && playback.paused)) {
      isPlaying = actuallyPlaying;
      updatePlayPauseUI();
    }
  }

  // Handle Track Ended:
  const isNearEnd = currentDuration > 5 && (
    (currentTime >= currentDuration - 1.5) ||
    (currentDuration > 10 && currentTime >= currentDuration * 0.98)
  );

  const hasEnded = (playback.playerState === 0) ||
    (isNearEnd && (playback.paused || playback.playerState === 0 || playback.playerState === 2));

  // Kullanicinin bilerek duraklattigi parca 'bitti' sanilip sirayi ilerletmesin:
  // bayat sure/konum eslesmesiyle kendilikinden sarki degistirmesin
  if (hasEnded && !isTrackEnding && !userPaused) {
    isTrackEnding = true;
    console.log('[Player] Track ended, advancing...');
    advance(true)
      .catch(() => {})
      .finally(() => {
        setTimeout(() => { isTrackEnding = false; }, 2000);
      });
  }
});

// Motor poll'lari (400ms) arasinda saati canli tut: gecis/buffering aninda
// ilerleme cubugu donmus gorunmesin; gelen poll gercegiyle toplanir
setInterval(() => {
  if (!isPlaying || userPaused || isTrackEnding || !currentTrack) return;
  if (currentDuration > 0 && currentTime >= currentDuration) return;
  currentTime = currentDuration > 0
    ? Math.min(currentDuration, currentTime + 0.25)
    : currentTime + 0.25;
  currentTimeLabel.textContent = formatTime(currentTime);
  if (currentDuration > 0) {
    progressFill.style.width = `${Math.min(100, (currentTime / currentDuration) * 100)}%`;
  }
}, 250);

// Seek bar click
progressBar.addEventListener('click', (e: MouseEvent) => {
  const rect = progressBar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (currentDuration > 0) {
    const target = ratio * currentDuration;
    currentTime = target;
    currentTimeLabel.textContent = formatTime(target);
    progressFill.style.width = `${ratio * 100}%`;
    pendingSeek = { t: target, at: Date.now() };
    window.api?.seek?.(target);
    if (target >= currentDuration - 1.5) armSeekEndWatch();
  }
});

// Volume control & Mute
// Ses seviyesine gore ikon: kapali / dusuk / yuksek (Material Design path'leri)
const VOL_ICON_PATHS = {
  off: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  low: 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z',
  high: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'
};

function updateVolumeIcon(v: number): void {
  if (!volumeIcon) return;
  const path = volumeIcon.querySelector('path');
  if (path) {
    const key = v <= 0.001 ? 'off' : v <= 0.5 ? 'low' : 'high';
    path.setAttribute('d', VOL_ICON_PATHS[key]);
  }
  volumeIcon.style.opacity = v === 0 ? '0.55' : '1';
  btnMute.classList.toggle('muted', v === 0);
  btnMute.title = v === 0
    ? 'Sesi Aç (M Tuşu)'
    : `Sessize Al (M Tuşu) — Ses: %${Math.round(v * 100)}`;
}

// Ayar yazimlarini bogmamak icin ses seviyesi 300ms debounce ile persist edilir
let settingsWriteTimer: any = null;
function persistVolumeSetting(v: number) {
  if (settingsWriteTimer) clearTimeout(settingsWriteTimer);
  settingsWriteTimer = setTimeout(() => {
    window.api?.updateSettings?.({ volume: v });
  }, 300);
}

function updateEqualizerVolume(v: number) {
  if (!equalizer) return;
  const scale = v <= 0 ? 0 : Math.max(0.12, v);
  equalizer.style.setProperty('--eq-scale', String(scale));
  equalizer.style.opacity = v === 0 ? '0.2' : (v < 0.3 ? '0.6' : '1');
}

function setVolume(val: number, persist: boolean = true) {
  const v = Math.max(0, Math.min(1, val));
  volumeSlider.value = String(v);

  // Dynamic gradient fill for volume slider track
  const pct = Math.round(v * 100);
  volumeSlider.style.background = `linear-gradient(to right, var(--accent-pink) 0%, var(--accent-purple) ${pct}%, rgba(255, 255, 255, 0.15) ${pct}%, rgba(255, 255, 255, 0.15) 100%)`;

  window.api?.setVolume?.(v);
  if (persist) persistVolumeSetting(v);
  updateVolumeIcon(v);
  updateEqualizerVolume(v);
}

// Mouse Wheel volume control on .volume-row
const volumeRow = document.querySelector('.volume-row') as HTMLElement;
if (volumeRow) {
  volumeRow.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const currentVol = parseFloat(volumeSlider.value);
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setVolume(currentVol + delta);
  }, { passive: false });
}

volumeSlider.addEventListener('input', () => {
  setVolume(parseFloat(volumeSlider.value));
});

btnMute.addEventListener('click', () => {
  const currentVol = parseFloat(volumeSlider.value);
  if (currentVol > 0) {
    prevVolume = currentVol;
    // Sessizlik diske yazilmaz: yeniden acilista sessiz surpriz olmasin
    setVolume(0, false);
    showToast('🔇 Sessize alındı');
  } else {
    setVolume(prevVolume || 0.8);
    showToast('🔊 Ses açıldı');
  }
});

// Player Controls
btnPlayPause.addEventListener('click', togglePlayPause);
btnNext.addEventListener('click', playNext);
btnPrev.addEventListener('click', playPrev);

btnShuffle.addEventListener('click', () => {
  isShuffled = !isShuffled;
  btnShuffle.classList.toggle('active', isShuffled);
  if (isShuffled && currentQueue.length > 0 && currentIndex >= 0) {
    // Karisik sira bir kez kurulur; her adimda yeniden zar atilmaz
    rebuildShuffleOrder();
  } else {
    shuffleOrder = [];
    shufflePos = 0;
  }
  window.api?.updateSettings?.({ shuffle: isShuffled });
  showToast(isShuffled ? '🔀 Karışık çalma açık' : '➡️ Sıralı çalma açık');
});

function applyRepeatUI() {
  if (repeatMode === 'off') {
    btnRepeat.classList.remove('active');
    btnRepeat.style.filter = 'none';
  } else if (repeatMode === 'all') {
    btnRepeat.classList.add('active');
    btnRepeat.style.filter = 'none';
    btnRepeat.title = 'Tümünü tekrarla (açık)';
  } else {
    btnRepeat.classList.add('active');
    btnRepeat.style.filter = 'drop-shadow(0 0 6px var(--accent-pink))';
    btnRepeat.title = 'Şarkıyı tekrarla (açık)';
  }
}

btnRepeat.addEventListener('click', () => {
  if (repeatMode === 'off') {
    repeatMode = 'all';
    showToast('🔁 Tümünü tekrarla');
  } else if (repeatMode === 'all') {
    repeatMode = 'one';
    showToast('🔂 Şarkıyı tekrarla');
  } else {
    repeatMode = 'off';
    showToast('➡️ Tekrar kapalı');
  }
  applyRepeatUI();
  window.api?.updateSettings?.({ repeat: repeatMode });
});

// Like Button
async function updateLikeButton() {
  if (!currentTrack) {
    btnLike.classList.remove('liked');
    return;
  }
  const liked = likedTrackIds.has(currentTrack.id);
  btnLike.classList.toggle('liked', liked);
}

btnLike.addEventListener('click', async () => {
  if (!currentTrack) return;
  const isLiked = await window.api.toggleLike(currentTrack);
  if (isLiked) {
    likedTrackIds.add(currentTrack.id);
    showToast(`💜 "${currentTrack.title}" Beğenilenlere eklendi!`);
  } else {
    likedTrackIds.delete(currentTrack.id);
    showToast(`💔 "${currentTrack.title}" Beğenilenlerden çıkarıldı.`);
  }
  updateLikeButton();
});

// Queue Drawer Toggle
btnToggleQueue.addEventListener('click', () => {
  queueDrawer.classList.toggle('open');
  renderQueueList();
});
btnCloseQueue.addEventListener('click', () => {
  queueDrawer.classList.remove('open');
});

function renderQueueList() {
  queueList.innerHTML = '';
  if (currentQueue.length === 0) {
    queueList.innerHTML = '<div style="color:var(--text-muted); padding:16px;">Sıra boş.</div>';
    return;
  }

  currentQueue.forEach((track, i) => {
    const item = document.createElement('div');
    item.className = 'queue-item' + (i === currentIndex ? ' current' : '');
    const radioTag = (i > currentIndex && track.source === 'radio')
      ? '<span style="font-size:10px; color:var(--accent-pink); border:1px solid var(--accent-pink); border-radius:8px; padding:1px 6px; margin-left:6px;">Radyo</span>'
      : '';
    item.innerHTML = `
      <img src="${track.thumbnail || './logo.png'}" class="queue-item-thumb" onerror="this.src='./logo.png'" />
      <div class="queue-item-info">
        <div class="queue-item-title">${esc(track.title)}${radioTag}</div>
        <div class="queue-item-artist">${esc(track.artist)}</div>
      </div>
      <span style="font-size:11px; color:var(--text-muted);">${esc(track.durationFormatted || '')}</span>
    `;

    item.addEventListener('click', () => {
      if (currentTrack && currentTrack.id === track.id) {
        togglePlayPause();
      } else {
        playQueueIndex(i).catch(() => {});
      }
    });

    queueList.appendChild(item);
  });

  if (queueDrawer.classList.contains('open')) {
    queueList.querySelector('.queue-item.current')?.scrollIntoView({ block: 'nearest' });
  }
}

// Highlight Active Playing Card
function highlightActiveCard() {
  const cards = document.querySelectorAll('.music-card');
  cards.forEach(card => {
    const cardId = card.getAttribute('data-id');
    if (currentTrack && cardId === currentTrack.id) {
      card.classList.add('playing');
    } else {
      card.classList.remove('playing');
    }
  });
}

// Card Renderer
function renderCards(tracks: Track[], queueContext?: Track[]) {
  cardsGrid.innerHTML = '';
  if (!tracks || tracks.length === 0) {
    cardsGrid.innerHTML = '<div style="color:var(--text-muted); padding:20px;">Hiç şarkı bulunamadı.</div>';
    return;
  }

  tracks.forEach(track => {
    const card = document.createElement('div');
    card.className = 'music-card' + (currentTrack && currentTrack.id === track.id ? ' playing' : '');
    card.setAttribute('data-id', track.id);
    card.innerHTML = `
      <div class="card-thumb-wrap">
        <img src="${track.thumbnail || './logo.png'}" class="card-thumb" alt="${esc(track.title)}" loading="lazy" onerror="this.src='./logo.png'" />
        <div class="card-play-overlay">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="card-title" title="${esc(track.title)}">${esc(track.title)}</div>
      <div class="card-artist" title="${esc(track.artist)}">${esc(track.artist)}</div>
    `;

    card.addEventListener('click', () => {
      if (currentTrack && currentTrack.id === track.id) {
        togglePlayPause();
      } else {
        playTrack(track, queueContext).catch(() => {});
      }
    });

    cardsGrid.appendChild(card);
  });
}

// Navigation Views
async function loadExplore() {
  const gen = ++browseGen;
  viewTitle.textContent = '🔥 Keşfet — Popüler Parçalar';
  cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">Lüks seçkiler yükleniyor...</div>';
  try {
    const tracks = await window.api.getExplore();
    if (gen !== browseGen) return;
    renderCards(tracks);
  } catch (err) {
    if (gen !== browseGen) return;
    cardsGrid.innerHTML = '<div style="color:var(--text-muted); padding:20px;">Keşfet yüklenemedi.</div>';
  }
}

async function loadLiked() {
  viewTitle.textContent = '💜 Beğenilen Şarkılar';
  const liked = await window.api.getLikedTracks();
  likedTrackIds = new Set(liked.map((t: Track) => t.id));
  renderCards(liked, liked);
}

async function loadHistory() {
  viewTitle.textContent = '🕒 Son Çalınanlar';
  const history = await window.api.getHistory();
  renderCards(history, history);
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const view = item.getAttribute('data-view');
    if (view === 'settings') {
      settingsModal.classList.add('open');
      return;
    }
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    if (view === 'explore') loadExplore();
    else if (view === 'liked') loadLiked();
    else if (view === 'history') loadHistory();
    else if (view === 'search') searchInput.focus();
  });
});

// Search input debounce (bayat sonuc yariş korumali)
let searchDebounce: any = null;
let browseGen = 0;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (!q) {
    loadExplore();
    return;
  }

  searchDebounce = setTimeout(async () => {
    const gen = ++browseGen;
    viewTitle.textContent = `🔍 "${q}" için Arama Sonuçları`;
    cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">Aranıyor...</div>';
    const res = await window.api.search(q);
    if (gen !== browseGen) return;
    renderCards(res.songs || []);
  }, 350);
});

// Settings Modal
if (btnCloseSettings) {
  btnCloseSettings.addEventListener('click', () => {
    settingsModal.classList.remove('open');
  });
}
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove('open');
  }
});
settingDiscordRpc.addEventListener('change', () => {
  window.api?.updateSettings({ discordRpcEnabled: settingDiscordRpc.checked });
  showToast(settingDiscordRpc.checked ? '🎮 Discord RPC Aktif' : '⚪ Discord RPC Devre Dışı');
  refreshRpcStatus();
});

function paintRpcStatus(s: { connected: boolean; enabled: boolean } | null) {
  if (!discordRpcStatus) return;
  if (!s) {
    discordRpcStatus.textContent = 'Kontrol ediliyor…';
    discordRpcStatus.style.color = 'var(--text-muted)';
    return;
  }
  if (!s.enabled) {
    discordRpcStatus.textContent = '⚪ Kapalı';
    discordRpcStatus.style.color = 'var(--text-muted)';
    discordRpcStatus.title = 'Ayarlardan Discord RPC anahtarını aç';
  } else if (s.connected) {
    discordRpcStatus.textContent = '🟢 Bağlı — Dinliyor olarak görünür';
    discordRpcStatus.style.color = '#10b981';
    discordRpcStatus.title = 'Discord profilinde Dinliyor durumu aktif';
  } else {
    discordRpcStatus.textContent = '🔴 Bağlı değil';
    discordRpcStatus.style.color = '#f43f5e';
    discordRpcStatus.title = 'Discord masaüstü uygulaması açık ve giriş yapılmış olmalı; Ayarlar > Gizlilik > Mevcut aktiviteyi göster açık olmalı';
  }
}

async function refreshRpcStatus() {
  try {
    const s = await window.api?.getRpcStatus?.();
    if (s) paintRpcStatus(s);
  } catch {}
}
window.api?.onRpcStatus?.((s: { connected: boolean; enabled: boolean }) => paintRpcStatus(s));
if (settingAdblock) {
  settingAdblock.addEventListener('change', () => {
    window.api?.updateSettings({ adblockEnabled: settingAdblock.checked });
    showToast(settingAdblock.checked ? '🛡️ Reklam engelleyici açık' : '⚪ Reklam engelleyici kapalı');
  });
}

if (btnSaveDiscordAppId && settingDiscordAppId) {
  btnSaveDiscordAppId.addEventListener('click', async () => {
    const val = settingDiscordAppId.value.trim();
    await window.api?.updateSettings({ discordAppId: val });
    showToast(val ? `🎮 Discord App ID güncellendi!` : '🎮 Varsayılan App ID geri yüklendi');
  });
}

if (btnSaveDiscordWebhook && settingDiscordWebhook) {
  btnSaveDiscordWebhook.addEventListener('click', async () => {
    const val = settingDiscordWebhook.value.trim();
    await window.api?.updateSettings({ discordWebhookUrl: val });
    showToast(val ? '🚀 Discord Webhook kaydedildi!' : '⚪ Discord Webhook temizlendi');
  });
}

// Discord Invite Button (Direct Webhook + Markdown Copy)
if (btnDiscordInvite) {
  btnDiscordInvite.addEventListener('click', async () => {
    if (!currentTrack) {
      showToast('⚠️ Şu anda çalan bir şarkı yok!');
      return;
    }

    const cur = currentTime || 0;
    const dur = currentDuration || 0;
    const fmt = (s: number) => formatTime(s);

    // Discord markdown message for clipboard (Spotify-tarzı Lupin Party daveti)
    const inviteMarkdown = `🎧 **Lupin Music • Birlikte Dinleme Partisi**\n🎵 **${currentTrack.title}** — *${currentTrack.artist}*\n⏳ Konum: \`${fmt(cur)} / ${fmt(dur)}\`\n✨ **Lupin Music'te Katıl:** https://lupinmusic.vercel.app/party?id=${currentTrack.id}&t=${Math.floor(cur)}\n🔗 Uygulama İçi Doğrudan Bağlantı: \`lupin://party?id=${currentTrack.id}&t=${Math.floor(cur)}\``;

    try {
      await window.api?.copyToClipboard(inviteMarkdown);
    } catch {
      navigator.clipboard?.writeText(inviteMarkdown).catch(() => {});
    }

    const settings = await window.api?.getSettings();
    if (settings?.discordWebhookUrl && settings.discordWebhookUrl.startsWith('http')) {
      showToast('⏳ Discord kanalına gönderiliyor...');
      // Gorsel "now playing" karti renderer'da cizilir (Discord'a PNG gonderilir);
      // cizilemezse ana surec eski metin embed'ine duser.
      let cardPng = '';
      try {
        cardPng = await renderNowPlayingCard({
          title: currentTrack.title,
          artist: currentTrack.artist,
          coverUrl: currentTrack.thumbnail,
          currentSec: cur,
          durationSec: dur,
          appLabel: 'Lupin Music • Birlikte Dinle'
        });
      } catch {
        cardPng = '';
      }
      const res = await window.api?.sendDiscordWebhookInvite({
        track: currentTrack,
        currentTime: cur,
        duration: dur,
        cardPng
      });

      if (res?.success) {
        showToast('🚀 Birlikte Dinle kartı kanala yollandı ve panoya kopyalandı!');
      } else {
        showToast('📋 Davet panoya kopyalandı! (Webhook hatası)');
      }
    } else {
      showToast('📋 Birlikte Dinle daveti panoya kopyalandı! (Doğrudan kanala atmak için Ayarlar\'dan Webhook girin)');
    }
  });
}

// Remote Control Handler (e.g. from Discord bot or local API)
let lastVolToastAt = 0;
function throttledVolumeToast() {
  const now = Date.now();
  if (now - lastVolToastAt < 800) return;
  lastVolToastAt = now;
  showToast(`🔊 Ses: %${Math.round(parseFloat(volumeSlider.value) * 100)}`);
}

window.api?.onRemoteControl?.((action: string, payload?: any) => {
  if (action === 'play' || action === 'resume') {
    if (!isPlaying) togglePlayPause();
  } else if (action === 'pause') {
    if (isPlaying) togglePlayPause();
  } else if (action === 'toggle') {
    togglePlayPause();
  } else if (action === 'next') {
    playNext();
  } else if (action === 'prev') {
    playPrev();
  } else if (action === 'volume' && typeof payload === 'number') {
    setVolume(payload);
  } else if (action === 'seek' && typeof payload === 'number') {
    pendingSeek = { t: payload, at: Date.now() };
    window.api?.seek?.(payload);
  } else if (action === 'playTrack' && payload && payload.id) {
    // Placeholder'lar main + renderer merge guard'lariyla AYNI olmali
    // ('Lupin Music'/'Lupin Audio'); farkli placeholder'da motor metadatasi
    // hic birlesmez ve deep-link parcasi 'Lupin Track' olarak kalir.
    const trackToPlay: Track = {
      id: payload.id,
      title: payload.title || 'Lupin Music',
      artist: payload.artist || 'Lupin Audio',
      thumbnail: payload.thumbnail || `https://i.ytimg.com/vi/${payload.id}/hqdefault.jpg`,
      duration: payload.duration || 0
    };
    playTrack(trackToPlay).then(() => {
      if (typeof payload.seek === 'number' && payload.seek > 0) {
        pendingSeek = { t: payload.seek, at: Date.now() };
        window.api?.seek?.(payload.seek);
      }
    });
    showToast('🚀 Lupin Party şarkısına bağlanıldı!');
  }
});

// Keyboard Shortcuts
window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement;
  const isInput = !!(
    target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.closest('input, textarea')
    )
  );

  if (isInput) {
    if (e.code === 'Escape' && target instanceof HTMLElement) {
      target.blur();
    }
    return;
  }

  const code = e.code;
  const key = e.key.toLowerCase();

  if (code === 'Space') {
    e.preventDefault();
    togglePlayPause();
  } else if (code === 'ArrowLeft') {
    e.preventDefault();
    if (e.shiftKey) playPrev();
    else if (currentDuration > 0) {
      const t = Math.max(0, currentTime - 5);
      pendingSeek = { t, at: Date.now() };
      window.api?.seek(t);
    }
  } else if (code === 'ArrowRight') {
    e.preventDefault();
    if (e.shiftKey) playNext();
    else if (currentDuration > 0) {
      const t = Math.min(currentDuration, currentTime + 5);
      pendingSeek = { t, at: Date.now() };
      window.api?.seek(t);
      if (t >= currentDuration - 1.5) armSeekEndWatch();
    }
  } else if (code === 'ArrowUp') {
    e.preventDefault();
    setVolume(parseFloat(volumeSlider.value) + 0.05);
    throttledVolumeToast();
  } else if (code === 'ArrowDown') {
    e.preventDefault();
    setVolume(parseFloat(volumeSlider.value) - 0.05);
    throttledVolumeToast();
  } else if (code === 'KeyM' || key === 'm') {
    btnMute.click();
  } else if (code === 'KeyN' || key === 'n') {
    playNext();
  } else if (code === 'KeyP' || key === 'p') {
    playPrev();
  } else if (code === 'KeyL' || key === 'l') {
    btnLike.click();
  }
});

// Hardware Media Keys & Windows Overlay Integration (MediaSession API)
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => { if (!isPlaying) togglePlayPause(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (isPlaying) togglePlayPause(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { playNext(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { playPrev(); });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        pendingSeek = { t: details.seekTime, at: Date.now() };
        window.api?.seek?.(details.seekTime);
      }
    });
  } catch (e) {
    console.debug('[MediaSession] Action handler error:', e);
  }
}

// App Initialization
async function initApp() {
  const settings = await window.api?.getSettings();
  if (settings) {
    if (typeof settings.volume === 'number') {
      setVolume(settings.volume);
    }
    if (settings.repeat === 'all' || settings.repeat === 'one' || settings.repeat === 'off') {
      repeatMode = settings.repeat;
    }
    if (typeof settings.shuffle === 'boolean') {
      isShuffled = settings.shuffle;
    } else {
      isShuffled = true;
    }
    btnShuffle.classList.toggle('active', isShuffled);
    applyRepeatUI();
    if (typeof settings.discordRpcEnabled === 'boolean') {
      settingDiscordRpc.checked = settings.discordRpcEnabled;
    }
    refreshRpcStatus().catch(() => {});
    if (settingAdblock && typeof settings.adblockEnabled === 'boolean') {
      settingAdblock.checked = settings.adblockEnabled;
    }
    if (typeof settings.discordAppId === 'string' && settingDiscordAppId) {
      settingDiscordAppId.value = settings.discordAppId;
    }
    if (typeof settings.discordWebhookUrl === 'string' && settingDiscordWebhook) {
      settingDiscordWebhook.value = settings.discordWebhookUrl;
    }
  }

  const liked = await window.api?.getLikedTracks();
  if (Array.isArray(liked)) {
    likedTrackIds = new Set(liked.map((t: Track) => t.id));
  }

  loadExplore();
}

initApp();
