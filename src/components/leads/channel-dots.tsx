"use client";

import { Ban, Contact, Lock, Mail, MessageCircle, Phone } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Channels = {
  email: string;
  phone: string;
  whatsapp: string;
  linkedin: string;
  optedOut: boolean;
};

/**
 * Reachability at a glance. "Locked" is visually distinct from "absent" so the
 * table never implies you can contact someone you can't (§20, §101).
 */
export function ChannelDots({ channels }: { channels: Channels }) {
  if (channels.optedOut) {
    return (
      <Tooltip content="This person has opted out. Sends are blocked by the suppression list.">
        <span className="inline-flex items-center gap-1 text-danger-text">
          <Ban className="size-3.5" />
          <span className="text-2xs font-medium uppercase">Opted out</span>
        </span>
      </Tooltip>
    );
  }

  const items = [
    { key: "email", state: channels.email, icon: Mail, label: "Email" },
    { key: "phone", state: channels.phone, icon: Phone, label: "Phone" },
    { key: "whatsapp", state: channels.whatsapp, icon: MessageCircle, label: "WhatsApp" },
    { key: "linkedin", state: channels.linkedin, icon: Contact, label: "LinkedIn" },
  ];

  return (
    <span className="inline-flex items-center gap-0.5">
      {items.map(({ key, state, icon: Icon, label }) => {
        if (state === "none") {
          return (
            <Tooltip key={key} content={`No ${label.toLowerCase()} on file`}>
              <span className="inline-flex size-4 items-center justify-center text-border-strong">
                <Icon className="size-3" />
              </span>
            </Tooltip>
          );
        }
        const locked = state === "locked";
        return (
          <Tooltip
            key={key}
            content={
              locked
                ? `${label} available — costs 1 point to reveal`
                : `${label} revealed and ready to use`
            }
          >
            <span
              className={cn(
                "relative inline-flex size-4 items-center justify-center rounded",
                locked ? "text-muted" : "text-success"
              )}
            >
              <Icon className="size-3" />
              {locked ? (
                <Lock className="absolute -bottom-0.5 -right-0.5 size-2 text-warning" />
              ) : null}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}
