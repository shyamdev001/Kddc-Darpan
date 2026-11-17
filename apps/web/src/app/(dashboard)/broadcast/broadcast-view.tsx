"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BROADCAST_DEFAULT_MIN,
  BROADCAST_MESSAGE_MAX,
  BROADCAST_TITLE_MAX,
  isYoutubeHost,
  youtubeId,
  type BroadcastEntry,
  type BroadcastReach,
  type BroadcastKind,
  type BroadcastsResponse,
  type MediaItem,
  type StartBroadcastRequest,
} from "@darpan/shared";
import { Film, ImageIcon, Link2, Loader2, MessageSquareText, Radio, Square, VolumeX } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { fetchMediaPages } from "@/lib/media-pages";
import { cn } from "@/lib/utils";
import { TargetPicker, type Target } from "../schedules/controls";
import { whereText } from "../schedules/format";

const KINDS: { value: BroadcastKind; label: string; icon: typeof Radio }[] = [
  { value: "MESSAGE", label: "Message", icon: MessageSquareText },
  { value: "MEDIA", label: "Poster or video", icon: Film },
  { value: "LINK", label: "Live link", icon: Link2 },
];

// Every broadcast ends by itself (a forgotten one must not keep the ads off for good); Stop ends it sooner.
const DURATIONS = [
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
  { value: 480, label: "8 hours" },
  { value: 1440, label: "24 hours" },
];

const TIME = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const TIME_ONLY = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
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
  const confirm = useConfirm();
  const s = b.screens;

  async function stop() {
    const ok = await confirm({
      title: "Stop this broadcast?",
      description: "The screens go back to their playlists within a few seconds.",
      details: [
        { label: "Showing", value: headline(b) },
        { label: "On", value: whereText(b.level, b.target) },
      ],
      confirmLabel: "Stop broadcast",
      cancelLabel: "Keep it on",
      tone: "danger",
      icon: Square,
    });
    if (!ok) return;
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
  const [duration, setDuration] = useState(BROADCAST_DEFAULT_MIN);
  const [target, setTarget] = useState<Target>({ level: "ALL", targetId: "" });
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    if (kind !== "MEDIA" || media) return;
    fetchMediaPages()
      .then((r) => setMedia(r.items.filter((m) => m.status === "READY")))
      .catch(() => setMedia([]));
  }, [kind, media]);

  // A YouTube link plays in the TV's WebView, which some models lack or have too old: say so first.
  const isYoutube = kind === "LINK" && !!youtubeId(url);
  const reachKey = isYoutube && (target.level === "ALL" || target.targetId) ? `${target.level}:${target.targetId}` : null;
  const [reach, setReach] = useState<{ key: string; data: BroadcastReach } | null>(null);
  useEffect(() => {
    if (!reachKey) return;
    const params = new URLSearchParams({ level: target.level, ...(target.level === "ALL" ? {} : { targetId: target.targetId }) });
    let live = true;
    apiFetch<BroadcastReach>(`/api/broadcasts/reach?${params}`)
      .then((data) => live && setReach({ key: reachKey, data }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [reachKey, target.level, target.targetId]);
  const youtubeReach = reachKey && reach?.key === reachKey ? reach.data : null;

  const hint = kind === "LINK" ? linkHint(url) : null;
  const chosen = media?.find((m) => m.id === mediaId) ?? null;
  const ready =
    (target.level === "ALL" || !!target.targetId) &&
    (kind === "MESSAGE" ? !!message.trim() : kind === "MEDIA" ? !!mediaId : !!hint?.ok);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ends = TIME_ONLY.format(new Date(Date.now() + duration * 60_000));
    const what =
      kind === "MESSAGE"
        ? message.trim()
        : kind === "MEDIA"
          ? (chosen?.displayName ?? "Poster or video")
          : youtubeId(url)
            ? "YouTube video"
            : "Live stream";
    const ok = await confirm({
      title: target.level === "ALL" ? "Show this on every screen now?" : "Show this on the chosen screens now?",
      description: "It replaces the ads at once. You can stop it any time on this page.",
      details: [
        ...(title.trim() ? [{ label: "Heading", value: title.trim() }] : []),
        { label: "Showing", value: <span className="line-clamp-3">{what}</span> },
        { label: "On", value: target.level === "ALL" ? "Every screen" : (target.label ?? "The chosen place") },
        { label: "Until", value: `${ends} (${DURATIONS.find((d) => d.value === duration)?.label ?? `${duration} minutes`})` },
        ...(kind !== "MESSAGE" ? [{ label: "Sound", value: muted ? "Off" : "On" }] : []),
      ],
      confirmLabel: "Show on screens now",
      cancelLabel: "Not yet",
      tone: "alert",
      icon: Radio,
    });
    if (!ok) return;
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
      durationMin: duration,
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
          {youtubeReach && <YoutubeReachNote reach={youtubeReach} />}

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

/** Which chosen screens will not play this YouTube link. Nothing when all of them can. */
function YoutubeReachNote({ reach }: { reach: BroadcastReach }) {
  const no = reach.youtubeNo;
  if (!no.length && !reach.youtubeUnknown) return null;
  return (
    <div role="status" className="grid gap-1 rounded-md bg-haldi/15 px-3 py-2.5 text-sm text-[#6b4a00]">
      {no.length > 0 && (
        <>
          <p className="font-medium">
            {no.length === reach.screens
              ? "None of these screens can play YouTube."
              : `${no.length} of ${reach.screens} screens cannot play YouTube.`}{" "}
            They keep showing their ads instead.
          </p>
          <ul className="list-disc pl-5">
            {no.slice(0, 5).map((s) => (
              <li key={s.id}>
                {s.name} {s.reason}
              </li>
            ))}
            {no.length > 5 && <li>and {no.length - 5} more</li>}
          </ul>
        </>
      )}
      {reach.youtubeUnknown > 0 && (
        <p>
          {reach.youtubeUnknown} screen{reach.youtubeUnknown === 1 ? " has" : "s have"} not said yet whether they can (older app). Check
          one with a screenshot after starting.
        </p>
      )}
    </div>
  );
}
