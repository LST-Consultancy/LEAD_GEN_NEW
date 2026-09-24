import type { Metadata } from "next";
import { Monitor, ShieldCheck } from "lucide-react";
import { requireAuth } from "@/lib/auth/context";
import { getAccountSettings } from "@/lib/services/settings";
import { getMfaStatus } from "@/lib/services/mfa";
import { MfaPanel } from "@/components/admin/mfa-panel";
import { PasswordForm, ProfileForm, RevokeOtherSessionsButton, RevokeSessionButton } from "@/components/admin/account-forms";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { formatDate, formatDateTime, formatAge } from "@/lib/format";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettingsPage() {
  const ctx = await requireAuth();
  const [{ user, sessions, memberships }, mfa] = await Promise.all([
    getAccountSettings(ctx),
    getMfaStatus(ctx),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-primary">Account</h1>
        <p className="mt-0.5 text-xs text-secondary">
          Your profile, security and active sessions.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Avatar name={user.name} src={user.avatarUrl} size="xl" />
            <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <Row label="Name" value={user.name} />
              <Row
                label="Email"
                value={user.email}
                badge={
                  user.emailVerified ? (
                    <Badge variant="success" size="sm">
                      Verified
                    </Badge>
                  ) : (
                    <Badge variant="warning" size="sm">
                      Unverified
                    </Badge>
                  )
                }
              />
              <Row label="Language" value={user.locale} />
              <Row label="Timezone" value={user.timezone} />
              <Row label="Joined" value={formatDate(user.createdAt)} />
              <Row
                label="Last sign-in"
                value={user.lastLoginAt ? formatDateTime(user.lastLoginAt, user.timezone) : "—"}
              />
            </dl>
          </div>
        </CardContent>
        <CardFooter className="block">
          <ProfileForm initial={{ name: user.name, timezone: user.timezone, locale: user.locale }} />
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" />
              Security
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              Passwords are hashed with bcrypt at cost 12. Sessions are stored as SHA-256 digests,
              so a database leak cannot be replayed as a login.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="mb-1.5 text-2xs uppercase tracking-wider text-muted">Password</p>
            <PasswordForm />
          </div>
          <div className="border-t border-border-subtle pt-3">
            <p className="mb-1.5 text-2xs uppercase tracking-wider text-muted">Two-factor</p>
            <MfaPanel status={mfa} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <Monitor className="size-3.5" />
              Active sessions
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted">
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"} · sign out any
              device you don&apos;t recognise
            </p>
          </div>
          <RevokeOtherSessionsButton count={sessions.filter((s) => !s.isCurrent).length} />
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-2 rounded-md border border-border-subtle px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-primary">
                      {shortenAgent(s.userAgent)}
                    </span>
                    {s.isCurrent ? (
                      <Badge variant="brand" size="sm" uppercase>
                        This device
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-2xs text-muted">
                    {s.ipAddress ?? "unknown IP"} · started {formatAge(s.createdAt)} · expires{" "}
                    {formatDate(s.expiresAt)}
                  </p>
                </div>
                <RevokeSessionButton sessionId={s.id} current={s.isCurrent} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace memberships</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {memberships.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border-subtle px-2.5 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-primary">{m.name}</span>
                  <span className="block truncate text-2xs text-muted">{m.slug}</span>
                </span>
                <Badge variant="neutral" size="sm">
                  {m.roleName}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="flex items-center gap-1.5 truncate text-xs text-primary">
        {value}
        {badge}
      </dd>
    </div>
  );
}

function shortenAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Edg\//.test(ua)) return "Edge";
  if (/curl\//.test(ua)) return "curl (API client)";
  return ua.slice(0, 40);
}
