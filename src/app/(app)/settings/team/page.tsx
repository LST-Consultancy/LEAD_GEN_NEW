import * as React from "react";
import type { Metadata } from "next";
import { Check, Minus, ShieldCheck, Users } from "lucide-react";
import { requireAuth } from "@/lib/auth/context";
import { getTeamSettings } from "@/lib/services/settings";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { formatAge, formatInrCompact } from "@/lib/format";

export const metadata: Metadata = { title: "Team & Roles" };

/** Permission keys grouped for a readable matrix. */
const GROUPS: { label: string; prefix: string }[] = [
  { label: "Leads", prefix: "leads." },
  { label: "Points", prefix: "points." },
  { label: "Outreach", prefix: "outreach." },
  { label: "Pipeline", prefix: "pipeline." },
  { label: "Proposals", prefix: "proposals." },
  { label: "Automation", prefix: "autopilot." },
  { label: "Agents", prefix: "agents." },
  { label: "Billing", prefix: "billing." },
  { label: "Administration", prefix: "users." },
  { label: "Roles", prefix: "roles." },
  { label: "Workspace", prefix: "workspace." },
  { label: "ICP", prefix: "icp." },
  { label: "Platform", prefix: "api_keys." },
  { label: "Webhooks", prefix: "webhooks." },
  { label: "Audit", prefix: "audit." },
  { label: "Data", prefix: "data." },
  { label: "Knowledge", prefix: "knowledge." },
];

export default async function TeamSettingsPage() {
  const ctx = await requireAuth();
  const { members, roles, allPermissions } = await getTeamSettings(ctx);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-primary">Team &amp; roles</h1>
        <p className="mt-0.5 text-xs text-secondary">
          Permissions are enforced at the query layer, not by hiding buttons — a rep without
          <code className="mx-1 rounded bg-surface-sunken px-1 font-mono text-2xs">leads.view_all</code>
          cannot read another rep&apos;s leads through the UI or the API.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              Members
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {members.length} {members.length === 1 ? "member" : "members"} in this workspace
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Workspace members, their roles and workload</caption>
              <thead className="bg-surface-sunken">
                <tr className="border-y border-border">
                  {["Member", "Role", "Leads", "Open deals", "Pipeline", "Point cap", "Joined"].map(
                    (h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={`whitespace-nowrap px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted ${i > 1 ? "text-right" : "text-left"}`}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-primary">{m.user.name}</span>
                            {m.isYou ? (
                              <Badge size="sm" variant="brand" uppercase>
                                You
                              </Badge>
                            ) : null}
                          </div>
                          <p className="truncate text-2xs text-muted">{m.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Tooltip content={`${m.permissionCount} permissions granted`}>
                        <Badge variant="neutral" size="sm" className="cursor-help">
                          {m.role.name}
                        </Badge>
                      </Tooltip>
                      {m.title ? (
                        <p className="mt-0.5 text-2xs text-muted">{m.title}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right text-secondary tabular">{m.leadCount}</td>
                    <td className="px-3 py-2 text-right text-secondary tabular">
                      {m.openDealCount}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-primary tabular">
                      {m.openDealInr > 0 ? formatInrCompact(m.openDealInr) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-secondary tabular">
                      {m.dailyPointCap ? `${m.dailyPointCap}/day` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-2xs text-muted">
                      {formatAge(m.joinedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
        <CardFooter>
          <p className="text-2xs text-muted">
            Inviting and removing members isn&apos;t wired up yet. Every row above is a real
            membership record.
          </p>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" />
              Roles and permissions
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {roles.length} roles · {allPermissions.length} distinct permissions. Custom roles need
              no code change — a role is a row holding a list of permission keys.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Permission matrix by role</caption>
              <thead className="bg-surface-sunken">
                <tr className="border-y border-border">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-surface-sunken px-3 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted"
                  >
                    Permission
                  </th>
                  {roles.map((r) => (
                    <th
                      key={r.id}
                      scope="col"
                      className="whitespace-nowrap px-2 py-1.5 text-center text-2xs font-semibold uppercase tracking-wider text-muted"
                    >
                      {r.name}
                      <span className="mt-0.5 block font-normal normal-case tracking-normal text-muted/70">
                        {r.memberCount} {r.memberCount === 1 ? "member" : "members"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((group) => {
                  const perms = allPermissions.filter((p) => p.startsWith(group.prefix));
                  if (perms.length === 0) return null;
                  return (
                    <React.Fragment key={group.prefix}>
                      <tr className="bg-surface-sunken/60">
                        <th
                          scope="colgroup"
                          colSpan={roles.length + 1}
                          className="px-3 py-1 text-left text-2xs font-semibold uppercase tracking-wider text-muted"
                        >
                          {group.label}
                        </th>
                      </tr>
                      {perms.map((perm) => (
                        <tr key={perm} className="border-b border-border-subtle last:border-0">
                          <th
                            scope="row"
                            className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-mono text-2xs font-normal text-secondary"
                          >
                            {perm}
                          </th>
                          {roles.map((r) => {
                            const has = r.permissions.includes(perm);
                            return (
                              <td key={r.id} className="px-2 py-1.5 text-center">
                                {has ? (
                                  <Check
                                    className="mx-auto size-3.5 text-success"
                                    aria-label="Granted"
                                  />
                                ) : (
                                  <Minus
                                    className="mx-auto size-3 text-border-strong"
                                    aria-label="Not granted"
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
