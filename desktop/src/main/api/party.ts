import { randomBytes } from 'node:crypto';

/**
 * Lupin Music — Birlikte Dinle (party) servisi.
 * Spotify benzeri mantik:
 *  - Host odayi acar ve kendi oynattigi parcayi + kuyrugu + konumu her 2 sn'de
 *    relay'e yazar.
 *  - Katilimci odayi 2-3 sn'de bir okur, host'tan farkli parca/sure/oynatma
 *    durumunda kendini HOST'A gore hizalar (kendi sirasi degismez).
 *  - Katilimci elle parca degistirirse otomatik AYRILIR ("Partiden ayrildin"),
 *    host etkilenmez.
 * Relay yoksa (KV kurulu degilse) oda hizlari sessizce devre disi kalir,
 * eski davranis (deep link + konum) korunur.
 */

export interface PartyTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
}

export interface PartyState {
  room: string;
  hostId: string;
  hostName: string;
  track: PartyTrack | null;
  position: number;
  playing: boolean;
  queue: PartyTrack[];
  members: { id: string; name: string; joinedAt: number }[];
  listeners: number;
  updatedAt: number;
  youAreHost: boolean;
  closed: boolean;
}

export type PartyRole = 'off' | 'host' | 'follower';

export interface PartySnapshot {
  role: PartyRole;
  room: string;
  hostName: string;
  listeners: number;
  track: PartyTrack | null;
  position: number;
  playing: boolean;
  closed: boolean;
}

const RELAY = process.env.LUPIN_PARTY_RELAY || 'https://lupinmusic.vercel.app';
const HOST_PUSH_MS = 2000;
const FOLLOW_PULL_MS = 2500;
const DRIFT_TOLERANCE = 2.5;
const REQUEST_TIMEOUT = 6000;

export class PartyService {
  private clientId: string = randomBytes(6).toString('hex');
  private name: string = 'Misafir';
  private role: PartyRole = 'off';
  private room: string = '';
  private hostPushTimer: NodeJS.Timeout | null = null;
  private followTimer: NodeJS.Timeout | null = null;
  private getState: (() => { track: PartyTrack | null; position: number; playing: boolean; queue: PartyTrack[] }) | null = null;
  private onFollow: ((s: PartyState) => void) | null = null;
  private onSnapshot: ((s: PartySnapshot) => void) | null = null;
  private onClosed: (() => void) | null = null;
  private relayAvailable: boolean = true;

  public getRole(): PartyRole { return this.role; }
  public getRoom(): string { return this.room; }
  public getClientId(): string { return this.clientId; }

  public configure(opts: {
    getState: () => { track: PartyTrack | null; position: number; playing: boolean; queue: PartyTrack[] };
    onFollow: (s: PartyState) => void;
    onSnapshot: (s: PartySnapshot) => void;
    onClosed: () => void;
  }): void {
    this.getState = opts.getState;
    this.onFollow = opts.onFollow;
    this.onSnapshot = opts.onSnapshot;
    this.onClosed = opts.onClosed;
  }

  public setName(name: string): void { this.name = (name || 'Misafir').slice(0, 40); }

  private emit(): void {
    this.onSnapshot?.({
      role: this.role,
      room: this.room,
      hostName: '',
      listeners: 0,
      track: null,
      position: 0,
      playing: false,
      closed: false
    });
  }

