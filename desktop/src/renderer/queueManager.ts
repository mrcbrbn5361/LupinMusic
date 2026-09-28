import type { Track } from '../types/index.js';

/** Ayni kaydin farkli video id'leri icin normalize anahtar. */
export function trackKey(t: { title?: string; artist?: string; duration?: number } | null | undefined): string {
  if (!t) return '';
  const norm = (v: string) => String(v || '')
    .toLocaleLowerCase('tr')
    .replace(/\b(official|video|audio|lyrics?|hd|hq|remaster(?:ed)?|live|explicit|full|mono|stereo)\b/gi, ' ')
    .replace(/[()\[\]]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  return norm(t.title || '') + '|' + norm(t.artist || '');
}

/** Dizi elemanlarini rastgele karistirir (Fisher-Yates). */
export function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class QueueManager {
  private queue: Track[] = [];
  private currentIndex: number = -1;
  private isShuffled: boolean = false;
  private shuffleOrder: number[] = [];
  private shufflePos: number = 0;
  private radioGen: number = 0;
  private isFetchingRelated: boolean = false;
  private lastRelatedVideoId: string = '';

  /** Kuyruk degistiginde UI ve parti sync'i tetiklemek icin dinleyici */
  public onQueueChanged?: () => void;

  constructor(initialShuffled: boolean = false) {
    this.isShuffled = initialShuffled;
  }

  public getQueue(): Track[] {
    return this.queue;
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  public setCurrentIndex(index: number): void {
    this.currentIndex = index;
    this.syncShufflePos();
  }

  public getCurrentTrack(): Track | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return null;
  }

  public getRadioGen(): number {
    return this.radioGen;
  }

  public incrementRadioGen(): number {
    this.radioGen += 1;
    this.lastRelatedVideoId = '';
    return this.radioGen;
  }

  public isShuffledMode(): boolean {
    return this.isShuffled;
  }

  public setShuffled(val: boolean): void {
    this.isShuffled = val;
    if (this.isShuffled) {
      this.rebuildShuffleOrder();
    } else {
      this.shuffleOrder = [];
      this.shufflePos = 0;
    }
  }

  public toggleShuffle(): boolean {
    this.setShuffled(!this.isShuffled);
    return this.isShuffled;
  }

  /** Karisik mod acildiginda / kuyruk yenilendiginde calinma sirasini kurar. */
  public rebuildShuffleOrder(): void {
    if (this.currentIndex < 0 || this.queue.length === 0) {
      this.shuffleOrder = [];
      this.shufflePos = 0;
      return;
    }
    const rest = this.queue.map((_, i) => i).filter((i) => i !== this.currentIndex);
    this.shuffleOrder = [this.currentIndex, ...shuffled(rest)];
    this.shufflePos = 0;
  }

  public syncShufflePos(): void {
    if (!this.isShuffled) return;
    const pos = this.shuffleOrder.indexOf(this.currentIndex);
    if (pos !== -1) {
      this.shufflePos = pos;
    } else {
      this.shuffleOrder.splice(this.shufflePos + 1, 0, this.currentIndex);
      this.shufflePos += 1;
    }
  }

  /** Siradaki parcanin kuyruk indexi; sonda ise -1. */
  public orderedNextIndex(): number {
    if (this.queue.length === 0 || this.currentIndex < 0) return -1;
    if (this.isShuffled) {
      return this.shufflePos + 1 < this.shuffleOrder.length ? this.shuffleOrder[this.shufflePos + 1] : -1;
    }
    return this.currentIndex + 1 < this.queue.length ? this.currentIndex + 1 : -1;
  }

  /** Onceki parcanin kuyruk indexi; basta ise -1. */
  public orderedPrevIndex(): number {
    if (this.queue.length === 0 || this.currentIndex < 0) return -1;
    if (this.isShuffled) {
      return this.shufflePos > 0 ? this.shuffleOrder[this.shufflePos - 1] : -1;
    }
    return this.currentIndex - 1 >= 0 ? this.currentIndex - 1 : -1;
  }

  /** Tekil parca ile temiz bir tohum kuyrugu baslatir. */
  public setSingleTrack(track: Track): void {
    this.queue = [{ ...track, source: 'pick' }];
    this.currentIndex = 0;
    if (this.isShuffled) {
      this.shuffleOrder = [0];
      this.shufflePos = 0;
    } else {
      this.shuffleOrder = [];
      this.shufflePos = 0;
    }
    this.onQueueChanged?.();
  }

  /** Liste baglamiyla (begendikler, yerel playlist vb.) kuyrugu baslatir. */
  public setQueueContext(tracks: Track[], activeTrack: Track): void {
    this.queue = tracks.map((t) => ({ ...t, source: 'pick' }));
    const idx = this.queue.findIndex((t) => t.id === activeTrack.id);
    this.currentIndex = idx !== -1 ? idx : 0;
    if (this.isShuffled) {
      this.rebuildShuffleOrder();
    } else {
      this.shuffleOrder = [];
      this.shufflePos = 0;
    }
    this.onQueueChanged?.();
  }

  /** Parçayı sıranın hemen sonrasına ekle (Spotify "sıraya ekle"). */
  public insertNext(track: Track): { at: number; isDuplicate: boolean } {
    if (!track || !track.id) return { at: -1, isDuplicate: false };
    const key = trackKey(track);
    let isDuplicate = false;
    const dup = this.queue.findIndex((t, i) => i !== this.currentIndex && trackKey(t) === key);
    if (dup >= 0) {
      this.queue.splice(dup, 1);
      if (dup <= this.currentIndex) this.currentIndex -= 1;
      isDuplicate = true;
    }
    const at = Math.max(0, this.currentIndex + 1);
    this.queue.splice(at, 0, { ...track, source: 'pick' });

    if (this.isShuffled) {
      for (let i = 0; i < this.shuffleOrder.length; i++) {
        if (this.shuffleOrder[i] >= at) this.shuffleOrder[i] += 1;
      }
      const pos = this.shuffleOrder.indexOf(this.currentIndex);
      this.shuffleOrder.splice(pos === -1 ? this.shuffleOrder.length : pos + 1, 0, at);
      this.shufflePos = this.shuffleOrder.indexOf(this.currentIndex);
    }

    this.trimQueueHead();
    this.onQueueChanged?.();
    return { at, isDuplicate };
  }

  /** Motorun kendi kendine gectigi (kuyruk disi) parcayi siraya isler. */
  public insertAdopted(track: Track): number {
    const at = this.currentIndex + 1;
    this.queue.splice(at, 0, { ...track, source: 'radio' });
    if (this.isShuffled) {
      this.shuffleOrder = this.shuffleOrder.map((x) => (x >= at ? x + 1 : x));
      this.shuffleOrder.splice(this.shufflePos + 1, 0, at);
      this.shufflePos += 1;
    }
    this.currentIndex = at;
    this.trimQueueHead();
    this.onQueueChanged?.();
    return at;
  }

  /** Radyo parcalarini SADECE kuyruk sonuna ekler; mevcut siralamayi bozmaz. */
  public appendRadioTracks(tracks: Track[]): number[] {
    const added: number[] = [];
    const existingIds = new Set(this.queue.map((t) => t.id));
    for (const t of tracks) {
      if (!t || !t.id || existingIds.has(t.id)) continue;
      existingIds.add(t.id);
      this.queue.push({ ...t, source: 'radio' });
      added.push(this.queue.length - 1);
    }
    if (added.length > 0 && this.isShuffled) {
      for (const i of shuffled(added)) this.shuffleOrder.push(i);
    }
    this.trimQueueHead();
    if (added.length > 0) {
      console.log(`[QueueManager] radio +${added.length} (queue=${this.queue.length})`);
      this.onQueueChanged?.();
    }
    return added;
  }

  /** Kuyruk cok buyurse geride kalan calinmis basi budar (en fazla 50 kayit). */
  public trimQueueHead(): void {
    if (this.currentIndex > 50) {
      const drop = this.currentIndex - 50;
      this.queue.splice(0, drop);
      this.currentIndex -= drop;
      if (this.isShuffled) {
        this.shuffleOrder = this.shuffleOrder.map((x) => x - drop).filter((x) => x >= 0);
        const pos = this.shuffleOrder.indexOf(this.currentIndex);
        this.shufflePos = pos !== -1 ? pos : 0;
      }
    }
  }

  /** Taze radyo onerilerini InnerTube API'sinden ceker. */
  public async fetchRelatedFresh(videoId: string): Promise<Track[]> {
    try {
      let related = await (window as any).api?.getRelatedTracks?.(videoId);
      if (!Array.isArray(related) || related.length === 0) {
        related = await (window as any).api?.getExplore?.();
      }
      if (Array.isArray(related)) {
        const recentIds = new Set(this.queue.slice(Math.max(0, this.currentIndex - 30)).map((t) => t.id));
        let filtered = related.filter((t: Track) => t && t.id && !recentIds.has(t.id));
        if (filtered.length === 0) {
          filtered = related.filter((t: Track) => t && t.id && t.id !== videoId);
        }
        return filtered;
      }
    } catch (err) {
      console.warn('[QueueManager] Fetch related tracks error:', err);
    }
    return [];
  }

  /** Yeni secilen parca icin radyo listesini kurar. */
  public async attachRadio(seed: Track, gen: number): Promise<void> {
    const fresh = await this.fetchRelatedFresh(seed.id);
    if (gen !== this.radioGen) return;
    if (!this.queue.some((t) => t.id === seed.id)) return;
    if (fresh.length === 0) console.warn('[QueueManager] radio fetch empty for', seed.id);
    this.appendRadioTracks(fresh);
  }

  /** Sira sonuna yaklasinca radyo sessizce uzatilir. */
  public async ensureRadioAhead(currentTrack: Track | null): Promise<void> {
    if (!currentTrack || this.isFetchingRelated) return;
    if (this.queue.length - this.currentIndex > 3) return;
    if (this.lastRelatedVideoId === currentTrack.id) return;
    this.isFetchingRelated = true;
    try {
      const seed = currentTrack;
      const gen = this.radioGen;
      const before = this.queue.length;
      await this.attachRadio(seed, gen);
      if (this.queue.length === before) return;
      this.lastRelatedVideoId = seed.id;
    } finally {
      this.isFetchingRelated = false;
    }
  }

  /** Sira tukendiginde son bir uzatma denemesi; eklenirse true doner. */
  public async extendRadioNow(currentTrack: Track | null): Promise<boolean> {
    if (!currentTrack) return false;
    const gen = this.radioGen;
    try {
      let fresh = await this.fetchRelatedFresh(currentTrack.id);
      if (fresh.length === 0) {
        const explore = await (window as any).api?.getExplore?.();
        if (Array.isArray(explore)) {
          fresh = explore.filter((t: Track) => t && t.id && t.id !== currentTrack?.id);
        }
      }
      if (gen !== this.radioGen || fresh.length === 0) return false;
      this.lastRelatedVideoId = currentTrack.id;
      return this.appendRadioTracks(fresh).length > 0;
    } catch {
      return false;
    }
  }

  /** Parti senkronizasyonu icin yaklasan parcalari listeler. */
  public getUpcomingTracks(limit: number = 8): Array<{ id: string; title: string; artist: string; duration: number }> {
    return this.queue
      .slice(this.currentIndex + 1, this.currentIndex + 1 + limit)
      .map((t) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration || 0 }));
  }

  public clear(): void {
    this.queue = [];
    this.currentIndex = -1;
    this.shuffleOrder = [];
    this.shufflePos = 0;
    this.onQueueChanged?.();
  }
}
