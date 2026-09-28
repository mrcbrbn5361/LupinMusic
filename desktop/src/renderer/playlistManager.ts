import type { Track } from '../types/index.js';
import { esc, sectionHtml } from './searchModal.js';

export interface LocalPlaylist {
  id: string;
  name: string;
  createdAt: number;
  tracks: Track[];
}

export interface PlaylistContext {
  cardsGrid: HTMLDivElement;
  viewTitle: HTMLHeadingElement;
  renderCards: (tracks: Track[], queueContext?: Track[]) => void;
  showToast: (msg: string) => void;
  getBrowseGen: () => number;
  incrementBrowseGen: () => number;
}

export class PlaylistManager {
  /**
   * Yerel çalma listesi kartının HTML şablonu.
   */
  public renderLocalPlaylistCard(item: { browseId: string; title: string; subtitle: string; thumbnail: string }): string {
    return `
      <div class="music-card browse-card local-playlist-card" data-browse="${esc(item.browseId)}">
        <div class="card-thumb-wrap">
          <img src="${esc(item.thumbnail || './logo.png')}" data-thumb="${esc(item.thumbnail || '')}" class="card-thumb" alt="${esc(item.title)}" loading="lazy" onerror="lupinThumb(this)" />
          <div class="card-play-overlay"><span class="browse-icon">📀</span></div>
          <button class="playlist-delete" title="Listeyi sil">🗑</button>
        </div>
        <div class="card-title">${esc(item.title)}</div>
        <div class="card-artist">${esc(item.subtitle)}</div>
      </div>`;
  }

  /**
   * Kullanıcının kaydettiği tüm yerel çalma listelerini getirir ve DOM'a basar.
   */
  public async loadPlaylists(ctx: PlaylistContext, openId?: string): Promise<void> {
    ctx.viewTitle.textContent = '📀 Listelerim';
    const lists: LocalPlaylist[] = (await (window as any).api?.getPlaylists?.()) || [];
    if (!lists.length) {
      ctx.cardsGrid.innerHTML = `<div style="color:var(--text-secondary); padding:24px;">Henüz listen yok.<br/>Sıradaki şarkılardan <b>"💾 Kaydet"</b> ile ilk listeni oluştur.</div>`;
      return;
    }

    // Belirli bir liste açılmak istendiyse doğrudan içeriğini göster
    if (openId) {
      const pl = lists.find((p) => p.id === openId);
      if (pl) return this.openLocalPlaylist(pl, ctx);
    }

    const cards = lists.map((pl) => ({
      browseId: `local:${pl.id}`,
      title: pl.name,
      subtitle: `${pl.tracks.length} şarkı`,
      thumbnail: pl.tracks[0]?.thumbnail || './logo.png',
      type: 'local' as const
    }));

    ctx.cardsGrid.innerHTML = sectionHtml(
      '📀 Listelerim',
      cards.map((c) => this.renderLocalPlaylistCard(c)),
      (x) => x,
      'local'
    );

    document.querySelectorAll('.local-playlist-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        const id = (el.getAttribute('data-browse') || '').replace(/^local:/, '');
        const isDelete = (e.target as HTMLElement).closest('.playlist-delete');
        if (isDelete && id) {
          e.stopPropagation();
          this.deleteLocalPlaylist(id, ctx);
          return;
        }
        if (id) this.openLocalPlaylist(id, ctx);
      });
    });
  }

  /**
   * Seçilen yerel çalma listesinin şarkılarını listeler.
   */
  public async openLocalPlaylist(plOrId: LocalPlaylist | string, ctx: PlaylistContext): Promise<void> {
    const lists: LocalPlaylist[] = (await (window as any).api?.getPlaylists?.()) || [];
    const pl = typeof plOrId === 'string' ? lists.find((p) => p.id === plOrId) : plOrId;
    if (!pl) {
      this.loadPlaylists(ctx);
      return;
    }
    const fresh = lists.find((p) => p.id === pl.id) || pl;
    ctx.viewTitle.textContent = `📀 ${fresh.name}`;
    if (!fresh.tracks.length) {
      ctx.cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:24px;">Bu liste boş.</div>';
      return;
    }
    ctx.renderCards(fresh.tracks, fresh.tracks);
    const wrap = document.createElement('div');
    wrap.className = 'browse-back-wrap';
    wrap.innerHTML = '<button id="btnBrowseBack" class="ctrl-btn">← Listelerim</button>';
    ctx.cardsGrid.appendChild(wrap);
    document.getElementById('btnBrowseBack')?.addEventListener('click', () => {
      ctx.incrementBrowseGen();
      this.loadPlaylists(ctx);
    });
  }

  /**
   * Yerel çalma listesini siler.
   */
  public async deleteLocalPlaylist(id: string, ctx: PlaylistContext): Promise<boolean> {
    const ok = await (window as any).api?.deletePlaylist?.(id);
    if (ok) {
      ctx.showToast('🗑 Liste silindi');
      this.loadPlaylists(ctx);
      return true;
    }
    return false;
  }

  /**
   * Sıradaki şarkılardan yeni bir yerel çalma listesi oluşturup kaydeder.
   */
  public async createPlaylistFromQueue(name: string, tracks: Track[]): Promise<LocalPlaylist | null> {
    const cleanTracks = tracks
      .filter((t) => t && t.id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album || '',
        thumbnail: t.thumbnail || '',
        duration: t.duration || 0
      }));

    if (!cleanTracks.length) return null;
    const finalName = name.trim().slice(0, 60) || `Listem • ${new Date().toLocaleDateString('tr-TR')}`;
    return await (window as any).api?.createPlaylist?.({ name: finalName, tracks: cleanTracks });
  }

  /**
   * "Sırayı Kaydet" butonu dinleyicisini bağlar.
   */
  public setupSaveQueueButton(
    btnSaveQueue: HTMLButtonElement | null,
    queueSaveName: HTMLInputElement | null,
    getQueue: () => Track[],
    showToast: (msg: string) => void
  ): void {
    if (!btnSaveQueue) return;
    btnSaveQueue.addEventListener('click', async () => {
      const q = getQueue();
      if (!q.length) {
        showToast('⚠️ Sıra boş, kaydedilecek şarkı yok');
        return;
      }
      const rawName = queueSaveName?.value || '';
      const pl = await this.createPlaylistFromQueue(rawName, q);
      if (pl) {
        if (queueSaveName) queueSaveName.value = '';
        showToast(`💾 "${pl.name}" kaydedildi (${pl.tracks.length} şarkı)`);
      } else {
        showToast('⚠️ Liste kaydedilemedi');
      }
    });
  }
}

export const playlistManager = new PlaylistManager();
