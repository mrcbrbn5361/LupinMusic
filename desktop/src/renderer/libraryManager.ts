import type { Track, FollowedArtist } from '../types/index.js';

export interface LibraryContext {
  cardsGrid: HTMLDivElement;
  viewTitle: HTMLHeadingElement;
  renderCards: (tracks: Track[], queueContext?: Track[]) => void;
}

export class LibraryManager {
  private likedTrackIds: Set<string> = new Set<string>();
  private followedArtistIds: Set<string> = new Set<string>();

  public getLikedTrackIds(): Set<string> {
    return this.likedTrackIds;
  }

  public isLiked(trackId: string): boolean {
    return this.likedTrackIds.has(trackId);
  }

  public getFollowedArtistIds(): Set<string> {
    return this.followedArtistIds;
  }

  public isArtistFollowed(artistId: string): boolean {
    return this.followedArtistIds.has(artistId);
  }

  /**
   * Uygulama açılışında kayıtlı beğenilen şarkı kimliklerini hafızaya yükler.
   */
  public async initLikedTracks(): Promise<Set<string>> {
    try {
      const liked = await (window as any).api?.getLikedTracks?.();
      if (Array.isArray(liked)) {
        this.likedTrackIds = new Set(liked.map((t: Track) => t.id));
      }
    } catch (err) {
      console.warn('[LibraryManager] Liked tracks load error:', err);
    }
    return this.likedTrackIds;
  }

  /**
   * Uygulama açılışında takip edilen sanatçı kimliklerini hafızaya yükler.
   */
  public async initFollowedArtists(): Promise<Set<string>> {
    try {
      const artists = await (window as any).api?.getFollowedArtists?.();
      if (Array.isArray(artists)) {
        this.followedArtistIds = new Set(artists.map((a: FollowedArtist) => a.id));
      }
    } catch (err) {
      console.warn('[LibraryManager] Followed artists load error:', err);
    }
    return this.followedArtistIds;
  }

  /**
   * Şarkıyı beğenilenlere ekler veya çıkarır.
   */
  public async toggleLike(track: Track): Promise<boolean> {
    if (!track || !track.id) return false;
    try {
      const isLiked = await (window as any).api?.toggleLike?.(track);
      if (isLiked) {
        this.likedTrackIds.add(track.id);
        return true;
      } else {
        this.likedTrackIds.delete(track.id);
        return false;
      }
    } catch (err) {
      console.error('[LibraryManager] Toggle like error:', err);
      return false;
    }
  }

