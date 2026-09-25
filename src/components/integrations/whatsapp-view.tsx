"use client";

import Link from "next/link";
import { AlertTriangle, Check, Info, MessageCircle, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { WHATSAPP_RULES } from "@/lib/channels/whatsapp";
import type { whatsappStatus } from "@/lib/services/whatsapp";
import { WhatsAppConnection } from "./whatsapp-connection";
import type { ChannelReach } from "@/lib/services/channels";

/**
 * The WhatsApp surfaces — the channel screen and both settings screens share
 * this, with `variant` choosing the emphasis.
 *
 * The rules panel is the substance. WhatsApp's constraints are not this
 * product's constraints, and a seller who discovers "you cannot cold-message"
 * after their number is rate-limited has been failed by the tool.
 */
export function WhatsAppView({
  variant,
  reach,
  connection,
  canManage,
  conversationCount,
}: {
  variant: "channel" | "settings" | "api";
  reach: ChannelReach;
  connection: Awaited<ReturnType<typeof whatsappStatus>>;
  canManage: boolean;
  conversationCount: number;
}) {
  const title =
    variant === "channel" ? "WhatsApp" : variant === "api" ? "WhatsApp API" : "WhatsApp settings";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-primary">{title}</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-secondary">
          {variant === "api"
            ? "Credentials for the official Meta Cloud API. There is no unofficial path here — a library that drives WhatsApp Web gets the number banned, and that risk would be yours, not ours."
            : "India-first messaging over the official Business API, with consent enforced before anything is sent."}
        </p>
      </div>

      {variant === "channel" ? (
        <div className={`rounded-lg border px-3 py-2.5 text-xs ${connection.connected ? "border-border text-secondary" : "border-warning-border bg-warning-subtle text-warning-text"}`}>
          {connection.connected ? <Check className="mr-1 inline size-3.5 text-success-text" /> : <AlertTriangle className="mr-1 inline size-3.5" />}
          {connection.connected
            ? <>WhatsApp is connected{connection.display ? <> ({connection.display})</> : null}. Send from a lead once their opt-in is recorded; replies and receipts arrive in the Inbox.</>
            : <><strong>WhatsApp is not connected, so nothing sends on this channel.</strong> Connect your WhatsApp Business number in <Link href="/settings/whatsapp-api" className="underline">WhatsApp API settings</Link>. A stop recorded against a number already suppresses that person on every channel.</>}
        </div>
      ) : (
        <WhatsAppConnection status={connection} canManage={canManage} />
      )}

      <Card>
        <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <MessageCircle className="size-3.5 text-muted" />
            Who you could reach
          </CardTitle>
          <span className="text-2xs text-muted">across leads you can see</span>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 sm:grid-cols-4">
            <Figure label="Leads" value={reach.totalLeads} />
            <Figure
              label="With a mobile"
              value={reach.reachable}
              hint="A mobile or WhatsApp number recorded on the contact. Having a number is not the same as having consent."
            />
            <Figure
              label="Revealed"
              value={reach.revealed}
              hint="A locked number cannot be messaged — it has not been revealed yet."
            />
            <Figure
              label="Suppressed"
              value={reach.suppressed}
              hint="Opted out, or an address on the suppression list. A locked address has no value to match against, so this is a planning figure — the send-time check re-tests the revealed address and is what actually stops a message."
              muted
            />
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-muted">
            {reach.reachable === 0
              ? "No mobile numbers are recorded, so this channel reaches nobody yet."
              : `${formatNumber(reach.reachable)} numbers are recorded — but a number is not consent; only people whose opt-in is recorded, or who messaged first, can be sent to.`}{" "}
            {conversationCount > 0
              ? `${formatNumber(conversationCount)} WhatsApp conversations exist.`
              : "No WhatsApp conversation has ever been recorded here."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <ShieldAlert className="size-3.5 text-muted" />
            Rules that apply whatever tool you use
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {WHATSAPP_RULES.map((r) => (
            <div key={r.title} className="rounded-md border border-border-subtle bg-surface px-2.5 py-2">
              <p className="text-xs font-medium text-primary">{r.title}</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-secondary">{r.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consent and hand-logged conversations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-2xs leading-relaxed text-secondary">
          <p>
            <strong className="text-primary">Record consent as you collect it.</strong> An opt-in
            captured at a trade show or on a form is the thing you will need before any message.
            Recording a stop works now and blocks every channel.{" "}
            <Link href="/trust" className="text-brand-text underline-offset-2 hover:underline">
              Trust Center
            </Link>
          </p>
          <p>
            <strong className="text-primary">Log the conversations you have by hand.</strong> A
            WhatsApp reply recorded on the lead stops sequences and counts in reporting exactly as
            an automatic one would.{" "}
            <Link href="/inbox" className="text-brand-text underline-offset-2 hover:underline">
              Inbox
            </Link>
          </p>
        </CardContent>
      </Card>

      <p className="text-2xs leading-relaxed text-muted">
        <Info className="mr-0.5 inline size-2.5" />
        Template approval, per-conversation pricing and quality rating are all controlled by Meta.
        This product can show their state once connected; it cannot change them.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: number;
  hint?: string;
  muted?: boolean;
}) {
  const body = (
    <div className="rounded-md border border-border bg-surface p-2.5">
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p
        className={`mt-0.5 text-sm font-semibold tabular-nums ${muted ? "text-muted" : "text-primary"}`}
      >
        {formatNumber(value)}
      </p>
    </div>
  );
  return hint ? (
    <Tooltip content={hint}>
      <div className="cursor-help">{body}</div>
    </Tooltip>
  ) : (
    body
  );
}