  private async call(action: string, extra: Record<string, unknown> = {}): Promise<PartyState | null> {
    if (!this.room) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      const res = await fetch(`${RELAY}/api/room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, room: this.room, clientId: this.clientId, name: this.name, ...extra }),
        signal: controller.signal
      }).finally(() => clearTimeout(timer));
      if (res.status === 404) return { closed: true } as PartyState;
      if (!res.ok) {
        this.relayAvailable = false;
        return null;
      }
      this.relayAvailable = true;
      return await res.json() as PartyState;
    } catch {
      this.relayAvailable = false;
      return null;
    }
  }

  /** Odayi ac (host) ve periyodik durum gondermeye basla. */
  public async host(room?: string): Promise<boolean> {
    this.stopTimers();
    this.room = (room && /^[a-z0-9]{6,20}$/i.test(room) ? room : randomBytes(4).toString('hex')).toLowerCase();
    this.role = 'host';
    const first = await this.call('host', this.currentPayload());
    if (!first) {
      // Relay yoksa/erisilemiyorsa yine de oda kodunu ver: deep link yine calisir
      this.relayAvailable = false;
      this.emit();
      return false;
    }
    this.emit();
    this.hostPushTimer = setInterval(() => { this.call('host', this.currentPayload()).catch(() => {}); }, HOST_PUSH_MS);
    return true;
  }

  /** Odaya katil (follower). Basariliysa true. */
  public async join(room: string): Promise<boolean> {
    const code = String(room || '').toLowerCase();
    if (!/^[a-z0-9]{6,20}$/i.test(code)) return false;
    this.stopTimers();
    this.room = code;
    this.role = 'follower';
    const first = await this.call('join');
    if (!first || (first as { closed?: boolean }).closed) {
      this.leaveLocal();
      return false;
    }
    if (first.track) this.onFollow?.(first);
    this.emit();
    this.followTimer = setInterval(() => { this.pull().catch(() => {}); }, FOLLOW_PULL_MS);
    return true;
  }

  private async pull(): Promise<void> {
    const state = await this.call('state');
    if (!state) return;
    if (state.closed) { this.onClosed?.(); this.leaveLocal(); return; }
    if (state.updatedAt && Date.now() - state.updatedAt > 45000) { this.onClosed?.(); this.leaveLocal(); return; }
    this.onFollow?.(state);
  }

  /** Katilimci elle bir sey yapti (parca degistirdi): otomatik ayril. */
  public async leave(reason: 'manual' | 'host-left' | 'closed' = 'manual'): Promise<void> {
    if (this.role === 'off' || !this.room) { this.leaveLocal(); return; }
    const room = this.room;
    this.leaveLocal();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      await fetch(`${RELAY}/api/room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave', room, clientId: this.clientId, name: this.name, reason }),
        signal: controller.signal
      }).finally(() => clearTimeout(timer));
    } catch {}
  }

  private leaveLocal(): void {
    this.stopTimers();
    this.role = 'off';
    this.room = '';
    this.emit();
  }

  private stopTimers(): void {
    if (this.hostPushTimer) { clearInterval(this.hostPushTimer); this.hostPushTimer = null; }
    if (this.followTimer) { clearInterval(this.followTimer); this.followTimer = null; }
  }

  private currentPayload(): Record<string, unknown> {
    const s = this.getState?.() || { track: null, position: 0, playing: false, queue: [] };
    return {
      track: s.track,
      position: Math.max(0, Number(s.position) || 0),
      playing: !!s.playing,
      queue: (s.queue || []).slice(0, 20)
    };
  }

  /** Katilimciyi host'a gore hizala (renderer/IPC bunu cagirir). */
  public needsCorrection(state: PartyState, localTrackId: string, localPosition: number, localPlaying: boolean): PartySyncAction | null {
    if (!state.track) return null;
    if (state.track.id !== localTrackId) {
      return { type: 'track', track: state.track, position: state.position, playing: state.playing };
    }
    const drift = state.position - localPosition;
    if (state.playing && drift > DRIFT_TOLERANCE) {
      return { type: 'seek', position: state.position, playing: true };
    }
    if (state.playing !== localPlaying) {
      return { type: state.playing ? 'resume' : 'pause' };
    }
    return null;
  }

  public destroy(): void {
    this.leave('closed').catch(() => {});
    this.stopTimers();
  }
}

export type PartySyncAction =
  | { type: 'track'; track: PartyTrack; position: number; playing: boolean }
  | { type: 'seek'; position: number; playing: boolean }
  | { type: 'resume' }
  | { type: 'pause' };