  /**
   * Sanatçıyı takip eder.
   */
  public async followArtist(artist: FollowedArtist): Promise<boolean> {
    if (!artist || !artist.id) return false;
    try {
      const ok = await (window as any).api?.followArtist?.(artist);
      if (ok) {
        this.followedArtistIds.add(artist.id);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[LibraryManager] Follow artist error:', err);
      return false;
    }
  }

  /**
   * Sanatçı takibini bırakır.
   */
  public async unfollowArtist(artistId: string): Promise<boolean> {
    if (!artistId) return false;
    try {
      const ok = await (window as any).api?.unfollowArtist?.(artistId);
      if (ok) {
        this.followedArtistIds.delete(artistId);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[LibraryManager] Unfollow artist error:', err);
      return false;
    }
  }

  /**
   * Sanatçı takip durumunu tersine çevirir (toggle).
   */
  public async toggleFollowArtist(artist: FollowedArtist): Promise<boolean> {
    if (!artist || !artist.id) return false;
    const isFollowed = this.isArtistFollowed(artist.id);
    if (isFollowed) {
      await this.unfollowArtist(artist.id);
      return false;
    } else {
      await this.followArtist(artist);
      return true;
    }
  }

  /**
   * Oynatıcı çubuğundaki kalp butonunun aktif/pasif durumunu günceller.
   */
  public updateLikeButtonUI(btnLike: HTMLButtonElement | null, currentTrack: Track | null): void {
    if (!btnLike) return;
    if (!currentTrack) {
      btnLike.classList.remove('liked');
      return;
    }
    const liked = this.likedTrackIds.has(currentTrack.id);
    btnLike.classList.toggle('liked', liked);
  }

  /**
   * "💜 Beğenilen Şarkılar" görünümünü yükler.
   */
  public async loadLiked(ctx: LibraryContext): Promise<void> {
    ctx.viewTitle.textContent = '💜 Beğenilen Şarkılar';
    try {
      const liked = (await (window as any).api?.getLikedTracks?.()) || [];
      this.likedTrackIds = new Set(liked.map((t: Track) => t.id));
      ctx.renderCards(liked, liked);
    } catch (err) {
      ctx.cardsGrid.innerHTML = '<div style="color:var(--text-muted); padding:20px;">Beğenilen şarkılar yüklenemedi.</div>';
    }
  }

  /**
   * "🕒 Son Çalınanlar" dinleme geçmişini yükler.
   */
  public async loadHistory(ctx: LibraryContext): Promise<void> {
    ctx.viewTitle.textContent = '🕒 Son Çalınanlar';
    try {
      const history = (await (window as any).api?.getHistory?.()) || [];
      ctx.renderCards(history, history);
    } catch (err) {
      ctx.cardsGrid.innerHTML = '<div style="color:var(--text-muted); padding:20px;">Geçmiş yüklenemedi.</div>';
    }
  }

  /**
   * "🎙️ Takip Edilen Sanatçılar" listesini yükler.
   */
  public async loadFollowedArtists(
    ctx: LibraryContext,
    onArtistClick: (browseId: string, artistName: string) => void
  ): Promise<void> {
    ctx.viewTitle.textContent = '🎙️ Takip Edilen Sanatçılar';
    try {
      const artists: FollowedArtist[] = (await (window as any).api?.getFollowedArtists?.()) || [];
      this.followedArtistIds = new Set(artists.map((a: FollowedArtist) => a.id));

      if (!artists.length) {
        ctx.cardsGrid.innerHTML = `
          <div class="empty-state-notice" style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 48px 16px;">
            <div style="font-size: 3rem; margin-bottom: 12px; filter: drop-shadow(0 0 16px rgba(236, 72, 153, 0.4));">🎙️</div>
            <div style="font-size: 1.15rem; font-weight: 700; color: #fff; margin-bottom: 8px;">Henüz takip ettiğin sanatçı yok</div>
            <div style="font-size: 0.9rem; max-width: 420px; margin: 0 auto; line-height: 1.5; color: var(--text-secondary);">
              Arama yaparak sanatçı sayfalarına gidebilir ve "Takip Et" butonu ile favori sanatçılarını buraya ekleyebilirsin.
            </div>
          </div>
        `;
        return;
      }

      ctx.cardsGrid.innerHTML = '';
      artists.forEach((art) => {
        const card = document.createElement('div');
        card.className = 'music-card browse-card artist-avatar-card';
        card.setAttribute('data-artist-id', art.id);
        card.setAttribute('data-browse', art.id);
        card.setAttribute('data-btype', 'artist');
        card.innerHTML = `
          <div class="card-thumb-wrap">
            <img class="card-thumb artist-avatar-thumb" src="${art.thumbnail || './logo.png'}" alt="${art.name}" loading="lazy" onerror="window.lupinThumb ? window.lupinThumb(this) : null" />
            <div class="card-play-overlay">
              <span class="browse-icon">👤</span>
            </div>
          </div>
          <div class="card-title" title="${art.name}" style="text-align: center;">${art.name}</div>
          <div class="card-artist" style="text-align: center; color: var(--accent-pink);">Sanatçı</div>
        `;
        card.addEventListener('click', () => {
          onArtistClick(art.id, art.name);
        });
        ctx.cardsGrid.appendChild(card);
      });
    } catch (err) {
      console.error('[LibraryManager] Load followed artists error:', err);
      ctx.cardsGrid.innerHTML = '<div style="color:var(--text-muted); padding:20px;">Sanatçılar yüklenemedi.</div>';
    }
  }

  /**
   * Gerçekten başlayan şarkıyı dinleme geçmişine kaydeder.
   */
  public addToHistory(track: Track | null | undefined): void {
    if (!track || !track.id) return;
    (window as any).api?.addToHistory?.(track);
  }
}

export const libraryManager = new LibraryManager();
