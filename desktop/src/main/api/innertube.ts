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
}

export interface SearchResult {
  songs: Song[];
  videos: Song[];
  albums: any[];
  artists: any[];
}

export interface PlayerResult extends Song {
  streamUrl?: string;
  lyrics?: string;
}

const BASE_URL = 'https://music.youtube.com/youtubei/v1';

export class InnerTubeService {
  private formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  private parseDuration(str: string): number {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
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

  private getThumbnail(thumbnails: any[]): string {
    if (!Array.isArray(thumbnails) || thumbnails.length === 0) return '';
    let url = thumbnails[thumbnails.length - 1]?.url || '';
    if (!url) return '';
    if (url.startsWith('//')) url = 'https:' + url;
    // Upgrade low resolution thumbnails to high resolution (540x540)
    url = url.replace(/=w\d+-h\d+/, '=w540-h540');
    url = url.replace(/=s\d+/, '=s540');
    return url;
  }

  public async request<T = any>(endpoint: string, body: Record<string, any>): Promise<T> {
    const payload = {
      context: {
        client: {
          hl: 'tr',
          gl: 'TR',
          clientName: 'WEB_REMIX',
          clientVersion: '1.20250801.00.00'
        }
      },
      ...body
    };

    const res = await fetch(`${BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`InnerTube request failed (${endpoint}): ${res.status}`);
    }

    return res.json() as Promise<T>;
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
      const parts = artist.split(/[•·]/).map((p: string) => p.trim()).filter(Boolean);
      const durIdx = parts.findIndex(p => /^\d+:\d{2}(:\d{2})?$/.test(p));
      if (durIdx !== -1) {
        duration = this.parseDuration(parts[durIdx]);
        parts.splice(durIdx, 1);
      }
      const nonMeta = parts.filter(p => !/^(video|şarkı|song|track|episode|bölüm|album|albüm)$/i.test(p) && !/\bgörüntüleme\b|\bviews\b/i.test(p));
      if (nonMeta.length >= 1) {
        artist = nonMeta[0];
        if (nonMeta.length >= 2) album = nonMeta[1];
      } else if (parts.length >= 1) {
        artist = parts[0];
      }
    }

    const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
      || r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbnail = this.getThumbnail(thumbs);

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

  public async search(query: string, filter: string = 'songs'): Promise<SearchResult> {
    const results: SearchResult = {
      songs: [],
      videos: [],
      albums: [],
      artists: []
    };

    if (!query || !query.trim()) return results;

    try {
      // songs filter param: 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D'
      const body: Record<string, any> = { query };
      if (filter === 'songs') {
        body.params = 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D';
      }

      const data: any = await this.request('search', body);
      const contents = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents
        || data?.contents?.sectionListRenderer?.contents
        || [];

      for (const section of contents) {
        // Shelf format (direct list of songs)
        const shelf = section.musicShelfRenderer;
        if (shelf && Array.isArray(shelf.contents)) {
          for (const item of shelf.contents) {
            const song = this.parseSongItem(item);
            if (song) results.songs.push(song);
          }
        }

        // ItemSection format (nested item list)
        const itemSection = section.itemSectionRenderer?.contents;
        if (Array.isArray(itemSection)) {
          for (const item of itemSection) {
            const song = this.parseSongItem(item);
            if (song) results.songs.push(song);
          }
        }

        // Top Card format
        const card = section.musicCardShelfRenderer;
        if (card) {
          const nav = card.title?.runs?.[0]?.navigationEndpoint;
          const videoId = nav?.watchEndpoint?.videoId;
          if (videoId) {
            const title = this.getText(card.title);
            const subtitle = this.getText(card.subtitle);
            const thumbs = card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
            const thumb = this.getThumbnail(thumbs);
            results.songs.unshift({
              id: videoId,
              title: title || 'Lupin Track',
              artist: subtitle.split(/[•·]/)[0]?.trim() || 'Lupin Music',
              thumbnail: thumb || './logo.png',
              duration: 0,
              durationFormatted: '--:--'
            });
          }
        }
      }
    } catch (err) {
      console.warn('[InnerTube] Search error:', err);
    }

    return results;
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
        body: JSON.stringify(payload)
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
      const thumbnail = this.getThumbnail(vd.thumbnail?.thumbnails);

      return {
        id: videoId,
        title: vd.title || 'Bilinmeyen Şarkı',
        artist: vd.author || 'Lupin Music',
        thumbnail: thumbnail || './logo.png',
        duration: durationSec,
        durationFormatted: this.formatDuration(durationSec),
        streamUrl: bestStream
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

  public async getRelatedTracks(videoId: string): Promise<Song[]> {
    if (!videoId) return [];
    try {
      const data: any = await this.request('next', {
        videoId,
        isAudioOnly: true
      });

      const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
      const queueRenderer = tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer;
      const playlistPanel = queueRenderer?.content?.playlistPanelRenderer;
      const items = playlistPanel?.contents || data?.continuationContents?.playlistPanelContinuation?.contents || [];

      const songs: Song[] = [];
      for (const item of items) {
        const r = item?.playlistPanelVideoRenderer;
        if (!r || !r.videoId) continue;
        if (r.videoId === videoId) continue; // Çalmakta olan şarkıyı atla

        const title = this.getText(r.title) || 'Lupin Track';
        let artist = this.getText(r.longBylineText) || this.getText(r.shortBylineText) || 'Lupin Audio';
        if (artist) {
          const parts = artist.split(/[•·]/).map((p: string) => p.trim()).filter(Boolean);
          artist = parts[0] || artist;
        }

        const durStr = this.getText(r.lengthText);
        const duration = this.parseDuration(durStr);
        const thumbs = r.thumbnail?.thumbnails;
        const thumbnail = this.getThumbnail(thumbs);

        songs.push({
          id: r.videoId,
          title,
          artist,
          thumbnail: thumbnail || `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
          duration,
          durationFormatted: duration > 0 ? this.formatDuration(duration) : (durStr || '--:--')
        });
      }

      if (songs.length > 0) {
        return songs;
      }
    } catch (err) {
      console.warn('[InnerTube] getRelatedTracks error:', err);
    }

    // Fallback: Eğer next boş dönerse popüler parçalardan yedek liste getir
    const fallback = await this.getExplore();
    return fallback.filter(s => s.id !== videoId);
  }
}

