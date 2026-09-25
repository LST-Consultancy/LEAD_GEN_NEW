"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Mail, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";

type Role = { id: string; name: string };
type Invitation = { id: string; email: string; role: Role; createdAt: string; expiresAt: string; state: "pending" | "expired" };
type Issued = { email: string; role: string; expiresAt: string; link: string; emailed?: boolean; note?: string | null };

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Nothing was changed.");

/** Role picker and remove button for one member row. */
export function MemberActions({ member, roles }: { member: { id: string; name: string; roleId: string; roleName: string; isYou: boolean }; roles: Role[] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  // A role you can't grant is shown but not offered, so the row still says what they are.
  const options = roles.some((r) => r.id === member.roleId) ? roles : [{ id: member.roleId, name: member.roleName }, ...roles];

  async function changeRole(roleId: string) {
    setPending(true);
    try {
      const r = await api.patch<{ role: string }>(`/api/team/members/${member.id}`, { roleId });
      toast.success(`${member.name} is now ${r.role}`, { description: "It applies from their next click — sessions and API keys alike." });
      router.refresh();
    } catch (err) { toast.error("Role not changed", { description: errorText(err) }); router.refresh(); }
    finally { setPending(false); }
  }
  async function remove() {
    setPending(true);
    try {
      const r = await api.del<{ stillOwned: { leads: number; deals: number } }>(`/api/team/members/${member.id}`);
      const { leads, deals } = r.stillOwned;
      toast.success(`${member.name} removed`, { description: leads || deals ? `${leads} leads and ${deals} open deals are still assigned to them. Reassign them from Leads and Pipeline.` : "They had nothing assigned." });
      setConfirming(false); router.refresh();
    } catch (err) { toast.error("Not removed", { description: errorText(err) }); }
    finally { setPending(false); }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <select aria-label={`Role for ${member.name}`} value={member.roleId} disabled={pending} onChange={(e) => void changeRole(e.target.value)} className="h-7 rounded-md border border-border bg-surface px-1.5 text-2xs">
        {options.map((r) => <option key={r.id} value={r.id} disabled={!roles.some((x) => x.id === r.id)}>{r.name}</option>)}
      </select>
      <Button variant="ghost" size="xs" aria-label={member.isYou ? "Leave workspace" : `Remove ${member.name}`} onClick={() => setConfirming(true)} disabled={pending}><Trash2 /></Button>
      <Dialog open={confirming} onOpenChange={(o) => !pending && setConfirming(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{member.isYou ? "Leave this workspace?" : `Remove ${member.name}?`}</DialogTitle>
            <DialogDescription>They lose access at once. Their leads, deals and history stay, still assigned to them, so nothing is lost. You can invite them back later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>Cancel</Button>
            <Button variant="danger" size="sm" loading={pending} onClick={remove}>{member.isYou ? "Leave" : "Remove"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IssuedLink({ issued }: { issued: Issued }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-sunken p-3 text-xs">
      <p className="text-primary">Invitation for <strong>{issued.email}</strong> as {issued.role}, valid until {formatDate(issued.expiresAt)}.</p>
      <div className="flex gap-1.5">
        <Input readOnly aria-label="Invitation link" value={issued.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-2xs" />
        <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard?.writeText(issued.link).then(() => toast.success("Link copied")); }}><Copy />Copy</Button>
      </div>
      <p className="text-2xs text-secondary">
        <Mail className="mr-0.5 inline size-3" />
        {issued.emailed ? issued.note : `${issued.note ? `${issued.note} ` : "No email was sent. "}Send this link to them yourself — it is shown only now, and it is the only thing needed to join.`}
      </p>
    </div>
  );
}

export function InvitationsCard({ initial, roles }: { initial: Invitation[]; roles: Role[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [roleId, setRoleId] = React.useState(roles.find((r) => r.name === "Sales Rep")?.id ?? roles[roles.length - 1]?.id ?? "");
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [issued, setIssued] = React.useState<Issued | null>(null);
  const [sendEmail, setSendEmail] = React.useState(false);

  async function invite() {
    setPending("new"); setError("");
    try {
      const r = await api.post<Issued>("/api/team/invitations", { email, roleId, sendEmail });
      setIssued(r); setEmail(""); router.refresh();
    } catch (err) { setError(errorText(err)); } finally { setPending(null); }
  }
  async function resend(inv: Invitation) {
    setPending(inv.id);
    try { setIssued(await api.post<Issued>(`/api/team/invitations/${inv.id}`, {})); setOpen(true); router.refresh(); }
    catch (err) { toast.error("Couldn't resend", { description: errorText(err) }); } finally { setPending(null); }
  }
  async function revoke(inv: Invitation) {
    setPending(inv.id);
    try { await api.del(`/api/team/invitations/${inv.id}`); toast.success(`Invitation for ${inv.email} withdrawn`, { description: "The link no longer works." }); router.refresh(); }
    catch (err) { toast.error("Couldn't withdraw it", { description: errorText(err) }); } finally { setPending(null); }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5"><UserPlus className="size-3.5" />Invitations</CardTitle>
          <p className="mt-0.5 text-2xs text-muted">You can only offer roles whose permissions you hold yourself.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => { setIssued(null); setError(""); setOpen(true); }} disabled={roles.length === 0}><UserPlus />Invite</Button>
      </CardHeader>
      <CardContent className="p-0 pb-0">
        {initial.length === 0 ? (
          <p className="border-t border-border-subtle px-4 py-3 text-xs text-secondary">No pending invitations.</p>
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {initial.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-primary">{inv.email}</span>
                <Badge variant="neutral" size="sm">{inv.role.name}</Badge>
                {inv.state === "expired"
                  ? <Badge variant="warning" size="sm">Expired</Badge>
                  : <span className="text-2xs text-muted">until {formatDate(inv.expiresAt)}</span>}
                <Button variant="ghost" size="xs" loading={pending === inv.id} onClick={() => void resend(inv)}><RefreshCw />Resend</Button>
                <Button variant="ghost" size="xs" disabled={pending === inv.id} aria-label={`Withdraw invitation for ${inv.email}`} onClick={() => void revoke(inv)}><X /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => pending === null && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{issued ? "Send this link" : "Invite a teammate"}</DialogTitle>
            <DialogDescription>{issued ? "Anyone with the link can join as this address, once, until it expires." : "They get a link to set a password and join. It expires in seven days."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            {issued ? <IssuedLink issued={issued} /> : (
              <>
                <Input type="email" aria-label="Email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                <select aria-label="Role" value={roleId} onChange={(e) => setRoleId(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <label className="flex items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />Also send them the link by mail (needs a mail provider on the server)</label>
                {error ? <p className="text-xs text-danger-text">{error}</p> : null}
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {issued ? <Button variant="primary" size="sm" onClick={() => setOpen(false)}>Done</Button> : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending !== null}>Cancel</Button>
                <Button variant="primary" size="sm" loading={pending === "new"} disabled={!email.includes("@") || !roleId} onClick={invite}>Create invitation</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Skills, step capacity and away, which plan routing reads. Shown to everyone; edited by user managers. */
export function MemberRouting({ member, openSteps, canEdit }: { member: { id: string; name: string; skills: string[]; stepCapacity: number | null; isAway: boolean }; openSteps: number; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [skills, setSkills] = React.useState(member.skills.join(", "));
  const [capacity, setCapacity] = React.useState(member.stepCapacity?.toString() ?? "");
  const [away, setAway] = React.useState(member.isAway);
  const [pending, setPending] = React.useState(false);
  const summary = `${member.skills.length ? member.skills.join(", ") : "no skills set"} · ${openSteps}${member.stepCapacity ? `/${member.stepCapacity}` : ""} open steps${member.isAway ? " · away" : ""}`;
  async function save() {
    setPending(true);
    try {
      await api.put(`/api/team/members/${member.id}/routing`, { skills: skills.split(",").map((s) => s.trim()).filter(Boolean), stepCapacity: capacity ? Number(capacity) : null, isAway: away });
      toast.success(`${member.name} updated`); setEditing(false); router.refresh();
    } catch (err) { toast.error("Not saved", { description: err instanceof ApiError ? err.message : "Nothing was changed." }); } finally { setPending(false); }
  }
  if (!editing) return <span className="text-secondary">{summary}{canEdit ? <button type="button" className="ml-1 underline" onClick={() => setEditing(true)}>edit</button> : null}</span>;
  return <span className="flex flex-col gap-1">
    <Input aria-label={`Skills for ${member.name}`} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="netsuite, integration" className="h-7 text-2xs" />
    <span className="flex items-center gap-1">
      <Input aria-label={`Step capacity for ${member.name}`} type="number" min={1} max={200} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="no limit" className="h-7 w-20 text-2xs" />
      <label className="flex items-center gap-1"><input type="checkbox" checked={away} onChange={(e) => setAway(e.target.checked)} />away</label>
      <Button size="xs" variant="primary" loading={pending} onClick={() => void save()}>Save</Button>
      <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
    </span>
  </span>;
}
