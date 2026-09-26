export interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  thumbnail: string;
  duration: number;
  durationFormatted?: string;
  album?: string;
  albumId?: string;
  isVideo?: boolean;
  /** YouTube icerik turu (MUSIC_VIDEO_TYPE_* / 'video' gibi) — tur filtresi icin */
  type?: string;
}

export interface SearchResult {
  songs: Song[];
  videos: Song[];
  albums: BrowseItem[];
  artists: BrowseItem[];
  playlists: BrowseItem[];
}

/** Sanatci / album / oynatma listesi karti (tiklaninca detay acilir). */
export interface BrowseItem {
  browseId: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  type: 'artist' | 'album' | 'playlist';
  songCount?: number;
}

export interface BrowseDetail {
  type: 'artist' | 'album' | 'playlist';
  title: string;
  subtitle: string;
  thumbnail: string;
  songs: Song[];
}

export interface PlayerResult extends Song {
  streamUrl?: string;
  lyrics?: string;
  /** true = reklam ses akışına gömülü (reklam destekli parça) */
  isAdSupported?: boolean;
}

const BASE_URL = 'https://music.youtube.com/youtubei/v1';
const AD_SUPPORT_CACHE_MS = 90 * 1000;

export class InnerTubeService {
  /** videoId -> { at, isAdSupported } (kisa sureli onbellek) */
  private playerCache = new Map<string, { at: number; isAdSupported: boolean }>();

  /** O parca reklam destekli mi? (60 sn onbellek, aksi halde player'a sorar) */
  public async isAdSupported(videoId: string): Promise<boolean> {
    if (!videoId) return false;
    const hit = this.playerCache.get(videoId);
    if (hit && Date.now() - hit.at < AD_SUPPORT_CACHE_MS) return hit.isAdSupported;
    const info = await this.getPlayer(videoId);
    return !!info?.isAdSupported;
  }

