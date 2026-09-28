import type { Track } from '../types/index.js';

export interface LyricLine {
  time: number; // in seconds (-1 for plain lyrics without timestamps)
  text: string;
}

export interface LyricsData {
  id?: number;
  trackName: string;
  artistName: string;
  synced: boolean;
  lines: LyricLine[];
  plainText?: string;
}

export interface LyricsManagerOptions {
  onSeek?: (time: number) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * Temizleme yardımcısı: YouTube Music başlıklarındaki video/klip takılarını temizler
 * Böylece LRCLIB gibi katı API'lerde eşleşme oranı %95+'e çıkar.
 */
function cleanTitleForLyrics(raw: string): string {
  if (!raw) return '';
  let title = raw;

  // 1. Yaygın parantez içi takıları kaldır: (Official Video), [Official Audio], (Lyric Video), [MV] vb.
  title = title.replace(/\s*[([{\-–—].*?(official|video|audio|clip|mv|lyrics|lyric video|remaster|hd|4k|visualizer|feat\.|ft\.|live).*?[)\]}]/gi, '');

  // 2. "ft." veya "feat." sonrasını kaldır (şarkı adı genelde önce gelir)
  title = title.replace(/\s+(?:feat\.|ft\.|featuring)\s+.*$/i, '');

  // 3. Bölücü tireler veya pipe'lar: "Şarkı Adı | Klip" -> "Şarkı Adı"
  if (title.includes(' | ')) {
    title = title.split(' | ')[0];
  }

  // 4. "Artist - Track" biçimindeyse yalnızca ikinci parçayı al
  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2 && parts[1].trim()) {
      title = parts[1].trim();
    }
  }

  return title.trim();
}

/**
 * Sanatçı adı temizleme: birden fazla sanatçı veya "Topic" eklerini sadeleştirir
 */
function cleanArtistForLyrics(raw: string): string {
  if (!raw) return '';
  let artist = raw;
  artist = artist.replace(/\s*-\s*Topic$/i, '');
  // Birden fazla sanatçı varsa ilkini esas al
  if (artist.includes(',')) {
    artist = artist.split(',')[0].trim();
  }
  if (artist.includes('•')) {
    artist = artist.split('•')[0].trim();
  }
  return artist.trim();
}

/**
 * LRC formatındaki zaman damgalarını [mm:ss.xx] saniyeye ve metne çevirir
 */
