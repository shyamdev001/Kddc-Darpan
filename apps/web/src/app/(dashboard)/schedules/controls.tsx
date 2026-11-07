"use client";

import { useEffect, useState } from "react";
import { DAY_NAMES, type PlaceTree, type PlaylistSource, type ScreenListResponse } from "@darpan/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { LEVEL_TEXT } from "./format";

/** Monday first, as on an Indian calendar; values stay 0 = Sunday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function DayPicker({ value, onChange, label }: { value: number[]; onChange: (days: number[]) => void; label: string }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {WEEK.map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(d)}
            className={cn(
              "h-9 min-w-12 rounded-md border px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              on ? "border-neel bg-neel text-white" : "border-input bg-card text-muted-foreground hover:bg-mist hover:text-foreground",
            )}
          >
            {DAY_NAMES[d]}
          </button>
        );
      })}
    </div>
  );
}

export function TimeInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Input
      id={id}
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="h-10 w-32 bg-card tabular-nums"
    />
  );
}

export interface Target {
  level: PlaylistSource;
  targetId: string;
}

interface Options {
  REGION: { id: string; label: string }[];
  TALUKA: { id: string; label: string }[];
  BRANCH: { id: string; label: string }[];
  SCREEN: { id: string; label: string }[];
}

/** Where something applies: every screen, or one region, taluka, branch or screen. */
export function TargetPicker({ value, onChange, idPrefix }: { value: Target; onChange: (t: Target) => void; idPrefix: string }) {
  const [options, setOptions] = useState<Options | null>(null);

  useEffect(() => {
    Promise.all([apiFetch<PlaceTree>("/api/places"), apiFetch<ScreenListResponse>("/api/screens")])
      .then(([tree, screens]) => {
        const talukas = tree.regions.flatMap((r) => r.talukas.map((t) => ({ t, r })));
        setOptions({
          REGION: tree.regions.map((r) => ({ id: r.id, label: r.name })),
          TALUKA: talukas.map(({ t, r }) => ({ id: t.id, label: `${t.name} (${r.name})` })),
          BRANCH: talukas.flatMap(({ t }) => t.branches.map((b) => ({ id: b.id, label: `${b.name}${b.code ? ` (${b.code})` : ""}, ${t.name}` }))),
          SCREEN: screens.items.filter((s) => s.paired).map((s) => ({ id: s.id, label: `${s.name}${s.branch ? `, ${s.branch.name}` : ""}` })),
        });
      })
      .catch(() => setOptions({ REGION: [], TALUKA: [], BRANCH: [], SCREEN: [] }));
  }, []);

  const list = value.level === "ALL" ? [] : (options?.[value.level] ?? []);

  return (
    <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-level`}>Where</Label>
        <NativeSelect
          id={`${idPrefix}-level`}
          value={value.level}
          onChange={(e) => onChange({ level: e.target.value as PlaylistSource, targetId: "" })}
        >
          {(["ALL", "REGION", "TALUKA", "BRANCH", "SCREEN"] as const).map((l) => (
            <option key={l} value={l}>
              {l === "ALL" ? "Every screen" : `One ${LEVEL_TEXT[l].toLowerCase()}`}
            </option>
          ))}
        </NativeSelect>
      </div>
      {value.level !== "ALL" && (
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={`${idPrefix}-target`}>{LEVEL_TEXT[value.level]}</Label>
          <NativeSelect
            id={`${idPrefix}-target`}
            value={value.targetId}
            onChange={(e) => onChange({ ...value, targetId: e.target.value })}
            disabled={!options}
          >
            <option value="">{options ? (list.length ? `Choose a ${LEVEL_TEXT[value.level].toLowerCase()}` : "None yet") : "Loading"}</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
