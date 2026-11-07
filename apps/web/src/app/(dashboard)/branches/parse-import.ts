import type { ImportBranchRow } from "@darpan/shared";

export const IMPORT_COLUMNS = ["Region", "Taluka", "Branch", "Code", "Address"] as const;

type Field = "region" | "taluka" | "name" | "code" | "address";

/** Header words (English and Gujarati) that identify each column. Order matters: "branch code" is a code, not a name. */
const HEADER_MATCH: [Field, RegExp][] = [
  ["code", /code|કોડ|ક્રમાંક/i],
  ["address", /address|સરનામ/i],
  ["region", /region|zone|વિભાગ|ઝોન|પ્રદેશ/i],
  ["taluka", /taluk|tehsil|તાલુક/i],
  ["name", /branch|name|શાખા|નામ/i],
];

export interface ParsedImport {
  rows: ImportBranchRow[];
  /** Problems with the text as a whole (not single rows). */
  problems: string[];
  hasHeader: boolean;
}

/** Splits one line of CSV, honouring "quoted, fields" and doubled "" quotes. */
function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t").map((c) => c.replace(/^"([\s\S]*)"$/, "$1").replace(/""/g, '"'));
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

/**
 * Reads rows copied from Excel (tab separated) or a CSV file.
 * With a header row, columns are found by name in any order; without one they are taken as Region, Taluka, Branch, Code, Address.
 */
export function parseImport(text: string): ParsedImport {
  const problems: string[] = [];
  const clean = text.replace(/^﻿/, "");
  if (clean.includes("�")) {
    problems.push("Some letters could not be read. In Excel, use Save As and choose “CSV UTF-8”, then pick that file.");
  }
  const lines = clean.split(/\r?\n/);
  const first = lines.find((l) => l.trim()) ?? "";
  const delimiter = first.includes("\t") ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";

  let columns: Record<Field, number> = { region: 0, taluka: 1, name: 2, code: 3, address: 4 };
  let hasHeader = false;
  const rows: ImportBranchRow[] = [];

  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const cells = splitLine(raw, delimiter).map((c) => c.trim());
    if (!hasHeader && rows.length === 0 && i === lines.indexOf(first)) {
      const found: Partial<Record<Field, number>> = {};
      cells.forEach((cell, idx) => {
        const hit = HEADER_MATCH.find(([field, re]) => found[field] === undefined && re.test(cell));
        if (hit) found[hit[0]] = idx;
      });
      if (Object.keys(found).length >= 2) {
        hasHeader = true;
        const missing = (["region", "taluka", "name"] as const).filter((f) => found[f] === undefined);
        if (missing.length) {
          const label = { region: "Region", taluka: "Taluka", name: "Branch" } as const;
          problems.push(`The header row needs a ${missing.map((m) => label[m]).join(", ")} column.`);
        }
        columns = { region: -1, taluka: -1, name: -1, code: -1, address: -1, ...found };
        return;
      }
    }
    const at = (f: Field) => (columns[f] >= 0 ? (cells[columns[f]] ?? "") : "");
    rows.push({ line: i + 1, region: at("region"), taluka: at("taluka"), name: at("name"), code: at("code") || null, address: at("address") || null });
  });

  if (!rows.length && !problems.length) problems.push("No rows found. Paste from Excel or choose a CSV file.");
  return { rows, problems, hasHeader };
}

/** A CSV with the expected header and one example row, as a starting point. */
export function templateCsv(): string {
  return `﻿${IMPORT_COLUMNS.join(",")}\r\nKheda,Nadiad,Nadiad Main,101,"Station Road, Nadiad"\r\n`;
}
