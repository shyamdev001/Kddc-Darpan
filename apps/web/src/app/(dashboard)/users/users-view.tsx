"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH, ROLE_LABELS, UserRole, type UserEntry, type UsersResponse } from "@darpan/shared";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useSessionUser } from "@/components/session-context";
import { apiFetch } from "@/lib/api-client";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROLE_HELP: Record<UserRole, string> = {
  SUPER_ADMIN: "Everything, including people's accounts.",
  HO_ADMIN: "Everything except people's accounts.",
  REGION_MANAGER: "Sees the screens, proof of play and alerts of one region. Cannot change anything.",
  BRANCH_VIEWER: "Sees the screens, proof of play and alerts of one branch. Cannot change anything.",
};

/** A passphrase-style first password, so the admin does not have to invent one. */
function suggestPassword(): string {
  const words = ["neem", "kesar", "mango", "river", "lotus", "tiger", "pearl", "cloud", "amber", "maple", "coral", "spice", "jasmine", "falcon", "harbor", "saffron"];
  const pick = new Uint32Array(4);
  crypto.getRandomValues(pick);
  return [...pick].slice(0, 3).map((n) => words[n % words.length]).join("-") + "-" + String(pick[3]! % 90 + 10);
}

type Editing = { kind: "new" } | { kind: "edit"; user: UserEntry } | { kind: "password"; user: UserEntry } | null;

export function UsersView() {
  const me = useSessionUser();
  const [data, setData] = useState<UsersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    apiFetch<UsersResponse>("/api/users")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!data) return error ? <p className="text-destructive">{error}</p> : <div className="h-96 animate-pulse rounded-xl bg-muted" />;

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ kind: "new" })} className="h-10 px-4 text-[15px]">
          <Plus data-icon="inline-start" />
          Add a person
        </Button>
      </div>
      <section className="overflow-hidden rounded-xl border bg-card">
        <ul className="divide-y">
          {data.users.map((u) => (
            <li key={u.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5", !u.isActive && "bg-mist/40")}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn("font-medium", !u.isActive && "text-muted-foreground")}>{u.name}</span>
                  {u.id === me?.id && <span className="text-sm text-muted-foreground">(you)</span>}
                  {!u.isActive && <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Turned off</span>}
                </p>
                <p className="truncate text-sm text-muted-foreground">{u.email}</p>
              </div>
              <div className="min-w-44 text-sm">
                <p>{ROLE_LABELS[u.role]}</p>
                <p className="text-muted-foreground">{u.region?.name ?? u.branch?.name ?? "Whole network"}</p>
              </div>
              <p className="min-w-36 text-sm text-muted-foreground">
                {u.lastLoginAt ? `Signed in ${formatDay(u.lastLoginAt)}` : "Never signed in"}
              </p>
              <div className="flex gap-1">
                <Button variant="outline" className="h-9 px-3" onClick={() => setEditing({ kind: "edit", user: u })}>
                  Edit
                </Button>
                <Button variant="ghost" className="h-9 px-3" onClick={() => setEditing({ kind: "password", user: u })}>
                  Set password
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="gap-5 p-6 sm:max-w-lg">
          {editing?.kind === "password" ? (
            <PasswordForm
              user={editing.user}
              onDone={(d) => {
                setData(d);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : editing ? (
            <UserForm
              data={data}
              user={editing.kind === "edit" ? editing.user : null}
              isMe={editing.kind === "edit" && editing.user.id === me?.id}
              onDone={(d) => {
                setData(d);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

function UserForm({
  data,
  user,
  isMe,
  onDone,
  onCancel,
}: {
  data: UsersResponse;
  user: UserEntry | null;
  isMe: boolean;
  onDone: (d: UsersResponse) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<UserRole>(user?.role ?? "BRANCH_VIEWER");
  const [regionId, setRegionId] = useState(user?.region?.id ?? "");
  const [branchId, setBranchId] = useState(user?.branch?.id ?? "");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const scope = {
      regionId: role === "REGION_MANAGER" ? regionId || null : null,
      branchId: role === "BRANCH_VIEWER" ? branchId || null : null,
    };
    try {
      const d = user
        ? await apiFetch<UsersResponse>(`/api/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ name, role, isActive, ...scope }) })
        : await apiFetch<UsersResponse>("/api/users", { method: "POST", body: JSON.stringify({ email, name, role, password, ...scope }) });
      onDone(d);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <div>
        <DialogTitle className="font-heading text-xl font-semibold tracking-tight">{user ? `Edit ${user.name}` : "Add a person"}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {user ? user.email : "They sign in with this email and the first password you give them, then change it."}
        </DialogDescription>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        {!user && (
          <div className="grid gap-2">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="u-name">Name</Label>
          <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="u-role">Role</Label>
          <NativeSelect id="u-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={isMe}>
            {Object.values(UserRole).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-sm text-muted-foreground">{isMe ? "You cannot change your own role." : ROLE_HELP[role]}</p>
        </div>
        {role === "REGION_MANAGER" && (
          <div className="grid gap-2">
            <Label htmlFor="u-region">Region</Label>
            <NativeSelect id="u-region" value={regionId} onChange={(e) => setRegionId(e.target.value)} required>
              <option value="">Choose a region</option>
              {data.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {role === "BRANCH_VIEWER" && (
          <div className="grid gap-2">
            <Label htmlFor="u-branch">Branch</Label>
            <NativeSelect id="u-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              <option value="">Choose a branch</option>
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code ? `${b.name} (${b.code})` : b.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {!user && (
          <div className="grid gap-2">
            <Label htmlFor="u-password">First password</Label>
            <div className="flex gap-2">
              <Input
                id="u-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                className="font-mono"
              />
              <Button type="button" variant="outline" className="h-10 shrink-0 px-3" onClick={() => setPassword(suggestPassword())}>
                Suggest
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Tell them in person or by phone, not by email.</p>
          </div>
        )}
        {user && !isMe && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="mt-0.5 size-4 accent-neel" />
            <span>
              <span className="font-medium">Account on</span>
              <span className="block text-muted-foreground">Turn it off when someone leaves; they are signed out at once.</span>
            </span>
          </label>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} className="h-10 px-4">
            Cancel
          </Button>
          <Button type="submit" disabled={pending} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {user ? "Save" : "Add person"}
          </Button>
        </div>
      </form>
    </>
  );
}

function PasswordForm({ user, onDone, onCancel }: { user: UserEntry; onDone: (d: UsersResponse) => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      onDone(await apiFetch<UsersResponse>(`/api/users/${user.id}/password`, { method: "PUT", body: JSON.stringify({ password }) }));
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <div>
        <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Set a new password for {user.name}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          For a forgotten password. They are signed out everywhere and use this one next.
        </DialogDescription>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="r-password">New password</Label>
          <div className="flex gap-2">
            <Input
              id="r-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              className="font-mono"
            />
            <Button type="button" variant="outline" className="h-10 shrink-0 px-3" onClick={() => setPassword(suggestPassword())}>
              Suggest
            </Button>
          </div>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} className="h-10 px-4">
            Cancel
          </Button>
          <Button type="submit" disabled={pending} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Set password
          </Button>
        </div>
      </form>
    </>
  );
}
