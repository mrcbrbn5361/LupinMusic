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

function setPendingVideo(id: string): void {
  pendingVideoId = id;
  if (pendingClearTimer) clearTimeout(pendingClearTimer);
  pendingClearTimer = setTimeout(() => { pendingVideoId = null; }, 8000);
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
    const related = await window.api?.getRelatedTracks?.(videoId);
    if (Array.isArray(related)) {
      const existingIds = new Set(currentQueue.map((t: Track) => t.id));
      return related.filter((t: Track) => t && t.id && !existingIds.has(t.id));
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
  // Kuyruk cok buyurse geride kalan calinmisleri buda (en fazla 50 kayit geriye bakilir)
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
  if (added.length > 0) renderQueueList();
  return added;
}

/** Yeni secilen parca icin radyo listesini kurar; tohum degismisse bayat sonucu atar. */
async function attachRadio(seed: Track, gen: number): Promise<void> {
  const fresh = await fetchRelatedFresh(seed.id);
  if (gen !== radioGen) return;
  if (!currentQueue.some(t => t.id === seed.id)) return;
  appendRadioTracks(fresh);
}

/** Sira sonuna yaklasinca radyo sessizce uzatilir (siralama degismez, sadece eklenir). */
async function ensureRadioAhead(): Promise<void> {
  if (!currentTrack || isFetchingRelated) return;
  if (currentQueue.length - currentIndex > 3) return;
  if (lastRelatedVideoId === currentTrack.id) return;
  isFetchingRelated = true;
  lastRelatedVideoId = currentTrack.id;
  try {
    await attachRadio(currentTrack, radioGen);
  } finally {
    isFetchingRelated = false;
  }
}

/** Sira tukendiginde son bir uzatma denemesi; eklenirse true doner. */
async function extendRadioNow(): Promise<boolean> {
  if (!currentTrack || isFetchingRelated) return false;
  isFetchingRelated = true;
  try {
    const fresh = await fetchRelatedFresh(currentTrack.id);
    if (fresh.length === 0) return false;
    lastRelatedVideoId = currentTrack.id;
    return appendRadioTracks(fresh).length > 0;
  } finally {
    isFetchingRelated = false;
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
}

// Playback Logic

/**
 * Karta tiklama = yeni tohum: kuyruk [secilen + kararli radyo] olarak kurulur.
 * Arama/liste kalintisi kuyruga asla girmez; radyo ilk tohumdan uretilir ve
 * ilerledikce sirasi degismez (sadece sona eklenir).
 */
async function playTrack(track: Track) {
  radioGen += 1;
  const gen = radioGen;
  isTrackEnding = false;
  lastRelatedVideoId = '';

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

  // Add to History
  window.api?.addToHistory?.(track);

  try {
    const ok = await window.api.playTrack(track);
    if (reqId !== activePlayReqId) return;

    if (!ok) {
      clearPendingVideo();
      showToast('⚠️ Şarkı akışı bağlanamadı, tekrar deneyin.');
      isPlaying = false;
      updatePlayPauseUI();
    }
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
    updatePlayPauseUI();
    window.api?.pause?.().catch(() => {});
  } else {
    isPlaying = true;
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
async function advance(auto: boolean) {
  if (currentQueue.length === 0) return;

  if (auto && repeatMode === 'one' && currentTrack) {
    currentTime = 0;
    currentTimeLabel.textContent = '0:00';
    progressFill.style.width = '0%';
    window.api?.seek?.(0);
    window.api?.resume?.();
    return;
  }

  let next = orderedNextIndex();
  if (next === -1) {
    if (repeatMode === 'all') {
      next = isShuffled ? (shuffleOrder[0] ?? 0) : 0;
    } else {
      const extended = await extendRadioNow();
      if (extended) next = orderedNextIndex();
    }
  }

  if (next === -1) {
    if (auto) {
      isPlaying = false;
      updatePlayPauseUI();
      window.api?.pause?.().catch(() => {});
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
    currentTime = 0;
    currentTimeLabel.textContent = '0:00';
    progressFill.style.width = '0%';
    window.api?.seek?.(0);
    if (!isPlaying) {
      isPlaying = true;
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
  // - Bekledigimiz videoyu gorduk: gecis onaylandi.
  // - Eski videonun bayat raporu: yoksay (secimi geri almasin diye erken don).
  // - Beklenmedik yeni video: kuyruga isle ki sira listesi gercegi soylesin.
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
  } else if (currentTrack) {
    if (playback.title && currentTrack.title === 'Lupin Music' && playback.title !== 'YouTube Music') {
      currentTrack.title = playback.title;
      playerTitle.textContent = currentTrack.title;
    }
    if (playback.artist && currentTrack.artist === 'Lupin Audio') {
      currentTrack.artist = playback.artist;
      playerArtist.textContent = currentTrack.artist;
    }
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
    if (playback.playerState === 1 || (playback.playerState === 2 && playback.paused)) {
      isPlaying = actuallyPlaying;
      updatePlayPauseUI();
    }
  }

  // Handle Track Ended:
  const isNearEnd = currentDuration > 5 && (
    (currentTime >= currentDuration - 1.5) ||
    (currentDuration > 10 && currentTime >= currentDuration * 0.98)
  );

  const hasEnded = (playback.playerState === 0 && currentTime > 3) ||
    (isNearEnd && playback.paused);

  if (hasEnded && !isTrackEnding) {
    isTrackEnding = true;
    console.log('[Player] Track ended, advancing...');
    advance(true)
      .catch(() => {})
      .finally(() => {
        setTimeout(() => { isTrackEnding = false; }, 2000);
      });
  }
});

// Seek bar click
progressBar.addEventListener('click', (e: MouseEvent) => {
  const rect = progressBar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (currentDuration > 0) {
    const target = ratio * currentDuration;
    currentTime = target;
    currentTimeLabel.textContent = formatTime(target);
    progressFill.style.width = `${ratio * 100}%`;
    window.api?.seek?.(target);
  }
});

// Volume control & Mute
function updateVolumeIcon(v: number): void {
  if (!volumeIcon) return;
  volumeIcon.style.opacity = v === 0 ? '0.35' : '1';
  btnMute.classList.toggle('muted', v === 0);
}

function setVolume(val: number) {
  const v = Math.max(0, Math.min(1, val));
  volumeSlider.value = String(v);

  // Dynamic gradient fill for volume slider track
  const pct = Math.round(v * 100);
  volumeSlider.style.background = `linear-gradient(to right, var(--accent-pink) 0%, var(--accent-purple) ${pct}%, rgba(255, 255, 255, 0.15) ${pct}%, rgba(255, 255, 255, 0.15) 100%)`;

  window.api?.setVolume?.(v);
  window.api?.updateSettings?.({ volume: v });
  updateVolumeIcon(v);
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
    setVolume(0);
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
        <div class="queue-item-title">${track.title}${radioTag}</div>
        <div class="queue-item-artist">${track.artist}</div>
      </div>
      <span style="font-size:11px; color:var(--text-muted);">${track.durationFormatted || ''}</span>
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
function renderCards(tracks: Track[]) {
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
        <img src="${track.thumbnail || './logo.png'}" class="card-thumb" alt="${track.title}" loading="lazy" onerror="this.src='./logo.png'" />
        <div class="card-play-overlay">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="card-title" title="${track.title}">${track.title}</div>
      <div class="card-artist" title="${track.artist}">${track.artist}</div>
    `;

    card.addEventListener('click', () => {
      if (currentTrack && currentTrack.id === track.id) {
        togglePlayPause();
      } else {
        // Karta tiklama yeni tohumdur: kuyruk [secilen + kararli radyo] kurulur.
        playTrack(track).catch(() => {});
      }
    });

    cardsGrid.appendChild(card);
  });
}

// Navigation Views
async function loadExplore() {
  viewTitle.textContent = '🔥 Keşfet — Popüler Parçalar';
  cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">Lüks seçkiler yükleniyor...</div>';
  try {
    const tracks = await window.api.getExplore();
    renderCards(tracks);
  } catch (err) {
    cardsGrid.innerHTML = '<div style="color:var(--text-muted); padding:20px;">Keşfet yüklenemedi.</div>';
  }
}

async function loadLiked() {
  viewTitle.textContent = '💜 Beğenilen Şarkılar';
  const liked = await window.api.getLikedTracks();
  likedTrackIds = new Set(liked.map((t: Track) => t.id));
  renderCards(liked);
}

async function loadHistory() {
  viewTitle.textContent = '🕒 Son Çalınanlar';
  const history = await window.api.getHistory();
  renderCards(history);
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

// Search input debounce
let searchDebounce: any = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (!q) {
    loadExplore();
    return;
  }

  searchDebounce = setTimeout(async () => {
    viewTitle.textContent = `🔍 "${q}" için Arama Sonuçları`;
    cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">Aranıyor...</div>';
    const res = await window.api.search(q);
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
});
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

    // Discord markdown message for clipboard
    const inviteMarkdown = `🎧 **Lupin Music • Birlikte Dinliyoruz!**\n🎵 **${currentTrack.title}** — *${currentTrack.artist}*\n⏳ Süre: \`${fmt(cur)} / ${fmt(dur)}\`\n▶️ Dinlemek için: https://youtu.be/${currentTrack.id}\n✨ Lupin Topluluğu: https://discord.gg/Rma8w8JrQH`;

    try {
      await window.api?.copyToClipboard(inviteMarkdown);
    } catch {
      navigator.clipboard?.writeText(inviteMarkdown).catch(() => {});
    }

    const settings = await window.api?.getSettings();
    if (settings?.discordWebhookUrl && settings.discordWebhookUrl.startsWith('http')) {
      showToast('⏳ Discord kanalına gönderiliyor...');
      const res = await window.api?.sendDiscordWebhookInvite({
        track: currentTrack,
        currentTime: cur,
        duration: dur
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
window.api?.onRemoteControl?.((action: string, payload?: any) => {
  if (action === 'play') {
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
    else if (currentDuration > 0) window.api?.seek(Math.max(0, currentTime - 5));
  } else if (code === 'ArrowRight') {
    e.preventDefault();
    if (e.shiftKey) playNext();
    else if (currentDuration > 0) window.api?.seek(Math.min(currentDuration, currentTime + 5));
  } else if (code === 'ArrowUp') {
    e.preventDefault();
    setVolume(parseFloat(volumeSlider.value) + 0.05);
    showToast(`🔊 Ses: %${Math.round(parseFloat(volumeSlider.value) * 100)}`);
  } else if (code === 'ArrowDown') {
    e.preventDefault();
    setVolume(parseFloat(volumeSlider.value) - 0.05);
    showToast(`🔉 Ses: %${Math.round(parseFloat(volumeSlider.value) * 100)}`);
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
      btnShuffle.classList.toggle('active', isShuffled);
    }
    applyRepeatUI();
    if (typeof settings.discordRpcEnabled === 'boolean') {
      settingDiscordRpc.checked = settings.discordRpcEnabled;
    }
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
