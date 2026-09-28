import type { Track } from '../types/index.js';
import { trackKey } from './queueManager.js';
import { libraryManager } from './libraryManager.js';

export interface BrowseCard {
  browseId: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  type: 'artist' | 'album' | 'playlist';
  songCount?: number;
}

export interface CardActionHandlers {
  onPlayTrack: (track: Track, queueContext?: Track[]) => void;
  onTogglePlayPause: () => void;
  onQueueInsertNext: (track: Track) => void;
  getCurrentTrack: () => Track | null;
  onRenderCards?: (tracks: Track[], queueContext?: Track[]) => void;
  onLoadExplore?: () => void;
}

export interface SearchContext {
  searchInput: HTMLInputElement;
  cardsGrid: HTMLDivElement;
  viewTitle: HTMLHeadingElement;
  handlers: CardActionHandlers;
  getBrowseGen: () => number;
  incrementBrowseGen: () => number;
}

/** HTML enjeksiyonuna karsi metin kacirma (InnerTube verisi disaridandir). */
export function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Saniye cinsinden süreyi m:ss formatına dönüştürür. */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Zevke gore siralama hafızası
const recentArtistTokens = new Set<string>();
const recentTrackKeys = new Set<string>();

/**
 * Dinlenen parçanın sanatçı ve başlık ipuçlarını zevk profilinde toplar.
 */
export function noteTaste(track: Track | null | undefined): void {
  if (!track) return;
  for (const token of String(track.artist || '').toLocaleLowerCase('tr').split(/[\s,;&/]+/)) {
    if (token.length >= 3) recentArtistTokens.add(token);
  }
  recentTrackKeys.add(trackKey(track));
  if (recentArtistTokens.size > 80) {
    const first = recentArtistTokens.values().next().value;
    if (first) recentArtistTokens.delete(first);
  }
  if (recentTrackKeys.size > 120) {
    const first = recentTrackKeys.values().next().value;
    if (first) recentTrackKeys.delete(first);
  }
}

/**
 * Arama sonuçlarını kullanıcının geçmiş zevkine göre sıralar.
 */
