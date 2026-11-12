import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronRight } from "lucide-react";
import { canEdit } from "@darpan/shared";
import { apiGet, getSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";

interface Overview {
  screens: { total: number; online: number; waitingToPair: number };
  branches: number;
  media: { total: number; expiringSoon: number };
  playlists: number;
  assignments: number;
}

const nf = new Intl.NumberFormat("en-IN");

export async function OverviewContent() {
  const [data, user] = await Promise.all([apiGet<Overview>("/stats/overview"), getSessionUser()]);
  if (!data || !user) redirect("/login?expired=1");
  const editor = canEdit(user.role);

  const { screens } = data;
  const offline = screens.total - screens.online;
  const onlinePct = screens.total ? Math.round((screens.online / screens.total) * 100) : 0;

  const steps = [
    {
      done: data.media.total > 0,
      title: "Upload your first posters",
      body: "Add the Gujarati JPG posters and MP4 videos the branches should show.",
      href: "/media",
      action: "Open media",
    },
    {
      done: data.playlists > 0,
      title: "Build a playlist",
      body: "Put media in order and set how many seconds each poster stays on screen.",
      href: "/playlists",
      action: "Open playlists",
    },
    {
      done: screens.total > 0,
      title: "Pair the head office TV",
      body: "Install the Darpan app on the TV, then enter the 6-digit code it shows.",
      href: "/screens",
      action: "Open screens",
    },
    {
      done: data.assignments > 0,
      title: "Send the playlist to the TV",
      body: "Assign the playlist to the screen. The TV downloads it and starts playing.",
      href: "/screens",
      action: "Open screens",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="grid gap-8">
      {/* Network status: one panel, the screen count leads */}
      <section aria-labelledby="network-heading" className="overflow-hidden rounded-xl border bg-card">
        <h2 id="network-heading" className="sr-only">
          Network status
        </h2>
        <div className="grid grid-cols-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="col-span-3 border-b p-5 sm:p-6 lg:col-span-1 lg:border-r lg:border-b-0">
            <p className="text-sm text-muted-foreground">Screens online now</p>
            <p className="mt-2 flex items-baseline gap-2 font-heading">
              <span className="text-5xl font-semibold tracking-tight tabular-nums">{nf.format(screens.online)}</span>
              <span className="text-xl text-muted-foreground tabular-nums">of {nf.format(screens.total)}</span>
            </p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-mist" aria-hidden>
              <div className="h-full rounded-full bg-ok" style={{ width: `${onlinePct}%` }} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {screens.total === 0
                ? "No screens paired yet."
                : offline === 0
                  ? "Every paired screen is online."
                  : (
                    <Link href="/alerts" className="text-foreground underline-offset-2 hover:text-neel hover:underline">
                      {nf.format(offline)} offline for more than 3 minutes
                    </Link>
                  )}
              {screens.waitingToPair > 0 && ` ${screens.waitingToPair} waiting to be paired.`}
            </p>
          </div>
          <Stat label="Branches" value={data.branches} hint="in the network" />
          <Stat
            label="Media"
            value={data.media.total}
            hint={data.media.expiringSoon > 0 ? `${data.media.expiringSoon} ending this week` : "posters and videos"}
            warn={data.media.expiringSoon > 0}
          />
          <Stat label="Playlists" value={data.playlists} hint={`${data.assignments} assigned`} last />
        </div>
      </section>

      {/* First screen checklist: a real sequence, so it is numbered */}
      {editor && doneCount < steps.length && (
        <section aria-labelledby="setup-heading">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="setup-heading" className="text-xl font-semibold tracking-tight">
              Get the first screen playing
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {doneCount} of {steps.length} done
            </p>
          </div>
          <ol className="overflow-hidden rounded-xl border bg-card">
            {steps.map((step, i) => {
              const isNext = i === nextIndex;
              return (
                <li key={step.title} className={cn("border-b last:border-b-0", isNext && "bg-neel-soft/40")}>
                  <Link
                    href={step.href}
                    className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-mist/70 sm:items-center sm:px-6"
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                        step.done && "bg-ok text-white",
                        !step.done && isNext && "bg-neel text-white",
                        !step.done && !isNext && "border border-input text-muted-foreground",
                      )}
                    >
                      {step.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block font-medium",
                          step.done && "text-muted-foreground line-through decoration-1",
                        )}
                      >
                        {step.title}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{step.body}</span>
                    </span>
                    <span
                      className={cn(
                        "hidden shrink-0 items-center gap-1 text-sm font-medium sm:flex",
                        isNext ? "text-neel" : "text-muted-foreground opacity-0 group-hover:opacity-100",
                      )}
                    >
                      {step.action}
                      <ChevronRight className="size-4" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  warn = false,
  last = false,
}: {
  label: string;
  value: number;
  hint: string;
  warn?: boolean;
  last?: boolean;
}) {
  return (
    <div className={cn("min-w-0 p-4 sm:p-6", !last && "border-r")}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{nf.format(value)}</p>
      <p className={cn("mt-1 text-sm", warn ? "text-[#8a5a00]" : "text-muted-foreground")}>{hint}</p>
    </div>
  );
}
