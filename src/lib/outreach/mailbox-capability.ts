/**
 * What a connected mailbox can do, kept as two separate facts because they fail separately: a
 * mailbox can send but not be read (no IMAP, or reading switched off), be read but not send
 * (IMAP only, the server relay sends), or both. Stop-on-reply depends on reading; sending from a
 * person's own address depends on sending. Pure and client-safe.
 */
export type MailboxLike = { provider: string; status: string; sendStatus: string; receiveEnabled: boolean; revokedAt: Date | string | null };
export type Capability = "full" | "send_only" | "receive_only" | "none";

export const receives = (m: MailboxLike) => !m.revokedAt && m.receiveEnabled && m.status === "CONNECTED";
export const sends = (m: MailboxLike) => !m.revokedAt && m.sendStatus === "CONNECTED";
export function capabilityOf(m: MailboxLike): Capability {
  const s = sends(m), r = receives(m);
  return s && r ? "full" : s ? "send_only" : r ? "receive_only" : "none";
}
export const CAPABILITY_LABEL: Record<Capability, string> = { full: "Sends and reads replies", send_only: "Sends only — replies are not read", receive_only: "Reads replies only — sending uses the server relay", none: "Not working" };

/** The mail provider behind a mailbox, and what each can do in this version. */
export const MAILBOX_PROVIDERS = {
  imap: { label: "IMAP / SMTP", sendBuilt: true, receiveBuilt: true, needs: "Server names, user name and password (or app password)." },
  gmail: { label: "Gmail / Google Workspace (OAuth)", sendBuilt: true, receiveBuilt: true, needs: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET on the server, with the Gmail API enabled and this app's mail callback URL registered." },
  microsoft: { label: "Outlook / Microsoft 365 (OAuth)", sendBuilt: true, receiveBuilt: true, needs: "MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET from an Entra ID app registration with Mail.Send and Mail.Read delegated permissions." },
} as const;
export type MailboxProvider = keyof typeof MAILBOX_PROVIDERS;
