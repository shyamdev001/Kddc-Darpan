"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The dashboard's own "are you sure?" box, in place of the browser's grey confirm() pop-up.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Stop the broadcast?", confirmLabel: "Stop broadcast", tone: "danger" }))) return;
 */
export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** Short facts laid out as a list, e.g. what a broadcast shows, where and until when. */
  details?: { label: string; value: ReactNode }[];
  /** Says exactly what happens: "Stop broadcast", not "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** danger: switches something off or removes it. alert: takes over the screens right now. */
  tone?: "default" | "danger" | "alert";
  icon?: LucideIcon;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm needs <ConfirmProvider> above it");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const settled = useRef(false);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        settled.current = false;
        setPending({ ...o, resolve });
        setOpen(true);
      }),
    [],
  );

  const finish = (ok: boolean) => {
    if (!settled.current) {
      settled.current = true;
      pending?.resolve(ok);
    }
    setOpen(false);
  };

  const tone = pending?.tone ?? "default";
  const Icon = pending?.icon;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(next) => !next && finish(false)}>
        {pending && (
          <AlertDialogContent className="gap-5 p-5 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
            <AlertDialogHeader className="place-items-start text-left">
              {Icon && (
                <span
                  className={cn(
                    "mb-1 flex size-10 items-center justify-center rounded-lg",
                    tone === "default" ? "bg-neel-soft text-neel" : "bg-[#c41e3a]/10 text-[#c41e3a]",
                  )}
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
              )}
              <AlertDialogTitle className="text-lg font-semibold tracking-tight">{pending.title}</AlertDialogTitle>
              {pending.description && (
                <AlertDialogDescription className="text-[15px] leading-relaxed text-pretty">{pending.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>

            {pending.details && pending.details.length > 0 && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border bg-mist/60 px-4 py-3 text-sm">
                {pending.details.map((d) => (
                  <div key={d.label} className="contents">
                    <dt className="text-muted-foreground">{d.label}</dt>
                    <dd className="min-w-0 font-medium break-words">{d.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <AlertDialogFooter className="-mx-5 -mb-5 px-5">
              <AlertDialogCancel size="lg">{pending.cancelLabel ?? "Cancel"}</AlertDialogCancel>
              <Button
                size="lg"
                autoFocus={tone === "default"}
                onClick={() => finish(true)}
                className={cn(
                  tone === "alert" && "bg-[#c41e3a] text-white hover:bg-[#a8182f]",
                  tone === "danger" && "bg-destructive text-white hover:bg-destructive/90",
                )}
              >
                {pending.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
