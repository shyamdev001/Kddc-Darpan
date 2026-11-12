"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BROADCAST_MESSAGE_MAX,
  BROADCAST_TITLE_MAX,
  isYoutubeHost,
  youtubeId,
  type BroadcastEntry,
  type BroadcastKind,
  type BroadcastsResponse,
  type MediaItem,
  type MediaListResponse,
  type StartBroadcastRequest,
} from "@darpan/shared";
import { Film, ImageIcon, Link2, Loader2, MessageSquareText, Radio, Square, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { TargetPicker, type Target } from "../schedules/controls";
import { whereText } from "../schedules/format";

const KINDS: { value: BroadcastKind; label: string; icon: typeof Radio }[] = [
  { value: "MESSAGE", label: "Message", icon: MessageSquareText },
  { value: "MEDIA", label: "Poster or video", icon: Film },
  { value: "LINK", label: "Live link", icon: Link2 },
];

const DURATIONS = [
  { value: 0, label: "Until I stop it" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
  { value: 480, label: "8 hours" },
  { value: 1440, label: "24 hours" },
];

const TIME = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const textareaClass =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function BroadcastView() {
  const [data, setData] = useState<BroadcastsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<BroadcastsResponse>("/api/broadcasts")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Screens report every minute or when something changes; refresh the counts while one is running.
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="grid gap-8">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {data && data.active.length > 0 && (
        <section aria-labelledby="live-heading" className="grid gap-3">
          <h2 id="live-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
            </span>
            On screens now
          </h2>
          {data.active.map((b) => (
            <ActiveCard key={b.id} b={b} onChange={setData} />
          ))}
        </section>
      )}

      <StartForm onStarted={setData} />

      {data && data.recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="grid gap-3">
          <h2 id="recent-heading" className="text-lg font-semibold tracking-tight">
            Earlier broadcasts
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {data.recent.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <span className="w-32 shrink-0 text-sm text-muted-foreground tabular-nums">{TIME.format(new Date(b.startedAt))}</span>
                <span className="min-w-0 flex-1 font-medium">{headline(b)}</span>
                <span className="text-sm text-muted-foreground">{whereText(b.level, b.target)}</span>
                <span className="text-sm text-muted-foreground">{endedText(b)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function headline(b: BroadcastEntry): string {
  if (b.title) return b.title;
  if (b.kind === "MESSAGE") return b.message?.split("\n")[0] ?? "Message";
  if (b.kind === "MEDIA") return b.media?.name ?? "Poster or video";
  return b.isYoutube ? "YouTube broadcast" : "Live stream";
}

function endedText(b: BroadcastEntry): string {
  if (b.endedAt) return `Stopped ${TIME.format(new Date(b.endedAt))}${b.endedBy ? ` by ${b.endedBy}` : ""}`;
  if (b.endsAt) return `Ended ${TIME.format(new Date(b.endsAt))}`;
  return "";
}

function ActiveCard({ b, onChange }: { b: BroadcastEntry; onChange: (d: BroadcastsResponse) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = b.screens;

  async function stop() {
    if (!window.confirm(`Stop "${headline(b)}"? The screens go back to their playlists.`)) return;
    setPending(true);
    setError(null);
    try {
      onChange(await apiFetch<BroadcastsResponse>(`/api/broadcasts/${b.id}/stop`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  }

  return (
    <article className="grid gap-3 rounded-xl border border-l-4 border-l-destructive bg-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold tracking-tight">{headline(b)}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {whereText(b.level, b.target)}. Started {TIME.format(new Date(b.startedAt))}
            {b.startedBy ? ` by ${b.startedBy}` : ""}. {b.endsAt ? `Ends ${TIME.format(new Date(b.endsAt))}.` : "Runs until stopped."}
            {b.muted ? " Sound off." : ""}
          </p>
          {b.kind === "LINK" && b.url && <p className="mt-1 truncate text-sm text-muted-foreground">{b.url}</p>}
        </div>
        <Button variant="destructive" onClick={stop} disabled={pending} className="h-10 px-4">
          {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Square data-icon="inline-start" />}
          Stop broadcast
        </Button>
      </div>
      {s && (
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span>
            <strong className="font-semibold tabular-nums">{s.playing}</strong> of {s.total} showing it
          </span>
          {s.loading > 0 && <span className="text-muted-foreground">{s.loading} starting</span>}
          {s.error > 0 && <span className="text-destructive">{s.error} with a problem</span>}
          {s.waiting > 0 && <span className="text-muted-foreground">{s.waiting} offline or not reported yet</span>}
        </p>
      )}
      {b.problems.length > 0 && (
        <ul className="grid gap-0.5 text-sm text-destructive">
          {b.problems.map((p) => (
            <li key={p.screen + p.status}>
              {p.screen}: {p.status}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </article>
  );
}

function linkHint(url: string): { ok: boolean; text: string } | null {
  const u = url.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) return { ok: false, text: "Paste the full link, starting with https://" };
  if (isYoutubeHost(u)) {
    return youtubeId(u)
      ? { ok: true, text: "YouTube video. Plays in YouTube's own player on the TVs; live videos stay live." }
      : { ok: false, text: "This YouTube link is not one video. Open the live video itself, press Share and paste that link." };
  }
  if (/\.m3u8(\?|$)/i.test(u)) return { ok: true, text: "Live stream (HLS). Plays directly on the TVs." };
  return { ok: true, text: "Direct link. The TVs play it as a video or stream (MP4 or HLS work best)." };
}

function StartForm({ onStarted }: { onStarted: (d: BroadcastsResponse) => void }) {
  const [kind, setKind] = useState<BroadcastKind>("MESSAGE");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [url, setUrl] = useState("");
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [target, setTarget] = useState<Target>({ level: "ALL", targetId: "" });
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (kind !== "MEDIA" || media) return;
    apiFetch<MediaListResponse>("/api/media")
      .then((r) => setMedia(r.items.filter((m) => m.status === "READY")))
      .catch(() => setMedia([]));
  }, [kind, media]);

  const hint = kind === "LINK" ? linkHint(url) : null;
  const chosen = media?.find((m) => m.id === mediaId) ?? null;
  const ready =
    (target.level === "ALL" || !!target.targetId) &&
    (kind === "MESSAGE" ? !!message.trim() : kind === "MEDIA" ? !!mediaId : !!hint?.ok);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const where = target.level === "ALL" ? "every screen" : "the chosen screens";
    if (!window.confirm(`Show this on ${where} now? It replaces the ads until it is stopped${duration ? " or its time is up" : ""}.`)) return;
    setPending(true);
    setError(null);
    const body: StartBroadcastRequest = {
      kind,
      level: target.level,
      ...(target.level === "ALL" ? {} : { targetId: target.targetId }),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
      ...(kind === "MEDIA" ? { mediaId } : {}),
      ...(kind === "LINK" ? { url: url.trim() } : {}),
      ...(kind !== "MESSAGE" ? { muted } : {}),
      ...(duration ? { durationMin: duration } : {}),
    };
    try {
      onStarted(await apiFetch<BroadcastsResponse>("/api/broadcasts", { method: "POST", body: JSON.stringify(body) }));
      setTitle("");
      setMessage("");
      setUrl("");
      setMediaId("");
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError((err as Error).message);
    }
    setPending(false);
  }

  return (
    <section aria-labelledby="start-heading" className="rounded-xl border bg-card">
      <h2 id="start-heading" className="border-b px-4 py-3.5 text-lg font-semibold tracking-tight sm:px-5">
        Start a broadcast
      </h2>
      <form onSubmit={submit} className="grid gap-6 px-4 py-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid content-start gap-5">
          <div role="radiogroup" aria-label="What to show" className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                onClick={() => {
                  setKind(k.value);
                  setDone(false);
                }}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-lg border px-3.5 text-[15px] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  kind === k.value ? "border-ink bg-ink text-white" : "border-input bg-card text-muted-foreground hover:bg-mist hover:text-foreground",
                )}
              >
                <k.icon className="size-4" />
                {k.label}
              </button>
            ))}
          </div>

          {kind === "LINK" && (
            <div className="grid gap-1.5">
              <Label htmlFor="b-url">Link</Label>
              <Input
                id="b-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                inputMode="url"
                spellCheck={false}
                className="h-10 text-[15px]"
              />
              {hint && <p className={cn("text-sm", hint.ok ? "text-muted-foreground" : "text-destructive")}>{hint.text}</p>}
            </div>
          )}

          {kind === "MEDIA" && (
            <div className="grid gap-1.5">
              <Label htmlFor="b-media">Poster or video from Media</Label>
              <NativeSelect id="b-media" value={mediaId} onChange={(e) => setMediaId(e.target.value)} disabled={!media}>
                <option value="">{media ? (media.length ? "Choose one" : "Nothing in Media yet") : "Loading"}</option>
                {media?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.type === "VIDEO" ? "Video: " : "Poster: "}
                    {m.displayName}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">Upload it on the Media page first. Videos start at once; the TVs download them while playing.</p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="b-title">Heading {kind !== "MESSAGE" && <span className="font-normal text-muted-foreground">(optional)</span>}</Label>
            <Input
              id="b-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={BROADCAST_TITLE_MAX}
              placeholder={kind === "LINK" ? "Live: Prime Minister's address" : "Important notice"}
              className="h-10 text-[15px]"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="b-message">
              {kind === "MESSAGE" ? "Message" : "Text along the bottom"}
              {kind !== "MESSAGE" && <span className="font-normal text-muted-foreground"> (optional)</span>}
            </Label>
            <textarea
              id="b-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={BROADCAST_MESSAGE_MAX}
              rows={kind === "MESSAGE" ? 4 : 2}
              placeholder={kind === "MESSAGE" ? "આજે બપોરે 2 વાગ્યે શાખા બંધ રહેશે." : ""}
              className={textareaClass}
            />
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {message.length}/{BROADCAST_MESSAGE_MAX}
            </p>
          </div>

          <TargetPicker value={target} onChange={setTarget} idPrefix="b" />

          <div className="flex flex-wrap items-end gap-5">
            <div className="grid min-w-44 gap-1.5">
              <Label htmlFor="b-duration">How long</Label>
              <NativeSelect id="b-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {kind !== "MESSAGE" && (
              <label className="flex h-10 items-center gap-2 text-[15px]">
                <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} className="size-4 accent-neel" />
                Sound off
              </label>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {done && !error && <p className="text-sm text-ok">Sent. Online screens switch within a few seconds; offline ones when they reconnect.</p>}

          <div>
            <Button type="submit" disabled={!ready || pending} className="h-11 px-5 text-[15px]">
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Radio data-icon="inline-start" />}
              Show on screens now
            </Button>
          </div>
        </div>

        <Preview kind={kind} title={title} message={message} chosen={chosen} hint={hint} muted={muted} />
      </form>
    </section>
  );
}

/** Roughly what the TVs will show, so a typo is caught before it reaches every branch. */
function Preview({
  kind,
  title,
  message,
  chosen,
  hint,
  muted,
}: {
  kind: BroadcastKind;
  title: string;
  message: string;
  chosen: MediaItem | null;
  hint: { ok: boolean; text: string } | null;
  muted: boolean;
}) {
  return (
    <div className="grid content-start gap-2">
      <span className="text-sm font-medium">On the TV</span>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-ink text-white shadow-[0_0_0_6px_#1d2450]">
        {kind === "MESSAGE" ? (
          <div className="flex h-full flex-col justify-center gap-2 border-t-4 border-haldi px-5">
            <p className="text-[11px] font-semibold text-haldi">{title.trim() || "Important notice"}</p>
            <p className="line-clamp-5 text-[15px] leading-snug font-semibold whitespace-pre-line">{message.trim() || "Your message"}</p>
          </div>
        ) : (
          <>
            <div className="flex h-full items-center justify-center bg-black/60">
              {kind === "MEDIA" && chosen?.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={chosen.thumbUrl} alt="" className="h-full w-full object-contain" />
              ) : kind === "MEDIA" ? (
                <ImageIcon className="size-8 text-white/40" />
              ) : (
                <span className="px-6 text-center text-xs text-white/60">{hint?.ok ? hint.text.split(".")[0] : "Live video"}</span>
              )}
            </div>
            {title.trim() && (
              <span className="absolute top-2 left-2 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-semibold">{title.trim()}</span>
            )}
            {message.trim() && (
              <p className="absolute inset-x-0 bottom-0 truncate bg-ink/90 px-3 py-1.5 text-[11px] font-medium">{message.trim()}</p>
            )}
            {muted && <VolumeX className="absolute top-2 right-2 size-4 text-white/70" aria-label="Sound off" />}
          </>
        )}
      </div>
    </div>
  );
}
