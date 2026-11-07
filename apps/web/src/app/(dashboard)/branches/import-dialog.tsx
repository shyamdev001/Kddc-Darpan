"use client";

import { useMemo, useRef, useState } from "react";
import type { ImportBranchesResponse, ImportRowStatus } from "@darpan/shared";
import { IMPORT_MAX_ROWS } from "@darpan/shared";
import { CheckCircle2, Download, FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { IMPORT_COLUMNS, parseImport, templateCsv } from "./parse-import";

const STATUS: Record<ImportRowStatus, { label: string; className: string }> = {
  create: { label: "New", className: "bg-neel-soft text-neel" },
  update: { label: "Changes", className: "bg-[#fdf3dc] text-[#7a5200]" },
  same: { label: "No change", className: "bg-mist text-muted-foreground" },
  error: { label: "Skipped", className: "bg-destructive/10 text-destructive" },
};

type Step = "paste" | "check" | "done";

export function ImportBranchesButton({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="h-10 px-4">
        <Upload data-icon="inline-start" />
        Import branches
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] gap-5 overflow-y-auto p-6 sm:max-w-3xl">
          {open && (
            <ImportFlow
              onClose={() => setOpen(false)}
              onImported={onImported}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportFlow({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("paste");
  const [report, setReport] = useState<ImportBranchesResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseImport(text), [text]);
  const tooMany = parsed.rows.length > IMPORT_MAX_ROWS;
  const byLine = useMemo(() => new Map(parsed.rows.map((r) => [r.line, r])), [parsed]);

  async function send(dryRun: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<ImportBranchesResponse>("/api/places/import", {
        method: "POST",
        body: JSON.stringify({ rows: parsed.rows, dryRun }),
      });
      setReport(res);
      setStep(dryRun ? "check" : "done");
      if (!dryRun) onImported();
    } catch (e) {
      setError((e as Error).message);
    }
    setPending(false);
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setError("Excel files cannot be read directly. Copy the rows in Excel and paste them here, or use Save As and choose “CSV UTF-8”.");
      return;
    }
    setError(null);
    setFileName(file.name);
    setText(await file.text());
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "darpan-branches.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const errorBox = error && (
    <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );

  if (step === "paste") {
    return (
      <>
        <div>
          <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Import branches</DialogTitle>
          <DialogDescription className="mt-1 max-w-xl text-sm text-muted-foreground">
            Copy the rows from Excel and paste them below, or choose a CSV file. Columns: {IMPORT_COLUMNS.join(", ")}. Code and
            address can be empty. Missing regions and talukas are added for you. Nothing changes until you confirm.
          </DialogDescription>
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => fileInput.current?.click()} className="h-9">
              <FileUp data-icon="inline-start" />
              Choose CSV file
            </Button>
            <Button variant="ghost" onClick={downloadTemplate} className="h-9 text-neel">
              <Download data-icon="inline-start" />
              Template
            </Button>
            {fileName && <span className="truncate text-sm text-muted-foreground">{fileName}</span>}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xls,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <textarea
            aria-label="Rows to import"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
            }}
            rows={10}
            spellCheck={false}
            placeholder={"Region\tTaluka\tBranch\tCode\tAddress\nKheda\tNadiad\tNadiad Main\t101\tStation Road"}
            className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {text.trim() && (
            <p className="text-sm text-muted-foreground">
              {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} found
              {parsed.hasHeader ? ", header row recognised" : ", read as Region, Taluka, Branch, Code, Address"}.
            </p>
          )}
          {text.trim() &&
            parsed.problems.map((p) => (
              <p key={p} className="text-sm text-[#8a5a00]">
                {p}
              </p>
            ))}
          {tooMany && <p className="text-sm text-destructive">Import at most {IMPORT_MAX_ROWS} rows at a time.</p>}
        </div>

        {errorBox}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={onClose} className="h-9">
            Cancel
          </Button>
          <Button onClick={() => void send(true)} disabled={pending || !parsed.rows.length || tooMany} className="h-9">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Check rows
          </Button>
        </div>
      </>
    );
  }

  const r = report!;
  const toApply = r.created + r.updated;

  if (step === "done") {
    return (
      <>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" />
          <div>
            <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Branches imported</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              {summary(r)}
              {r.errors ? ` ${r.errors} row${r.errors === 1 ? " was" : "s were"} skipped.` : ""}
            </DialogDescription>
          </div>
        </div>
        <div className="flex justify-end border-t pt-4">
          <Button onClick={onClose} className="h-9">
            Done
          </Button>
        </div>
      </>
    );
  }

  const shown = onlyIssues ? r.rows.filter((x) => x.status !== "same") : r.rows;

  return (
    <>
      <div>
        <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Check before importing</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">{summary(r)}</DialogDescription>
      </div>

      <dl className="flex flex-wrap gap-2 text-sm">
        {(["create", "update", "same", "error"] as const).map((s) => {
          const n = { create: r.created, update: r.updated, same: r.unchanged, error: r.errors }[s];
          return (
            <div key={s} className={cn("flex items-baseline gap-1.5 rounded-md px-2.5 py-1", STATUS[s].className)}>
              <dt>{STATUS[s].label}</dt>
              <dd className="font-semibold tabular-nums">{n}</dd>
            </div>
          );
        })}
      </dl>

      {(r.newRegions.length > 0 || r.newTalukas.length > 0) && (
        <div className="grid gap-1 rounded-lg bg-mist px-3 py-2.5 text-sm">
          {r.newRegions.length > 0 && (
            <p>
              <span className="font-medium">New regions:</span> {r.newRegions.join(", ")}
            </p>
          )}
          {r.newTalukas.length > 0 && (
            <p>
              <span className="font-medium">New talukas:</span> {r.newTalukas.join(", ")}
            </p>
          )}
          <p className="text-muted-foreground">Check the spelling: a typo here adds a second region or taluka.</p>
        </div>
      )}

      <div className="grid gap-2">
        {r.unchanged > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="size-4 accent-neel" />
            Hide rows with no change
          </label>
        )}
        <div className="max-h-[45vh] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-muted-foreground shadow-[0_1px_0_var(--color-border)]">
              <tr>
                <th className="px-3 py-2 font-medium">Line</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const src = byLine.get(row.line);
                return (
                  <tr key={row.line} className="border-t align-top">
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.line}</td>
                    <td className="px-3 py-2">
                      <p>
                        {src?.name || <span className="text-muted-foreground">No name</span>}
                        {src?.code && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{src.code.toUpperCase()}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{[src?.taluka, src?.region].filter(Boolean).join(", ")}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("mr-2 inline-block rounded px-1.5 text-xs font-medium", STATUS[row.status].className)}>
                        {STATUS[row.status].label}
                      </span>
                      <span className={row.status === "error" ? "text-destructive" : "text-muted-foreground"}>{row.message}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {errorBox}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {r.errors > 0 && toApply > 0 && (
          <p className="mr-auto text-sm text-muted-foreground">Skipped rows are left out. Fix them and import again later.</p>
        )}
        <Button variant="outline" onClick={() => setStep("paste")} className="h-9">
          Back to edit
        </Button>
        <Button onClick={() => void send(false)} disabled={pending || toApply === 0} className="h-9">
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {toApply === 0 ? "Nothing to import" : `Import ${toApply} branch${toApply === 1 ? "" : "es"}`}
        </Button>
      </div>
    </>
  );
}

function summary(r: ImportBranchesResponse): string {
  const parts: string[] = [];
  const verb = r.dryRun ? ["will be added", "will change"] : ["added", "changed"];
  if (r.created) parts.push(`${r.created} branch${r.created === 1 ? "" : "es"} ${verb[0]}`);
  if (r.updated) parts.push(`${r.updated} ${verb[1]}`);
  if (r.unchanged) parts.push(`${r.unchanged} already up to date`);
  if (!parts.length) return r.errors ? "Every row has a problem. Fix them and check again." : "Nothing to do.";
  return `${parts.join(", ")}.`;
}
