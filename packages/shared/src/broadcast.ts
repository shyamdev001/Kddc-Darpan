import type { ManifestItem } from './device-protocol';
import type { PlaylistSource } from './screen';

/**
 * Broadcasts take over screens at once: an urgent message, a poster or video from the media
 * library, or a live stream (YouTube or a direct .m3u8 / .mp4 link). The newest one that applies
 * to a screen wins; the playlists carry on where they were when it ends.
 */
export const BROADCAST_KINDS = ['MESSAGE', 'MEDIA', 'LINK'] as const;
export type BroadcastKind = (typeof BROADCAST_KINDS)[number];

export const BROADCAST_TITLE_MAX = 80;
export const BROADCAST_MESSAGE_MAX = 500;

/** What the TV needs to show a broadcast. */
export interface ManifestBroadcast {
  id: string;
  kind: BroadcastKind;
  title: string | null;
  /** Full text for MESSAGE; a strip along the bottom for MEDIA and LINK. */
  message: string | null;
  /** MEDIA: the file, downloaded like any playlist item. */
  media: ManifestItem | null;
  /** LINK: 'youtube' plays in YouTube's own player; 'stream' plays the url directly. */
  link: { type: 'youtube'; youtubeId: string } | { type: 'stream'; url: string } | null;
  muted: boolean;
  /** ISO time it ends by itself; null = until stopped. */
  endsAt: string | null;
}

/** How each screen under a broadcast is doing, from the TVs' heartbeats. */
export interface BroadcastScreenCount {
  /** Screens it applies to (paired). */
  total: number;
  playing: number;
  loading: number;
  error: number;
  /** Offline, or not yet reported. */
  waiting: number;
}

export interface BroadcastEntry {
  id: string;
  kind: BroadcastKind;
  title: string | null;
  message: string | null;
  media: { id: string; name: string; type: 'IMAGE' | 'VIDEO' } | null;
  url: string | null;
  isYoutube: boolean;
  muted: boolean;
  level: PlaylistSource;
  target: { id: string; name: string } | null;
  startedAt: string;
  endsAt: string | null;
  endedAt: string | null;
  startedBy: string | null;
  endedBy: string | null;
  active: boolean;
  /** Only for active broadcasts. */
  screens: BroadcastScreenCount | null;
  /** Error texts reported by screens, with screen names (first few). */
  problems: { screen: string; status: string }[];
}

export interface BroadcastsResponse {
  active: BroadcastEntry[];
  recent: BroadcastEntry[];
}

export interface StartBroadcastRequest {
  kind: BroadcastKind;
  level: PlaylistSource;
  targetId?: string;
  title?: string;
  message?: string;
  mediaId?: string;
  url?: string;
  muted?: boolean;
  /** Minutes until it ends by itself; omitted = until stopped. */
  durationMin?: number;
}

/**
 * The YouTube video id in a link, or null. Accepts watch, live, embed and shorts links and youtu.be.
 * A channel's "/live" page has no video id: the person must open the live video and copy its link.
 */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const ok = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  if (host === 'youtu.be') return ok(u.pathname.split('/')[1]);
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (u.pathname === '/watch') return ok(u.searchParams.get('v'));
  const m = /^\/(live|embed|shorts|v)\/([^/?#]+)/.exec(u.pathname);
  return ok(m?.[2]);
}

export function isYoutubeHost(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return /(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$|^youtu\.be$/.test(host);
  } catch {
    return false;
  }
}
