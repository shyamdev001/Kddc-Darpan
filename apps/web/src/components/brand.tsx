import { cn } from "@/lib/utils";

/** Small brand mark: a 16:9 screen with the Gujarati letter દ and a haldi power light. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex aspect-video w-10 items-center justify-center rounded-[5px] bg-ink font-heading text-[15px] leading-none font-semibold text-white ring-1 ring-ink/10",
        className,
      )}
    >
      <span className="translate-y-[1px]">દ</span>
      <span className="absolute right-[3px] bottom-[3px] size-[3px] rounded-full bg-haldi" />
    </span>
  );
}

/** The large TV used on the sign-in page: the product name shown as a screen would show it. */
export function BrandScreen() {
  return (
    <figure className="w-full max-w-[440px]">
      <div className="rounded-[14px] bg-[#0b0f24] p-[10px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
        <div className="animate-screen-on relative flex aspect-video items-center justify-center overflow-hidden rounded-[6px] bg-neel">
          {/* faint scan lines: reads as a lit display, not a flat card */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 4px)",
            }}
          />
          <p
            lang="gu"
            className="relative font-heading text-[clamp(56px,9vw,104px)] leading-none font-semibold text-white"
            style={{ fontVariationSettings: '"wdth" 118' }}
          >
            દર્પણ
          </p>
        </div>
        <div className="flex items-center justify-end px-1 pt-[7px]">
          <span aria-hidden className="size-[5px] rounded-full bg-haldi shadow-[0_0_8px_1px_rgba(224,165,38,0.7)]" />
        </div>
      </div>
      {/* stand */}
      <div aria-hidden className="mx-auto h-5 w-16 bg-gradient-to-b from-[#0b0f24] to-transparent" />
      <figcaption className="sr-only">Darpan, written in Gujarati, shown on a television screen</figcaption>
    </figure>
  );
}
