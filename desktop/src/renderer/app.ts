// Declare window.api type from preload
declare global {
  interface Window {
    api: any;
  }
}

interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  duration?: number;
  durationFormatted?: string;
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
const settingDiscordAppId = document.getElementById('settingDiscordAppId') as HTMLInputElement;
const btnSaveDiscordAppId = document.getElementById('btnSaveDiscordAppId') as HTMLButtonElement;

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

// Playback Logic
async function playTrack(track: Track, queue?: Track[]) {
  if (queue && queue.length > 0) {
    currentQueue = [...queue];
    currentIndex = currentQueue.findIndex(t => t.id === track.id);
    if (currentIndex === -1) {
      currentQueue.unshift(track);
      currentIndex = 0;
    }
  } else if (currentQueue.length === 0) {
    currentQueue = [track];
    currentIndex = 0;
  } else {
    const idx = currentQueue.findIndex(t => t.id === track.id);
    if (idx !== -1) {
      currentIndex = idx;
    } else {
      currentQueue.splice(currentIndex + 1, 0, track);
      currentIndex += 1;
    }
  }

  const reqId = ++activePlayReqId;
  applyCurrentTrackUI(track);

  // Add to History
  window.api?.addToHistory?.(track);

  try {
    const ok = await window.api.playTrack(track);
    if (reqId !== activePlayReqId) return;

    playerArtist.textContent = track.artist;
    if (!ok) {
      showToast('⚠️ Şarkı akışı bağlanamadı, tekrar deneyin.');
      return;
    }

    isPlaying = true;
    updatePlayPauseUI();
  } catch (err) {
    console.error('Play track failed:', err);
    if (reqId === activePlayReqId) {
      playerArtist.textContent = track.artist;
    }
  }
}

async function togglePlayPause() {
  if (!currentTrack) {
    if (currentQueue.length > 0) {
      playTrack(currentQueue[0]);
    }
    return;
  }

  if (isPlaying) {
    await window.api.pause();
    isPlaying = false;
  } else {
    await window.api.resume();
    isPlaying = true;
  }
  updatePlayPauseUI();
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

function playNext() {
  if (currentQueue.length === 0) return;
  if (isShuffled) {
    currentIndex = Math.floor(Math.random() * currentQueue.length);
  } else {
    currentIndex = (currentIndex + 1) % currentQueue.length;
  }
  playTrack(currentQueue[currentIndex]);
}

function playPrev() {
  if (currentQueue.length === 0) return;
  if (currentTime > 3) {
    window.api.seek(0);
    return;
  }
  currentIndex = (currentIndex - 1 + currentQueue.length) % currentQueue.length;
  playTrack(currentQueue[currentIndex]);
}

// Listen for explicit Track Changed event from Main Process
window.api?.onTrackChanged?.((track: Track) => {
  if (!track) return;
  const qIdx = currentQueue.findIndex(t => t.id === track.id);
  if (qIdx !== -1) {
    currentIndex = qIdx;
    currentTrack = currentQueue[qIdx];
  } else {
    currentTrack = track;
  }
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
}) => {
  // If player transitioned to a new track (e.g. YouTube Music autoplay/radio)
  if (playback.videoId && (!currentTrack || currentTrack.id !== playback.videoId)) {
    const qIdx = currentQueue.findIndex(t => t.id === playback.videoId);
    if (qIdx !== -1) {
      currentIndex = qIdx;
      currentTrack = currentQueue[qIdx];
    } else {
      currentTrack = {
        id: playback.videoId,
        title: playback.title || 'Lupin Music',
        artist: playback.artist || 'Lupin Audio',
        thumbnail: playback.thumbnail || `https://i.ytimg.com/vi/${playback.videoId}/hqdefault.jpg`,
        duration: playback.duration || 0
      };
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

  const actuallyPlaying = !playback.paused && playback.playerState === 1;
  if (isPlaying !== actuallyPlaying) {
    isPlaying = actuallyPlaying;
    updatePlayPauseUI();
  }

  // Handle Track Ended (playerState === 0)
  // Sadece şarkı gerçekten sonuna ulaştığında (en az 3 saniye çalmış veya süre sonuna yaklaşmışsa) sonraki parçaya geç
  if (playback.playerState === 0 && (currentTime > 3 || (currentDuration > 0 && currentTime >= currentDuration - 2))) {
    if (repeatMode === 'one') {
      window.api.seek(0);
      window.api.resume();
    } else {
      playNext();
    }
  }
});

// Seek bar click
progressBar.addEventListener('click', (e: MouseEvent) => {
  const rect = progressBar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (currentDuration > 0) {
    const target = ratio * currentDuration;
    window.api.seek(target);
  }
});

// Volume control & Mute
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
  showToast(isShuffled ? '🔀 Karışık çalma açık' : '➡️ Sıralı çalma açık');
});

btnRepeat.addEventListener('click', () => {
  if (repeatMode === 'off') {
    repeatMode = 'all';
    btnRepeat.classList.add('active');
    showToast('🔁 Tümünü tekrarla');
  } else if (repeatMode === 'all') {
    repeatMode = 'one';
    btnRepeat.classList.add('active');
    btnRepeat.style.filter = 'drop-shadow(0 0 6px var(--accent-pink))';
    showToast('🔂 Şarkıyı tekrarla');
  } else {
    repeatMode = 'off';
    btnRepeat.classList.remove('active');
    btnRepeat.style.filter = 'none';
    showToast('➡️ Tekrar kapalı');
  }
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
    item.innerHTML = `
      <img src="${track.thumbnail || './logo.png'}" class="queue-item-thumb" onerror="this.src='./logo.png'" />
      <div class="queue-item-info">
        <div class="queue-item-title">${track.title}</div>
        <div class="queue-item-artist">${track.artist}</div>
      </div>
      <span style="font-size:11px; color:var(--text-muted);">${track.durationFormatted || ''}</span>
    `;

    item.addEventListener('click', () => {
      currentIndex = i;
      playTrack(track);
    });

    queueList.appendChild(item);
  });
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
        <img src="${track.thumbnail || './logo.png'}" class="card-thumb" alt="${track.title}" loading="lazy" onerror="this.src='./logo.png'" />
        <div class="card-play-overlay">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="card-title" title="${track.title}">${track.title}</div>
      <div class="card-artist" title="${track.artist}">${track.artist}</div>
    `;

    card.addEventListener('click', () => {
      playTrack(track, queueContext || tracks);
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

if (btnSaveDiscordAppId && settingDiscordAppId) {
  btnSaveDiscordAppId.addEventListener('click', async () => {
    const val = settingDiscordAppId.value.trim();
    await window.api?.updateSettings({ discordAppId: val });
    showToast(val ? `🎮 Discord App ID güncellendi!` : '🎮 Varsayılan App ID geri yüklendi');
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
    if (typeof settings.discordRpcEnabled === 'boolean') {
      settingDiscordRpc.checked = settings.discordRpcEnabled;
    }
    if (typeof settings.discordAppId === 'string' && settingDiscordAppId) {
      settingDiscordAppId.value = settings.discordAppId;
    }
  }

  const liked = await window.api?.getLikedTracks();
  if (Array.isArray(liked)) {
    likedTrackIds = new Set(liked.map((t: Track) => t.id));
  }

  loadExplore();
}

initApp();