  /**
   * Ayni sarki icin rekamsiz (ads-supported olmayan) kaynak bulur.
   * GUVENLI: kaynak degisimi yanlis sarki calinmasina yol acmamali. Aday
   * ancak (a) normalize basliklar ESIT, (b) sure farki <= 3 sn, (c) sanatci
   * eslesiyorsa kullanilir; aksi halde mevcut kaynakta kalinir (reklam
   * susturulur, yanlis sarki calinmaz).
   */
  public async findCleanSource(videoId: string, title: string, artist: string, duration = 0): Promise<string | null> {
    if (!videoId || !title) return null;
    const clean = title.replace(/\s*[([][^)\]]*[)\]]\s*$/g, '').replace(/\s*[-–|]\s*(official|video|lyrics?|audio)\s*$/i, '').trim();
    const queries = [`${clean} ${artist || ''}`.trim()];
    if (artist) queries.push(`${artist} ${clean}`.trim());

    const candidates: Song[] = [];
    for (const q of queries) {
      const res = await this.search(q, 'songs');
      candidates.push(...(res.songs || []));
      if (candidates.length >= 10) break;
    }

    const seen = new Set<string>([videoId]);
    const wantTitle = this.normalizeTitle(clean);
    const wantArtist = this.normalizeArtist(artist);
    for (const c of candidates) {
      if (!c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.isVideo) continue;

      // (a) baslik: normalize ESIT olmali (substring degil — "Ask" / "Ask Olsun" karismamali)
      if (this.normalizeTitle(c.title) !== wantTitle) continue;

      // (b) sure: ayni kayit olmali (canli/remix kayitlari elenir)
      if (duration > 0 && c.duration > 0) {
        const diff = Math.abs(c.duration - duration);
        if (diff > 3) continue;
      } else if (duration > 0 && (!c.duration || c.duration <= 0)) {
        continue;
      }

      // (c) sanatci: en az bir token eslesmeli
      if (wantArtist && !this.artistMatches(wantArtist, this.normalizeArtist(c.artist))) continue;

      if (await this.isAdSupported(c.id)) continue;
      console.log(`[InnerTube] clean source: ${videoId} -> ${c.id} ("${clean}" / ${c.artist} / ${c.duration}s)`);
      return c.id;
    }
    return null;
  }

  private normalizeTitle(title: string): string {
    return String(title || '')
      .toLocaleLowerCase('tr')
      .replace(/\((?:feat|ft|with)[^)]*\)/g, ' ')
      .replace(/[([][^)\]]*[)\]]/g, ' ')
      .replace(/\b(official|video|audio|lyrics?|lyric|hd|hq|remaster(?:ed)?|remix|live|explicit|clean|full|mono|stereo|4k|remastered)\b/gi, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeArtist(artist: string): string {
    return String(artist || '')
      .toLocaleLowerCase('tr')
      .replace(/\b(feat|ft|ve|and|&|x)\b/gi, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private artistMatches(want: string, got: string): boolean {
    if (!want || !got) return false;
    if (want === got) return true;
    const a = want.split(' ').filter((t) => t.length >= 3);
    const b = new Set(got.split(' '));
    return a.some((t) => b.has(t));
  }


  private formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  private parseDuration(str: string): number {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
    if (parts.some(p => isNaN(p))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  private getText(obj: any): string {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (obj.simpleText) return obj.simpleText;
    if (Array.isArray(obj.runs)) return obj.runs.map((r: any) => r.text || '').join('');
    return '';
  }

  private getThumbnail(thumbnails: any[], videoId?: string): string {
    if (!Array.isArray(thumbnails) || thumbnails.length === 0) return this.stableThumb(videoId);
    let url = thumbnails[thumbnails.length - 1]?.url || '';
    if (!url) return this.stableThumb(videoId);
    if (url.startsWith('//')) url = 'https:' + url;
    // yt3.googleusercontent.com imzali/imza zamanli adresler sonradan 404 verir
    // (kapak yerine logo gosterirdi) -> kalici ytimg adresine sabitlenir.
    if (/googleusercontent\.com/.test(url) && videoId) return this.stableThumb(videoId);
    // Upgrade low resolution thumbnails to high resolution (540x540)
    url = url.replace(/=w\d+-h\d+/, '=w540-h540');
    url = url.replace(/=s\d+/, '=s540');
    return url || this.stableThumb(videoId);
  }

  /** Her video icin gecerli kalici kapak adresi (hqdefault -> mqdefault zinciri). */
  private stableThumb(videoId?: string): string {
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
  }

  public async request<T = any>(endpoint: string, body: Record<string, any>, timeoutMs: number = 12000, hl: string = 'tr', gl: string = 'TR'): Promise<T> {
    const payload = {
      context: {
        client: {
          hl,
          gl,
          clientName: 'WEB_REMIX',
          clientVersion: '1.20250801.00.00'
        }
      },
      ...body
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Origin': 'https://music.youtube.com',
          'Referer': 'https://music.youtube.com/'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`InnerTube request failed (${endpoint}): ${res.status}`);
      }

      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseSongItem(item: any): Song | null {
    const r = item?.musicResponsiveListItemRenderer;
    if (!r) return null;

    const videoId = r.playlistItemData?.videoId
      || r.navigationEndpoint?.watchEndpoint?.videoId
      || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
      || '';

    if (!videoId) return null;

    const col0 = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const col1 = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const title = this.getText(col0) || 'İsimsiz Parça';
    let artist = this.getText(col1) || 'Lupin Music';

    let duration = 0;
    let album = '';

    if (artist) {
      const parts = artist.split(/[\u2022\u00B7]/).map((p: string) => p.trim()).filter(Boolean);
      const durIdx = parts.findIndex(p => /^\d+:\d{2}(:\d{2})?$/.test(p));
      if (durIdx !== -1) {
        duration = this.parseDuration(parts[durIdx]);
        parts.splice(durIdx, 1);
      }
      const nonMeta = parts.filter(p => !/^(video|ÅŸarkÄ±|song|track|episode|bÃ¶lÃ¼m|album|albÃ¼m)$/i.test(p) && !/\bgÃ¶rÃ¼ntÃ¼leme\b|\bviews\b/i.test(p));
      if (nonMeta.length >= 1) {
        artist = nonMeta[0];
        if (nonMeta.length >= 2) album = nonMeta[1];
      } else if (parts.length >= 1) {
        artist = parts[0];
      }
    }

    const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
      || r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbnail = this.getThumbnail(thumbs, videoId);

    return {
      id: videoId,
      title,
      artist,
      album,
      thumbnail: thumbnail || './logo.png',
      duration,
      durationFormatted: duration > 0 ? this.formatDuration(duration) : '--:--'
    };
  }

  /**
   * Arama: sarki + video versiyonu + sanatci + album + oynatma listesi.
   * songs+videos params tek istekte; carousel/immaturer afisleri de taranir.
   */
  public async search(query: string, filter: string = 'songs', includeVideos: boolean = false): Promise<SearchResult> {
    const results: SearchResult = {
      songs: [],
      videos: [],
      albums: [],
      artists: [],
      playlists: []
    };

    if (!query || !query.trim()) return results;

    try {
      // songs: EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D
      // videos: EgWKAQIQAWoUEAMQCBAJEAoQBQ%3D%3D
      const body: Record<string, any> = { query };
      if (filter === 'songs') {
        // YALNIZCA muzik: 'videos' params'i birlestirilirse YouTube video
        // sonuclarini da karisik getirir (kullanici sadece sarki istiyor).
        body.params = includeVideos
          ? 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D,EgWKAQIQAWoUEAMQCBAJEAoQBQ%3D%3D'
          : 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D';
      } else if (filter === 'videos') {
        body.params = 'EgWKAQIQAWoUEAMQCBAJEAoQBQ%3D%3D';
      }

      // Sanatci / album / oynatma listesi afisleri sadece 'videos' params'li
      // istekte geliyor. Bu yuzden iki istek PARALEL atilir: sarkilar yalnizca
      // songs isteğinden, browse kartlari videos isteğinden (sarki listesine
      // hicbir sey karismaz).
      const browseBody: Record<string, any> = { query, params: 'EgWKAQIQAWoUEAMQCBAJEAoQBQ%3D%3D' };
      const needBrowse = !includeVideos && filter === 'songs';
      const [data, browseData] = await Promise.all([
        this.request('search', body),
        needBrowse ? this.request('search', browseBody).catch(() => null) : Promise.resolve(null)
      ]);

      const sectionsOf = (d: any): any[] => (d?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.sectionListRenderer?.contents) || d?.contents?.sectionListRenderer?.contents || [];

      // Browse afisleri: sadece browseEndpoint tasiyan ogeler alinir
      if (browseData) {
        for (const section of sectionsOf(browseData)) {
          for (const item of (section.itemSectionRenderer?.contents || [])) {
            const browse = this.parseBrowseItem(item);
            if (!browse) continue;
            if (browse.type === 'artist') results.artists.push(browse);
            else if (browse.type === 'album') results.albums.push(browse);
            else results.playlists.push(browse);
          }
          const carousel = section.musicCarouselShelfRenderer
            || section.musicImmersiveCarouselShelfRenderer
            || section.musicMultiRowListItemRenderer?.musicCarouselShelfRenderer;
          if (carousel) this.parseCarousel(carousel, results);
        }
      }

      const contents = sectionsOf(data);
      for (const section of contents) {
        // Shelf (sarki listesi)
        const shelf = section.musicShelfRenderer;
        if (shelf && Array.isArray(shelf.contents)) {
          const videoShelf = /video|clip|official/i.test(this.getText(shelf.title));
          for (const item of shelf.contents) {
            const song = this.parseSongItem(item);
            if (!song) continue;
            if (videoShelf && includeVideos) {
              song.isVideo = true;
              results.videos.push(song);
            } else if (videoShelf) {
              // Video versiyonlari kapali: sadece sarki olarak alinir
              results.songs.push(song);
            } else {
              results.songs.push(song);
            }
          }
        }

        // ItemSection: sarki, sanatci, album ya da oynatma listesi
        const itemSection = section.itemSectionRenderer?.contents;
        if (Array.isArray(itemSection)) {
          for (const item of itemSection) {
            const browse = this.parseBrowseItem(item);
            if (browse) {
              if (browse.type === 'artist') results.artists.push(browse);
              else if (browse.type === 'album') results.albums.push(browse);
              else results.playlists.push(browse);
              continue;
            }
            const song = this.parseSongItem(item);
            if (!song) continue;
            if (song.isVideo && includeVideos) results.videos.push(song);
            else results.songs.push(song);
          }
        }

        const carousel = section.musicCarouselShelfRenderer
          || section.musicImmersiveCarouselShelfRenderer
          || section.musicMultiRowListItemRenderer?.musicCarouselShelfRenderer;
        if (carousel) this.parseCarousel(carousel, results);
      }
    } catch (err) {
      console.warn('[InnerTube] Search error:', err);
    }

    this.refineResults(results, query);
    return results;
  }

  /**
   * Sanatci / album / oynatma listesi karti. Arama sonuclarinda
   * musicResponsiveListItemRenderer + browseEndpoint bicimiyle gelir.
   */
  private parseBrowseItem(item: any): BrowseItem | null {
    const r = item?.musicResponsiveListItemRenderer;
    if (!r) return null;
    const browseId = r.navigationEndpoint?.browseEndpoint?.browseId || '';
    if (!browseId) return null;
    if (!/^(UC|MPRE|MPRA|VLPL|PL|MPSPPL|VLRDCL)/.test(browseId)) return null;

    const col0 = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const col1 = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const title = this.getText(col0) || 'Lupin Music';
    const subRuns = col1?.runs || [];
    const subtype = String(subRuns[0]?.text || '').trim();
    const subtitle = this.getText(col1);

    let type: BrowseItem['type'] = 'playlist';
    if (/^UC[\w-]{20,}$/.test(browseId)) type = 'artist';
    else if (/^(MPRE|MPRA|MPSPPL)/.test(browseId)) type = 'album';
    // Alt baslik daha guvenilir: "Album", "Single", "EP", "Playlist", "Artist"
    if (/playlist|çalmak listesi|oynatma listesi/i.test(subtype)) type = 'playlist';
    else if (/album|single|\bep\b/i.test(subtype)) type = 'album';
    else if (/artist|sanat/i.test(subtype)) type = 'artist';

    const cnt = subtitle.match(/(\d[\d.,]*)\s*(songs?|şarkı|parça)/i);
    const songCount = cnt ? parseInt(cnt[1].replace(/[.,]/g, ''), 10) : undefined;
    const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbnail = this.getThumbnail(thumbs) || './logo.png';

    return { browseId, title, subtitle, thumbnail, type, songCount };
  }

  /**
   * Browse yanitindaki tum sarki raflarini toplar.
   * Album/sanatci/liste sayfalarinda sarkilar `secondaryContents` altinda,
   * liste sayfasinda `musicPlaylistShelfRenderer` icinde gelir.
   */
  private collectBrowseSongs(data: any, out: Song[]): void {
    const seen = new Set(out.map((s) => s.id));
    const two = data?.contents?.twoColumnBrowseResultsRenderer;
    const lists: any[][] = [];
    const single = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (Array.isArray(single)) lists.push(single);
    const twoMain = two?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (Array.isArray(twoMain)) lists.push(twoMain);
    const twoSecondary = two?.secondaryContents?.sectionListRenderer?.contents;
    if (Array.isArray(twoSecondary)) lists.push(twoSecondary);
    const twoTabs = two?.tabs?.[0]?.tabRenderer?.content?.musicPlaylistShelfRenderer?.contents;
    if (Array.isArray(twoTabs)) lists.push(twoTabs.map((item: any) => ({ musicShelfRenderer: { contents: [item] } })));
    if (Array.isArray(two?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer?.contents)) {
      lists.push(two.secondaryContents.sectionListRenderer.contents[0].musicPlaylistShelfRenderer.contents
        .map((item: any) => ({ musicShelfRenderer: { contents: [item] } })));
    }

    for (const contents of lists) {
      for (const section of contents) {
        const items = section?.musicShelfRenderer?.contents || section?.musicPlaylistShelfRenderer?.contents;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const song = this.parseSongItem(item);
          if (!song || seen.has(song.id)) continue;
          seen.add(song.id);
          out.push(song);
        }
      }
    }
  }

  /** Browse yanitindaki ilk baslik renderer'ini bulur (album/sanatci/liste farkli derinlikte gelir). */
  private findBrowseHeader(data: any): any {
    const seen = new Set<any>();
    const walk = (node: any, depth: number): any => {
      if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return null;
      seen.add(node);
      for (const key of Object.keys(node)) {
        if (/HeaderRenderer$/.test(key) && node[key]) return node[key];
      }
      for (const key of Object.keys(node)) {
        const found = walk(node[key], depth + 1);
        if (found) return found;
      }
      return null;
    };
    return walk(data?.header, 0) || walk(data?.contents, 0) || null;
  }

  private countSongs(data: any): boolean {
    const tmp: Song[] = [];
    this.collectBrowseSongs(data, tmp);
    return tmp.length > 0;
  }

  /** Carousel icindeki album/sanatci/playlist kartlari. */
  private parseCarousel(carousel: any, results: SearchResult): void {
    const items = Array.isArray(carousel.contents) ? carousel.contents : [];
    for (const entry of items) {
      const m = entry?.musicTwoRowItemRenderer;
      if (!m) continue;
      const browseId = m.navigationEndpoint?.browseEndpoint?.browseId || '';
      if (!browseId) continue;
      const name = this.getText(m.title);
      const subtitle = this.getText(m.subtitle);
      const thumbs = m.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      const thumbnail = this.getThumbnail(thumbs);
      const cnt = subtitle.match(/(\d[\d.,]*)\s*(şarkı|songs|parça)/i);
      const songCount = cnt ? parseInt(cnt[1].replace(/\./g, ''), 10) : undefined;

      let type: BrowseItem['type'] = 'playlist';
      if (/^UC[\w-]{20,}$/.test(browseId)) type = 'artist';
      else if (/^(MPRE|MPRA)[\w-]+$/.test(browseId)) type = 'album';

      const item: BrowseItem = { browseId, title: name, subtitle, thumbnail, type, songCount };
      if (type === 'artist') results.artists.push(item);
      else if (type === 'album') results.albums.push(item);
      else results.playlists.push(item);
    }
  }

  /**
   * Alakasiz sonuclari temizler: tekillestirir, sorguyla ilgisiz "top card"
   * eklemez ve sorgu sanatci adini iceriyorsa ayni sanatcinin sarkilarini one alir.
   */
  private refineResults(results: SearchResult, query: string): void {
    const q = query.toLowerCase().trim();
    const seen = new Set<string>();
    const dedupe = (list: Song[]): Song[] => list.filter((s) => {
      const key = (s.id || '') + '|' + (s.title || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // TUR FILTRESI: reklam/sponsorlu, canli, short, bölüm/podcast ve video
    // etiketli oge arama sonucunda yer almaz.
    const JUNK = /\b(reklam|ad\b|ads?\b|sponsored|promoted|shorts?|live|canl[ıi]|podcast|b[öo]l[üu]m|episode|fragman|trailer|reaction|cover|remix|sped up|slowed)\b/i;
    const typeBad = (t: string) => /^(video|MUSIC_VIDEO_TYPE_)/i.test(t || '');
    results.songs = dedupe(results.songs).filter((t) => !t.isVideo && !typeBad(String(t.type || '')) && !JUNK.test(`${t.title} ${t.artist || ''}`) && !JUNK.test(t.album || ''));
    results.videos = dedupe(results.videos).filter((t) => !JUNK.test(`${t.title} ${t.artist || ''}`));

    const firstArtist = (results.songs[0]?.artist || '').toLowerCase();
    if (firstArtist && q.includes(firstArtist.split(/[\s,]+/)[0])) {
      results.songs.sort((a, b) => {
        const am = a.artist.toLowerCase() === firstArtist ? 0 : 1;
        const bm = b.artist.toLowerCase() === firstArtist ? 0 : 1;
        return am - bm;
      });
    }
    const dedupeBrowse = (list: BrowseItem[]): BrowseItem[] => {
      const ids = new Set<string>();
      return list.filter((b) => {
        if (!b.browseId || ids.has(b.browseId)) return false;
        ids.add(b.browseId);
        return true;
      }).slice(0, 8);
    };
    results.artists = dedupeBrowse(results.artists);
    results.albums = dedupeBrowse(results.albums);
    results.playlists = dedupeBrowse(results.playlists);
    results.songs = results.songs.slice(0, 25);
    results.videos = results.videos.slice(0, 12);
  }

  /**
   * Detay: sanatci / album / oynatma listesi sirasi.
   * Sanatci sayfasinda "singles" ve "albums" raflarinin sarkilari birlestirilir.
   */
  public async browse(browseId: string): Promise<BrowseDetail | null> {
    if (!browseId || !/^(UC|MPRE|MPRA|VLPL|PL)[\w-]+$/.test(browseId)) return null;
    // YouTube bazen ayni browseId'yi bos donuyor (hl/gl A/B): once TR, gerekirse EN
    try {
      let data: any = await this.request('browse', { browseId });
      if (!this.countSongs(data)) {
        data = await this.request('browse', { browseId }, 12000, 'en', 'US');
      }
      const header = this.findBrowseHeader(data);
      const micro = data?.microformat?.microformatDataRenderer;
      const title = this.getText(header?.musicDetailHeaderRenderer?.title)
        || this.getText(header?.musicImmersiveHeaderRenderer?.title)
        || this.getText(header?.musicVisualHeaderRenderer?.title)
        || this.getText(header?.musicResponsiveHeaderRenderer?.title)
        || this.getText(header?.musicEditablePlaylistDetailHeaderRenderer?.title)
        || this.getText(micro?.title)
        || 'Lupin Music';
      const subtitle = this.getText(header?.musicDetailHeaderRenderer?.subtitle)
        || this.getText(header?.musicImmersiveHeaderRenderer?.description)
        || this.getText(header?.musicResponsiveHeaderRenderer?.subtitle)
        || this.getText(micro?.description)
        || '';
      const thumbs = header?.musicDetailHeaderRenderer?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails
        || header?.musicImmersiveHeaderRenderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || header?.musicVisualHeaderRenderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || header?.musicResponsiveHeaderRenderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
        || micro?.thumbnail?.thumbnails;
      const thumbnail = this.getThumbnail(thumbs) || './logo.png';

      const type: BrowseDetail['type'] = /^UC[\w-]{20,}$/.test(browseId)
        ? 'artist'
        : (/^(MPRE|MPRA)[\w-]+$/.test(browseId) ? 'album' : 'playlist');

      const songs: Song[] = [];
      this.collectBrowseSongs(data, songs);
      if (!songs.length) {
        // Hic sarki gelmediyse EN context ile bir kez daha dene
        const alt: any = await this.request('browse', { browseId }, 12000, 'en', 'US');
        this.collectBrowseSongs(alt, songs);
      }
      if (!songs.length) return null;
      return { type, title, subtitle, thumbnail, songs: songs.slice(0, 60) };
    } catch (err) {
      console.warn('[InnerTube] Browse error:', err);
      return null;
    }
  }


  public async getPlayer(videoId: string): Promise<PlayerResult | null> {
    try {
      const payload = {
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
            clientVersion: '2.0'
          }
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true
      };

      const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        throw new Error(`TVHTML5 player failed: ${res.status}`);
      }

      const data: any = await res.json();
      const vd = data.videoDetails || {};
      const sd = data.streamingData || {};

      const formats = [...(sd.adaptiveFormats || []), ...(sd.formats || [])];
      // Filter for audio streams with direct URLs
      const audioStreams = formats
        .filter(f => f.url && (!f.width || f.mimeType?.includes('audio')))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      const bestStream = audioStreams[0]?.url;
      const durationSec = parseInt(vd.lengthSeconds || '0', 10);
      const thumbnail = this.getThumbnail(vd.thumbnail?.thumbnails, videoId);

      // Reklam destekli parça tespiti: bu parçalarda reklam SES AKIŞININ
      // içine gömülüdür, arayüzü gizlemek yetmez. İşaretler:
      //  - musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' (reklamlı müzik videosu)
      //  - adFormats / adStreamData / playerAds / adPlacements
      //  - mediaCommonConfig.mediaUstreamerRequestConfig (SABR reklam yolu)
      const isAdSupported = !!(vd.musicVideoType
        || sd.adFormats?.length
        || data.adStreamData
        || data.playerAds
        || data.adPlacements?.length
        || data.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig);

      this.playerCache.set(videoId, { at: Date.now(), isAdSupported });
      if (this.playerCache.size > 200) {
        const first = this.playerCache.keys().next().value;
        if (first) this.playerCache.delete(first);
      }

      return {
        id: videoId,
        title: vd.title || 'Bilinmeyen Şarkı',
        artist: vd.author || 'Lupin Music',
        thumbnail: thumbnail || './logo.png',
        duration: durationSec,
        durationFormatted: this.formatDuration(durationSec),
        streamUrl: bestStream,
        isAdSupported
      };
    } catch (err) {
      console.error('[InnerTube] getPlayer error:', err);
      return null;
    }
  }

  public async getExplore(): Promise<Song[]> {
    // Curated high quality trending music
    const res = await this.search('Trend Türkçe Pop Müzik', 'songs');
    if (res.songs.length >= 8) {
      return res.songs.slice(0, 24);
    }
    // Fallback
    const fallback = await this.search('Top Global Hits 2026', 'songs');
    return fallback.songs.slice(0, 24);
  }

  private parseRelatedPanel(data: any, videoId: string): Song[] {
    const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
    const queueRenderer = tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer;
    const playlistPanel = queueRenderer?.content?.playlistPanelRenderer;
    const items = playlistPanel?.contents || data?.continuationContents?.playlistPanelContinuation?.contents || [];

    const songs: Song[] = [];
    for (const item of items) {
      const r = item?.playlistPanelVideoRenderer;
      if (!r || !r.videoId) continue;
      if (r.videoId === videoId) continue; // Ã‡almakta olan ÅŸarkÄ±yÄ± atla

      const title = this.getText(r.title) || 'Lupin Track';
      let artist = this.getText(r.longBylineText) || this.getText(r.shortBylineText) || 'Lupin Audio';
      if (artist) {
        const parts = artist.split(/[\u2022\u00B7]/).map((p: string) => p.trim()).filter(Boolean);
        artist = parts[0] || artist;
      }

      const durStr = this.getText(r.lengthText);
      const duration = this.parseDuration(durStr);
      const thumbs = r.thumbnail?.thumbnails;
      const thumbnail = this.getThumbnail(thumbs, r.videoId);

      songs.push({
        id: r.videoId,
        title,
        artist,
        thumbnail: thumbnail || `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
        duration,
        durationFormatted: duration > 0 ? this.formatDuration(duration) : (durStr || '--:--')
      });
    }
    return songs;
  }

  public async getRelatedTracks(videoId: string): Promise<Song[]> {
    if (!videoId) return [];

    // Tohuma ozel YouTube Music radyo listesi: bos 'next' istegi yalnizca calan
    // parcai donerir (ayni sabit fallback listesine yol acardi); playlistId
    // (RDAMVM<id>) benzer tarz parcalari getirir. Bos donerse RD<id> denenir.
    for (const playlistId of [`RDAMVM${videoId}`, `RD${videoId}`]) {
      try {
        const data: any = await this.request('next', {
          videoId,
          playlistId,
          isAudioOnly: true
        });
        // Radyo listesi de ayni tur filtresinden gecer: reklam/spam, video
        // etiketli ve suresiz oge kuyruga girmez.
        const songs = this.parseRelatedPanel(data, videoId).filter((s) => this.isListenable(s));
        if (songs.length > 0) return songs;
      } catch (err) {
        console.warn('[InnerTube] getRelatedTracks error:', err);
      }
    }

    // Fallback: Eğer next boş dönerse popüler parçalardan yedek liste getir
    const fallback = await this.getExplore();
    return fallback.filter(s => s.id !== videoId && this.isListenable(s));
  }

  /**
   * Kuyruk/ara sonucuna girebilir mi? (MUST: reklam/spam ve eksik sure elenir)
   * Arama sonucu filtresiyle ayni kural.
   */
  private isListenable(t: Song): boolean {
    if (!t || !t.id || !t.title) return false;
    if (t.isVideo) return false;
    if (/^(video|MUSIC_VIDEO_TYPE_)/i.test(String(t.type || ''))) return false;
    const junk = /\b(reklam|ad\b|ads?\b|sponsored|promoted|shorts?|live|canlı|podcast|bölüm|episode|fragman|trailer|reaction|sped up|slowed)\b/i;
    if (junk.test(`${t.title} ${t.artist || ''} ${t.album || ''}`)) return false;
    return true;
  }
}