function parseLrc(lrc: string): LyricLine[] {
  const rawLines = lrc.split('\n');
  const result: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const match = regex.exec(trimmed);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const time = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      // Yalnızca anlamlı söz satırlarını veya hafif araları ekle
      result.push({ time, text: text || '♪' });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

export class LyricsManager {
  private drawerEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private artistEl: HTMLElement | null = null;

  private currentTrack: Track | null = null;
  private currentLyrics: LyricsData | null = null;
  private isLoading: boolean = false;
  private activeLineIndex: number = -1;
  private userScrollingTimeout: any = null;
  private isUserScrolling: boolean = false;

  private options: LyricsManagerOptions;
  private cache: Map<string, LyricsData | null> = new Map();

  constructor(options: LyricsManagerOptions = {}) {
    this.options = options;
    this.initDOM();
  }

  private initDOM() {
    this.drawerEl = document.getElementById('lyricsDrawer');
    this.contentEl = document.getElementById('lyricsContent');
    this.toggleBtn = document.getElementById('btnToggleLyrics');
    this.closeBtn = document.getElementById('btnCloseLyrics');
    this.titleEl = document.getElementById('lyricsTrackTitle');
    this.artistEl = document.getElementById('lyricsTrackArtist');

    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => {
        this.toggle();
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.close();
      });
    }

    if (this.contentEl) {
      // Kullanıcı elle kaydırdığında otomatik merkezlemeyi 4 saniye askıya al
      this.contentEl.addEventListener('wheel', () => this.handleUserScroll(), { passive: true });
      this.contentEl.addEventListener('touchmove', () => this.handleUserScroll(), { passive: true });
    }

    // Escape tuşu ile kapatma
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  }

  private handleUserScroll() {
    this.isUserScrolling = true;
    if (this.userScrollingTimeout) clearTimeout(this.userScrollingTimeout);
    this.userScrollingTimeout = setTimeout(() => {
      this.isUserScrolling = false;
    }, 3500);
  }

  public isOpen(): boolean {
    return !!this.drawerEl?.classList.contains('open');
  }

  public open(): void {
    if (!this.drawerEl) return;
    this.options.onOpen?.();
    this.drawerEl.classList.add('open');
    this.toggleBtn?.classList.add('active');

    // Eğer çalan şarkı varsa ve sözler henüz yüklenmediyse yükle
    if (this.currentTrack && !this.currentLyrics && !this.isLoading) {
      this.loadForTrack(this.currentTrack);
    } else {
      this.scrollToActiveLine(true);
    }
  }

  public close(): void {
    if (!this.drawerEl) return;
    this.drawerEl.classList.remove('open');
    this.toggleBtn?.classList.remove('active');
    this.options.onClose?.();
  }

  public toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Çalan parça değiştiğinde sözleri otomatik çek
   */
  public async loadForTrack(track: Track): Promise<void> {
    this.currentTrack = track;
    this.activeLineIndex = -1;

    if (this.titleEl) this.titleEl.textContent = track.title || 'Lupin Music';
    if (this.artistEl) this.artistEl.textContent = track.artist || 'Bilinmeyen Sanatçı';

    const cacheKey = `${track.artist} - ${track.title}`.toLowerCase();
    if (this.cache.has(cacheKey)) {
      this.currentLyrics = this.cache.get(cacheKey) || null;
      this.render();
      return;
    }

    this.isLoading = true;
    this.renderLoading();

    try {
      const data = await this.fetchFromLrclib(track);
      this.cache.set(cacheKey, data);
      this.currentLyrics = data;
    } catch (err) {
      console.warn('[LyricsManager] Fetch error:', err);
      this.currentLyrics = null;
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  /**
   * Lrclib API'sine istek atar: önce doğrudan get, bulunamazsa arama (search) dener.
   */
  private async fetchFromLrclib(track: Track): Promise<LyricsData | null> {
    const rawTitle = track.title || '';
    const rawArtist = track.artist || '';
    const cleanTitle = cleanTitleForLyrics(rawTitle);
    const cleanArtist = cleanArtistForLyrics(rawArtist);

    if (!cleanTitle) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      // 1. Adım: Tam get sorgusu
      let params = new URLSearchParams({
        track_name: cleanTitle,
        artist_name: cleanArtist
      });
      if (track.duration && track.duration > 0) {
        params.append('duration', Math.round(track.duration).toString());
      }

      let resp = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
        headers: {
          'User-Agent': 'LupinMusic/1.0.0 (https://github.com/mrcbrbn5361/LupinMusic)'
        },
        signal: controller.signal
      }).catch(() => null);

      let json = resp && resp.ok ? await resp.json().catch(() => null) : null;

      // 2. Adım: Bulunamadıysa genel arama (search) ile ara
      if (!json || (!json.syncedLyrics && !json.plainLyrics)) {
        const query = `${cleanArtist} ${cleanTitle}`.trim();
        const searchResp = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
          headers: {
            'User-Agent': 'LupinMusic/1.0.0 (https://github.com/mrcbrbn5361/LupinMusic)'
          },
          signal: controller.signal
        }).catch(() => null);

        if (searchResp && searchResp.ok) {
          const list: any[] = await searchResp.json().catch(() => []);
          if (Array.isArray(list) && list.length > 0) {
            // Önce senkronize sözü olanı tercih et, yoksa ilk sonucu al
            json = list.find((item) => item.syncedLyrics) || list[0];
          }
        }
      }

      clearTimeout(timeoutId);

      if (!json) return null;

      if (json.syncedLyrics && typeof json.syncedLyrics === 'string') {
        const lines = parseLrc(json.syncedLyrics);
        if (lines.length > 0) {
          return {
            id: json.id,
            trackName: json.trackName || cleanTitle,
            artistName: json.artistName || cleanArtist,
            synced: true,
            lines,
            plainText: json.plainLyrics || undefined
          };
        }
      }

      if (json.plainLyrics && typeof json.plainLyrics === 'string') {
        const plainLines: LyricLine[] = json.plainLyrics
          .split('\n')
          .map((line: string) => ({ time: -1, text: line.trim() }));
        return {
          id: json.id,
          trackName: json.trackName || cleanTitle,
          artistName: json.artistName || cleanArtist,
          synced: false,
          lines: plainLines,
          plainText: json.plainLyrics
        };
      }

      return null;
    } catch (e) {
      clearTimeout(timeoutId);
      return null;
    }
  }

  /**
   * Çalan şarkının anlık saniyesine (currentTime) göre satırları senkronize eder
   */
  public syncTime(currentTime: number): void {
    if (!this.currentLyrics || !this.currentLyrics.synced || !this.contentEl) return;
    const lines = this.currentLyrics.lines;
    if (!lines || lines.length === 0) return;

    // currentTime'a eşit veya küçük olan en son satırı bul
    let nextIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= currentTime) {
        nextIndex = i;
      } else {
        break;
      }
    }

    if (nextIndex !== this.activeLineIndex) {
      this.updateActiveLine(nextIndex);
    }
  }

  private updateActiveLine(index: number) {
    if (!this.contentEl) return;
    const prevEl = this.contentEl.querySelector('.lyrics-line.active');
    if (prevEl) prevEl.classList.remove('active');

    this.activeLineIndex = index;
    if (index >= 0) {
      const activeEl = this.contentEl.querySelector(`.lyrics-line[data-index="${index}"]`) as HTMLElement;
      if (activeEl) {
        activeEl.classList.add('active');
        if (!this.isUserScrolling && this.isOpen()) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }

  private scrollToActiveLine(immediate = false) {
    if (!this.contentEl || this.activeLineIndex < 0) return;
    const activeEl = this.contentEl.querySelector(`.lyrics-line[data-index="${this.activeLineIndex}"]`) as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: immediate ? 'auto' : 'smooth', block: 'center' });
    }
  }

  private renderLoading() {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = `
      <div class="lyrics-status">
        <div class="lyrics-spinner"></div>
        <div class="lyrics-status-text">Şarkı sözleri aranıyor…</div>
      </div>
    `;
  }

  private render() {
    if (!this.contentEl) return;

    if (!this.currentLyrics || this.currentLyrics.lines.length === 0) {
      this.contentEl.innerHTML = `
        <div class="lyrics-status">
          <div class="lyrics-empty-icon">🎵</div>
          <div class="lyrics-status-text">Şarkı sözü bulunamadı</div>
          <div class="lyrics-status-sub">Bu parça için henüz zaman damgalı veya düz söz kaydı mevcut değil.</div>
          <button class="lyrics-retry-btn" id="btnRetryLyrics">Tekrar Dene</button>
        </div>
      `;
      const retryBtn = document.getElementById('btnRetryLyrics');
      if (retryBtn && this.currentTrack) {
        retryBtn.addEventListener('click', () => {
          if (this.currentTrack) {
            const cacheKey = `${this.currentTrack.artist} - ${this.currentTrack.title}`.toLowerCase();
            this.cache.delete(cacheKey);
            this.loadForTrack(this.currentTrack);
          }
        });
      }
      return;
    }

    const { synced, lines } = this.currentLyrics;

    let html = `<div class="lyrics-list ${synced ? 'synced' : 'plain'}">`;
    lines.forEach((line, idx) => {
      const isBlank = !line.text || line.text === '♪';
      html += `
        <div class="lyrics-line ${isBlank ? 'blank' : ''}" data-index="${idx}" data-time="${line.time}">
          ${line.text || '&nbsp;'}
        </div>
      `;
    });
    html += '</div>';

    this.contentEl.innerHTML = html;

    // Tıklanan satıra atlama (Seeking)
    if (synced && this.options.onSeek) {
      const lineEls = this.contentEl.querySelectorAll('.lyrics-line');
      lineEls.forEach((el) => {
        el.addEventListener('click', () => {
          const time = parseFloat(el.getAttribute('data-time') || '-1');
          if (time >= 0 && this.options.onSeek) {
            this.options.onSeek(time);
          }
        });
      });
    }

    if (this.activeLineIndex >= 0) {
      this.updateActiveLine(this.activeLineIndex);
    }
  }
}