export function rankByTaste(songs: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of songs) {
    const key = trackKey(t);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(t);
  }
  const score = (t: Track): number => {
    const artistTokens = String(t.artist || '').toLocaleLowerCase('tr').split(/[\s,;&/]+/);
    if (artistTokens.some((a) => a.length >= 3 && recentArtistTokens.has(a))) return 2;
    const titleTokens = String(t.title || '').toLocaleLowerCase('tr').split(/[\s,;&/'-]+/);
    if (recentTrackKeys.has(trackKey(t))) return 1;
    for (const key of recentTrackKeys) {
      for (const tok of key.split(' ')) {
        if (tok.length >= 5 && titleTokens.includes(tok)) return 1;
      }
    }
    return 0;
  };
  return out
    .map((t, i) => ({ t, s: score(t), i }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.t);
}

export function sectionHtml(title: string, items: any[], itemHtml: (t: any) => string, kind: string): string {
  return `<div class="cards-section">
    <h3 class="cards-section-title">${esc(title)}</h3>
    <div class="cards-grid">${items.map(itemHtml).join('')}</div>
  </div>`;
}

export function renderSongCardHtml(track: Track): string {
  const badge = track.isVideo ? '<div class="card-type-badge">VIDEO</div>' : '';
  const durBadge = track.duration && track.duration > 0
    ? `<div class="card-duration">${formatTime(track.duration)}</div>` : '';
  return `
    <div class="music-card" data-id="${esc(track.id)}" data-title="${esc(track.title)}" data-artist="${esc(track.artist)}" data-album="${esc(track.album || '')}" data-duration="${track.duration || 0}">
      <div class="card-thumb-wrap">
        <img src="${esc(track.thumbnail || './logo.png')}" data-thumb="${esc(track.thumbnail || '')}" data-vid="${esc(track.id)}" class="card-thumb" alt="${esc(track.title)}" loading="lazy" onerror="lupinThumb(this)" />
        ${badge}
        ${durBadge}
        <button class="card-queue-btn" data-qid="${esc(track.id)}" title="Sıraya ekle">＋</button>
        <div class="card-play-overlay">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="card-title">${esc(track.title)}</div>
      <div class="card-artist">${esc(track.artist)}</div>
    </div>`;
}

export function renderBrowseCardHtml(item: BrowseCard): string {
  const icon = item.type === 'artist' ? '👤' : item.type === 'album' ? '💿' : '📀';
  return `
    <div class="music-card browse-card" data-browse="${esc(item.browseId)}" data-btype="${esc(item.type)}">
      <div class="card-thumb-wrap">
        <img src="${esc(item.thumbnail || './logo.png')}" data-thumb="${esc(item.thumbnail || '')}" class="card-thumb" alt="${esc(item.title)}" loading="lazy" onerror="lupinThumb(this)" />
        <div class="card-play-overlay"><span class="browse-icon">${icon}</span></div>
      </div>
      <div class="card-title">${esc(item.title)}</div>
      <div class="card-artist">${esc(item.subtitle || (item.type === 'artist' ? 'Sanatçı' : item.type === 'album' ? 'Albüm' : 'Oynatma listesi'))}</div>
    </div>`;
}

/** Bölümlenmiş HTML'deki şarkı kartlarına tıklanma davranışını bağlar. */
export function wireSongCards(
  list: Track[],
  handlers: CardActionHandlers,
  isPlaylistContext: boolean = false
): void {
  const byId = new Map(list.map((t) => [t.id, t]));
  document.querySelectorAll('.music-card[data-id]').forEach((el) => {
    const id = el.getAttribute('data-id');
    if (!id || !byId.has(id)) return;
    el.addEventListener('click', (e) => {
      // "+" düğmesi kart tıklamasını yutmasın: sıraya ekler
      const qbtn = (e.target as HTMLElement).closest('.card-queue-btn');
      const track = byId.get(id);
      if (qbtn) {
        e.stopPropagation();
        if (track) handlers.onQueueInsertNext(track);
        return;
      }
      if (!track) return;
      const cur = handlers.getCurrentTrack();
      if (cur && cur.id === track.id) {
        handlers.onTogglePlayPause();
      } else if (isPlaylistContext) {
        handlers.onPlayTrack(track, list);
      } else {
        // Keşfet ve arama: şarkıyı tohum alarak dinamik radyo akışı başlatır
        handlers.onPlayTrack(track);
      }
    });
  });
}

/** Sanatçı / albüm / liste kartına tıklanınca detay sayfasını açar. */
export function wireBrowseCards(ctx: SearchContext): void {
  document.querySelectorAll('.browse-card').forEach((el) => {
    el.addEventListener('click', () => {
      const browseId = el.getAttribute('data-browse');
      const btype = el.getAttribute('data-btype');
      if (!browseId) return;
      openBrowseDetail(browseId, btype || 'playlist', ctx);
    });
  });
}

/** Sanatçı / Albüm / Çalma listesi detay görünümünü yükler. */
export async function openBrowseDetail(browseId: string, btype: string, ctx: SearchContext): Promise<void> {
  const gen = ctx.incrementBrowseGen();
  ctx.viewTitle.textContent = 'Yükleniyor...';
  ctx.cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">İçerik yükleniyor...</div>';
  const detail = await (window as any).api?.browse?.(browseId);
  if (gen !== ctx.getBrowseGen()) return;
  if (!detail || !detail.title) {
    ctx.viewTitle.textContent = 'İçerik bulunamadı';
    ctx.cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:24px;">Bu içerik yüklenemedi.</div>';
    return;
  }
  const isArtist = btype === 'artist' || detail.type === 'artist';
  const label = isArtist ? 'Sanatçı' : btype === 'album' ? 'Albüm' : 'Oynatma listesi';
  ctx.viewTitle.textContent = `${label}: ${detail.title}`;
  const songs: Track[] = detail.songs || [];
  if (!songs.length) {
    ctx.cardsGrid.innerHTML = `<div style="color:var(--text-secondary); padding:24px;">${esc(detail.subtitle || 'Bu içerikte şarkı bulunamadı.')}</div>`;
    return;
  }

  if (ctx.handlers.onRenderCards) {
    ctx.handlers.onRenderCards(songs, songs);
  }

  if (isArtist) {
    const banner = document.createElement('div');
    banner.className = 'artist-header-banner';
    const artistObj = {
      id: browseId,
      name: detail.title,
      thumbnail: detail.thumbnail || './logo.png'
    };
    const isFollowed = libraryManager.isArtistFollowed(browseId);
    banner.innerHTML = `
      <div class="artist-banner-avatar-wrap">
        <img class="artist-banner-avatar" src="${esc(artistObj.thumbnail)}" alt="${esc(artistObj.name)}" onerror="window.lupinThumb ? window.lupinThumb(this) : null" />
      </div>
      <div class="artist-banner-details">
        <div class="artist-banner-badge">🎙️ SANATÇI</div>
        <h1 class="artist-banner-title">${esc(artistObj.name)}</h1>
        ${detail.subtitle ? `<div class="artist-banner-subtitle">${esc(detail.subtitle)}</div>` : ''}
        <div class="artist-banner-actions">
          <button class="btn-follow-artist${isFollowed ? ' following' : ''}" id="btnFollowArtist" title="${isFollowed ? 'Takibi Bırak' : 'Sanatçıyı Takip Et'}">
            <span class="follow-icon">${isFollowed ? '✓' : '＋'}</span>
            <span class="follow-text">${isFollowed ? 'Takip Ediliyor' : 'Takip Et'}</span>
          </button>
        </div>
      </div>
    `;

    ctx.cardsGrid.insertBefore(banner, ctx.cardsGrid.firstChild);

    const followBtn = banner.querySelector('#btnFollowArtist') as HTMLButtonElement | null;
    if (followBtn) {
      followBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        followBtn.disabled = true;
        const nowFollowed = await libraryManager.toggleFollowArtist(artistObj);
        followBtn.disabled = false;
        if (nowFollowed) {
          followBtn.classList.add('following');
          followBtn.innerHTML = `<span class="follow-icon">✓</span> <span class="follow-text">Takip Ediliyor</span>`;
          followBtn.title = 'Takibi Bırak';
        } else {
          followBtn.classList.remove('following');
          followBtn.innerHTML = `<span class="follow-icon">＋</span> <span class="follow-text">Takip Et</span>`;
          followBtn.title = 'Sanatçıyı Takip Et';
        }
      });
      followBtn.addEventListener('mouseenter', () => {
        if (followBtn.classList.contains('following')) {
          followBtn.innerHTML = `<span class="follow-icon">✕</span> <span class="follow-text">Takibi Bırak</span>`;
        }
      });
      followBtn.addEventListener('mouseleave', () => {
        if (followBtn.classList.contains('following')) {
          followBtn.innerHTML = `<span class="follow-icon">✓</span> <span class="follow-text">Takip Ediliyor</span>`;
        }
      });
    }
  }

  const wrap = document.createElement('div');
  wrap.className = 'browse-back-wrap';
  wrap.innerHTML = '<button id="btnBrowseBack" class="ctrl-btn">← Geri dön</button>';
  ctx.cardsGrid.appendChild(wrap);
  const back = document.getElementById('btnBrowseBack');
  if (back) {
    back.addEventListener('click', () => {
      const q = ctx.searchInput.value.trim();
      ctx.incrementBrowseGen();
      if (q) {
        ctx.viewTitle.textContent = `🔍 "${q}" için Arama Sonuçları`;
        ctx.searchInput.dispatchEvent(new Event('input'));
      } else {
        ctx.handlers.onLoadExplore?.();
      }
    });
  }
}

