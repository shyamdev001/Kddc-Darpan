import type { ScreenSummary } from "@darpan/shared";
import { cn } from "@/lib/utils";

/**
 * A tiny TV: shows the poster it last reported playing, and a power light that is lit (haldi)
 * while the screen is online. Portrait screens are drawn standing up.
 */
export function ScreenGlyph({ screen, size = "md" }: { screen: Pick<ScreenSummary, "online" | "paired" | "orientation" | "nowPlaying">; size?: "md" | "lg" }) {
  const portrait = screen.orientation === "PORTRAIT";
  const box = size === "lg" ? (portrait ? "h-40 aspect-[9/16]" : "w-64 aspect-video") : portrait ? "h-14 aspect-[9/16]" : "w-[88px] aspect-video";

  return (
    <div className={cn("flex shrink-0 items-center justify-center", size === "md" && "w-[88px]")} aria-hidden>
      <div className={cn("rounded-[5px] bg-[#0b0f24] ring-1 ring-ink/10", size === "lg" ? "p-2" : "p-[3px]")}>
        <div className={cn("relative flex items-center justify-center overflow-hidden rounded-[3px] bg-ink", box, !screen.online && "opacity-60 grayscale")}>
          {screen.online && screen.nowPlaying ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
            <img src={`/api/media/${screen.nowPlaying.id}/thumbnail`} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="size-1 rounded-full bg-white/15" />
          )}
        </div>
        <div className={cn("flex justify-end", size === "lg" ? "px-0.5 pt-1.5" : "pt-[2px] pr-[1px]")}>
          <span
            className={cn(
              "rounded-full",
              size === "lg" ? "size-[5px]" : "size-[3px]",
              screen.online ? "bg-haldi shadow-[0_0_6px_1px_rgba(224,165,38,0.7)]" : screen.paired ? "bg-white/25" : "bg-white/25 animate-pulse",
            )}
          />
        </div>
      </div>
    </div>
  );
}

/** "Online", "Offline, last seen 2 h ago", or "Needs pairing", as text with a coloured dot. */
export function ScreenStatusText({ screen, ago }: { screen: Pick<ScreenSummary, "online" | "paired">; ago: string | null }) {
  if (!screen.paired) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-[#8a5a00]">
        <span className="size-2 rounded-full bg-haldi" />
        Needs pairing again
      </span>
    );
  }
  if (screen.online) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-ok">
        <span className="size-2 rounded-full bg-ok" />
        Online
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="size-2 rounded-full bg-muted-foreground/40" />
      {ago ? `Offline, last seen ${ago}` : "Offline, never connected"}
    </span>
  );
}
