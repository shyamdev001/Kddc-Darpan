import { Injectable } from '@nestjs/common';
import type { ImportBranchesResponse, ImportRowResult } from '@darpan/shared';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import type { ImportBranchesDto } from './place.dto';

const CODE_RE = /^[A-Z0-9-]{1,20}$/;
/** Same cleanup as the single-branch form: NFC (Gujarati safe), single spaces, trimmed. */
const clean = (s?: string | null) => (s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
/** Names match without regard to case, so "nadiad" does not create a second Nadiad. */
const fold = (s: string) => s.toLocaleLowerCase('en-IN');

interface BranchState {
  id?: string; // undefined until created
  name: string;
  code: string | null;
  address: string | null;
  talukaKey: string;
  line?: number; // set for rows from this import
}

type Op =
  | { kind: 'create'; regionKey: string; talukaKey: string; name: string; code: string | null; address: string | null }
  | { kind: 'update'; id: string; talukaKey: string | null; data: { name?: string; code?: string; address?: string } };

/**
 * Adds or updates many branches at once from rows pasted out of Excel (or a CSV file).
 * Missing regions and talukas are created. A branch is matched by its code, or else by name within its taluka.
 * Rows with problems are skipped and reported by line; the rest are applied together in one transaction.
 */
@Injectable()
export class BranchImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ContentEvents,
  ) {}

  async run(dto: ImportBranchesDto, user: AuthUser, ip?: string): Promise<ImportBranchesResponse> {
    const [regions, branches] = await Promise.all([
      this.prisma.region.findMany({ include: { talukas: true } }),
      this.prisma.branch.findMany(),
    ]);

    // Current state, keyed by folded names. New regions/talukas are added as the rows are read.
    const regionByKey = new Map<string, { id?: string; name: string }>();
    const talukaByKey = new Map<string, { id?: string; name: string; regionKey: string }>();
    const talukaKeyById = new Map<string, string>();
    for (const r of regions) {
      const rk = fold(r.name);
      regionByKey.set(rk, { id: r.id, name: r.name });
      for (const t of r.talukas) {
        const tk = `${rk}|${fold(t.name)}`;
        talukaByKey.set(tk, { id: t.id, name: t.name, regionKey: rk });
        talukaKeyById.set(t.id, tk);
      }
    }
    const byCode = new Map<string, BranchState>();
    const byPlace = new Map<string, BranchState>();
    for (const b of branches) {
      const s: BranchState = { id: b.id, name: b.name, code: b.code, address: b.address, talukaKey: talukaKeyById.get(b.talukaId)! };
      if (b.code) byCode.set(b.code, s);
      byPlace.set(`${s.talukaKey}|${fold(b.name)}`, s);
    }

    const results: ImportRowResult[] = [];
    const ops: Op[] = [];
    const newRegions: string[] = [];
    const newTalukas: string[] = [];
    const fail = (line: number, message: string) => results.push({ line, status: 'error', message });

    for (const row of dto.rows) {
      const region = clean(row.region);
      const taluka = clean(row.taluka);
      const name = clean(row.name);
      const code = clean(row.code).toUpperCase() || null;
      const address = clean(row.address) || null;

      if (!region || !taluka || !name) {
        fail(row.line, 'Region, taluka and branch name are all needed');
        continue;
      }
      if (region.length > 80 || taluka.length > 80) {
        fail(row.line, 'Region and taluka names can be up to 80 characters');
        continue;
      }
      if (name.length > 120) {
        fail(row.line, 'Branch name can be up to 120 characters');
        continue;
      }
      if (address && address.length > 300) {
        fail(row.line, 'Address can be up to 300 characters');
        continue;
      }
      if (code && !CODE_RE.test(code)) {
        fail(row.line, `Code “${code}” can only use letters, digits and dashes (up to 20)`);
        continue;
      }

      const rk = fold(region);
      const tk = `${rk}|${fold(taluka)}`;
      const placeKey = `${tk}|${fold(name)}`;
      const sameCode = code ? byCode.get(code) : undefined;
      const samePlace = byPlace.get(placeKey);

      if (sameCode?.line) {
        fail(row.line, `Code ${code} is also on line ${sameCode.line}`);
        continue;
      }
      if (samePlace?.line) {
        fail(row.line, `${name} in ${taluka} is also on line ${samePlace.line}`);
        continue;
      }
      if (sameCode && samePlace && sameCode !== samePlace) {
        fail(row.line, `Code ${code} belongs to ${sameCode.name}, and ${taluka} already has a different ${name}`);
        continue;
      }
      const target = sameCode ?? samePlace;
      if (target && !sameCode && code && target.code && target.code !== code) {
        fail(row.line, `${name} in ${taluka} already has code ${target.code}. Change it on the branch first.`);
        continue;
      }

      // Regions and talukas this import adds.
      if (!regionByKey.has(rk)) {
        regionByKey.set(rk, { name: region });
        newRegions.push(region);
      }
      if (!talukaByKey.has(tk)) {
        talukaByKey.set(tk, { name: taluka, regionKey: rk });
        newTalukas.push(`${taluka} (${regionByKey.get(rk)!.name})`);
      }
      const where = `${talukaByKey.get(tk)!.name}, ${regionByKey.get(rk)!.name}`;

      if (!target) {
        const s: BranchState = { name, code, address, talukaKey: tk, line: row.line };
        if (code) byCode.set(code, s);
        byPlace.set(placeKey, s);
        ops.push({ kind: 'create', regionKey: rk, talukaKey: tk, name, code, address });
        results.push({ line: row.line, status: 'create', message: `New branch in ${where}` });
        continue;
      }

      const data: { name?: string; code?: string; address?: string } = {};
      const changes: string[] = [];
      if (target.name !== name) {
        data.name = name;
        changes.push(`name was ${target.name}`);
      }
      if (code && target.code !== code) {
        data.code = code;
        changes.push('code added');
      }
      if (address && target.address !== address) {
        data.address = address;
        changes.push('address');
      }
      const moves = target.talukaKey !== tk;
      if (moves) changes.push(`moves to ${where}`);
      target.line = row.line;
      if (code) byCode.set(code, target);
      byPlace.set(placeKey, target);

      if (!changes.length) {
        results.push({ line: row.line, status: 'same', message: 'Already up to date' });
        continue;
      }
      ops.push({ kind: 'update', id: target.id!, talukaKey: moves ? tk : null, data });
      results.push({ line: row.line, status: 'update', message: `Changes: ${changes.join('; ')}` });
    }

    const count = (s: ImportRowResult['status']) => results.filter((r) => r.status === s).length;
    const response: ImportBranchesResponse = {
      dryRun: dto.dryRun,
      rows: results,
      newRegions,
      newTalukas,
      created: count('create'),
      updated: count('update'),
      unchanged: count('same'),
      errors: count('error'),
    };
    if (dto.dryRun || !ops.length) return response;

    const moved: string[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        // ids for regions and talukas this import adds
        for (const [rk, r] of regionByKey) {
          if (!r.id) r.id = (await tx.region.create({ data: { name: r.name } })).id;
          regionByKey.set(rk, r);
        }
        for (const t of talukaByKey.values()) {
          if (!t.id) t.id = (await tx.taluka.create({ data: { name: t.name, regionId: regionByKey.get(t.regionKey)!.id! } })).id;
        }
        for (const op of ops) {
          if (op.kind === 'create') {
            await tx.branch.create({
              data: { name: op.name, code: op.code, address: op.address, talukaId: talukaByKey.get(op.talukaKey)!.id! },
            });
          } else {
            const data: Prisma.BranchUncheckedUpdateInput = { ...op.data };
            if (op.talukaKey) {
              data.talukaId = talukaByKey.get(op.talukaKey)!.id!;
              moved.push(op.id);
            }
            await tx.branch.update({ where: { id: op.id }, data });
          }
        }
      },
      { timeout: 60_000 },
    );

    await this.audit.log({
      userId: user.id,
      action: 'branch.import',
      entityType: 'Branch',
      details: {
        created: response.created,
        updated: response.updated,
        unchanged: response.unchanged,
        skipped: response.errors,
        newRegions,
        newTalukas,
        createdBranches: ops.flatMap((o) => (o.kind === 'create' ? [o.code ? `${o.name} (${o.code})` : o.name] : [])).slice(0, 300),
      },
      ipAddress: ip,
    });

    if (moved.length) {
      const screens = await this.prisma.screen.findMany({ where: { branchId: { in: moved }, status: { not: 'PENDING' } }, select: { id: true } });
      this.events.screensChanged(...screens.map((s) => s.id));
    }
    return response;
  }
}