// Video versiyonları KISA SÜRELİ opt-in (arama sonunda görünür, 45 sn sonra kapanır)
let showVideoVersions = false;
let videoFlagTimer: any = null;

export function isShowingVideoVersions(): boolean {
  return showVideoVersions;
}

/**
 * Arama sonuçlarını Şarkı/Sanatçı/Albüm/Çalma Listesi olarak bölümler ve DOM'a basar.
 */
export function renderSearchResults(res: any, query: string, ctx: SearchContext): void {
  const songs: Track[] = res?.songs || [];
  const videos: Track[] = res?.videos || [];
  const albums: BrowseCard[] = res?.albums || [];
  const artists: BrowseCard[] = res?.artists || [];
  const playlists: BrowseCard[] = res?.playlists || [];
  if (!songs.length && !videos.length && !albums.length && !artists.length && !playlists.length) {
    ctx.cardsGrid.innerHTML = `<div style="color:var(--text-secondary); padding:24px;">"${esc(query)}" için sonuç bulunamadı.</div>`;
    return;
  }

  const ranked = rankByTaste(songs);
  const sections: string[] = [];
  if (ranked.length) {
    sections.push(sectionHtml('🎵 Şarkılar', ranked, renderSongCardHtml, 'song'));
  }
  if (artists.length) {
    sections.push(sectionHtml('👤 Sanatçılar', artists, renderBrowseCardHtml, 'artist'));
  }
  if (albums.length) {
    sections.push(sectionHtml('💿 Albümler', albums, renderBrowseCardHtml, 'album'));
  }
  if (playlists.length) {
    sections.push(sectionHtml('📀 Oynatma Listeleri', playlists, renderBrowseCardHtml, 'playlist'));
  }
  if (videos.length) {
    sections.push(sectionHtml('🎬 Video Versiyonları', videos, renderSongCardHtml, 'video'));
  }
  sections.push(`<div class="search-footer-row">
    <button class="ctrl-btn video-toggle-btn" id="btnToggleVideoVersions">${showVideoVersions ? '🎬 Videoları gizle' : '🎬 Video versiyonlarını göster'}</button>
    <span class="search-hint">Video versiyonları arama sonuçlarını seyrek gösterir; varsayılan yalnızca müziktir.</span>
  </div>`);
  ctx.cardsGrid.innerHTML = sections.join('');
  wireSongCards(ranked.concat(videos), ctx.handlers);
  wireBrowseCards(ctx);

  const vt = document.getElementById('btnToggleVideoVersions');
  if (vt) {
    vt.addEventListener('click', () => {
      showVideoVersions = !showVideoVersions;
      if (videoFlagTimer) clearTimeout(videoFlagTimer);
      // 45 sn sonra otomatik kapanır (kısa süreli opt-in)
      videoFlagTimer = window.setTimeout(() => {
        showVideoVersions = false;
        videoFlagTimer = null;
        const q = ctx.searchInput.value.trim();
        if (q) ctx.searchInput.dispatchEvent(new Event('input'));
      }, 45000);
      const q = ctx.searchInput.value.trim();
      if (q) ctx.searchInput.dispatchEvent(new Event('input'));
    });
  }
}

/**
 * Arama kutusu input olay dinleyicisini bağlar (350ms debounce & race-condition korumalı).
 */
export function setupSearchInput(ctx: SearchContext): void {
  let searchDebounce: any = null;
  ctx.searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = ctx.searchInput.value.trim();
    if (!q) {
      ctx.handlers.onLoadExplore?.();
      return;
    }

    searchDebounce = setTimeout(async () => {
      const gen = ctx.incrementBrowseGen();
      ctx.viewTitle.textContent = `🔍 "${q}" için Arama Sonuçları`;
      ctx.cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">Aranıyor...</div>';
      try {
        const res = await (window as any).api?.search?.({ query: q, videos: showVideoVersions });
        if (gen !== ctx.getBrowseGen()) return;
        renderSearchResults(res, q, ctx);
      } catch (err: any) {
        if (gen !== ctx.getBrowseGen()) return;
        ctx.cardsGrid.innerHTML = `<div style="color:var(--text-secondary); padding:24px;">⚠️ Arama başarısız oldu (${esc(err?.message || 'bağlantı hatası')}). İnterneti kontrol edip tekrar dene.</div>`;
      }
    }, 350);
  });
}
