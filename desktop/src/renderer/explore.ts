import type { Track } from '../types/index.js';
import {
  type CardActionHandlers,
  renderSongCardHtml,
  wireSongCards
} from './searchModal.js';

export interface ExploreContext {
  cardsGrid: HTMLDivElement;
  viewTitle: HTMLHeadingElement;
  handlers: CardActionHandlers;
  getBrowseGen: () => number;
  incrementBrowseGen: () => number;
}

/**
 * Dinleme geçmişi ve beğenilenlere göre tohumlanan "Sana Özel & Dinlediklerine Benzer"
 * ve küresel "Popüler Parçalar & Trendler" seçkilerini yükler.
 */
export async function loadExplore(ctx: ExploreContext): Promise<void> {
  const gen = ctx.incrementBrowseGen();
  ctx.viewTitle.textContent = '🔥 Keşfet — Popüler & Sana Özel';
  ctx.cardsGrid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">Lüks seçkiler yükleniyor...</div>';

  try {
    const api = (window as any).api;
    const [tracks, history, liked] = await Promise.all([
      api?.getExplore?.().catch(() => [] as Track[]) || Promise.resolve([] as Track[]),
      api?.getHistory?.().catch(() => [] as Track[]) || Promise.resolve([] as Track[]),
      api?.getLikedTracks?.().catch(() => [] as Track[]) || Promise.resolve([] as Track[])
    ]);

    if (gen !== ctx.getBrowseGen()) return;

    // Kullanıcının dinlediği şarkılar (geçmiş + beğenilenler) üzerinden kişiselleştirme
    const allSeeds: Track[] = [];
    const seedIds = new Set<string>();
    for (const t of (history || []).concat(liked || [])) {
      if (t && t.id && !seedIds.has(t.id)) {
        seedIds.add(t.id);
        allSeeds.push(t);
        if (allSeeds.length >= 6) break;
      }
    }

    let alternatives: Track[] = [];
    if (allSeeds.length) {
      const picked = new Set((tracks as Track[]).map((t: Track) => t.id));
      const seeds = allSeeds.slice(0, 3);
      const batches: Track[][] = await Promise.all(
        seeds.map((s: Track) => api?.getRelatedTracks?.(s.id).catch(() => [] as Track[]) || Promise.resolve([] as Track[]))
      );

      if (gen !== ctx.getBrowseGen()) return;

      const seen = new Set<string>();
      for (const batch of batches) {
        for (const t of batch || []) {
          if (!t || !t.id || picked.has(t.id) || seen.has(t.id)) continue;
          seen.add(t.id);
          alternatives.push(t as Track);
          if (alternatives.length >= 16) break;
        }
        if (alternatives.length >= 16) break;
      }
    }

    const sections: string[] = [];
    if (alternatives.length) {
      sections.push(`<div class="cards-section">
        <h3 class="cards-section-title">🎧 Sana Özel & Dinlediklerine Benzer</h3>
        <div class="cards-grid">${alternatives.map(renderSongCardHtml).join('')}</div>
      </div>`);
    }

    sections.push(`<div class="cards-section">
      <h3 class="cards-section-title">🔥 Popüler Parçalar & Trendler</h3>
      <div class="cards-grid">${(tracks as Track[]).map(renderSongCardHtml).join('')}</div>
    </div>`);

    ctx.cardsGrid.innerHTML = sections.join('');
    // Keşfet kartlarında isPlaylistContext = false: tıklanan şarkı tohum alınıp dinamik radyo başlar
    wireSongCards((tracks as Track[]).concat(alternatives), ctx.handlers, false);
  } catch (err) {
    if (gen !== ctx.getBrowseGen()) return;
    ctx.cardsGrid.innerHTML = '<div style="color:var(--text-muted); padding:20px;">Keşfet yüklenemedi.</div>';
  }
}
