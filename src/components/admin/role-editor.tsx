"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { listRoles } from "@/lib/services/roles";

type Role = Awaited<ReturnType<typeof listRoles>>[number];

/** Create or edit custom roles from the permission catalogue; system roles can only be copied. */
export function RoleEditor({ roles, groups, mine }: { roles: Role[]; groups: { label: string; permissions: string[] }[]; mine: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; name: string; description: string; permissions: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const start = (r: Role | null, copy = false) => setEditing({ id: r && !copy ? r.id : null, name: r ? (copy ? `${r.name} (custom)` : r.name) : "", description: r?.description ?? "", permissions: new Set(r?.permissions.filter(p => mine.includes(p)) ?? []) });
  async function save() {
    if (!editing) return; setBusy(true); setMessage("");
    const body = { name: editing.name, description: editing.description || null, permissions: [...editing.permissions] };
    try { if (editing.id) await api.put(`/api/team/roles/${editing.id}`, body); else await api.post("/api/team/roles", body); setMessage(`Saved “${editing.name}”. People holding it get the change on their next action.`); setEditing(null); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  return <div className="space-y-3 p-4 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => start(null)}>New custom role</Button>
      <span className="text-muted">Edit:</span>
      {roles.map(r => <Button key={r.id} size="sm" variant="ghost" onClick={() => start(r, r.isSystem)} title={r.isSystem ? "System roles are fixed; this makes an editable copy." : undefined}>{r.isSystem ? `Copy ${r.name}` : r.name}<span className="ml-1 tabular-nums text-muted">({r.members})</span></Button>)}
    </div>
    {message && <p role="status" className="rounded border border-border p-2">{message}</p>}
    {editing && <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-3 rounded border border-border p-3">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="block">Name<Input required minLength={2} maxLength={60} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="mt-1" /></label>
        <label className="block">Description<Input maxLength={300} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} className="mt-1" /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{groups.filter(g => g.permissions.length).map(g => <fieldset key={g.label} className="min-w-0 rounded border border-border p-2"><legend className="px-1 font-medium text-primary">{g.label}</legend>
        {g.permissions.map(p => <label key={p} className="flex items-center gap-1.5 font-mono text-2xs"><input type="checkbox" disabled={!mine.includes(p)} checked={editing.permissions.has(p)} onChange={e => { const next = new Set(editing.permissions); if (e.target.checked) next.add(p); else next.delete(p); setEditing({ ...editing, permissions: next }); }} />{p}{!mine.includes(p) && <span className="font-sans text-muted"> (you don&apos;t hold it)</span>}</label>)}
      </fieldset>)}</div>
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy || editing.permissions.size === 0}>{editing.id ? "Save role" : "Create role"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
      <p className="text-2xs text-muted">A role can hold only permissions you hold. Roles are not deleted, so history keeps who held what; a role nobody holds simply goes unused.</p>
    </form>}
  </div>;
}
