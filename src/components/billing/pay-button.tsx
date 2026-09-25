"use client";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

/** Opens a Razorpay payment link for a plan at its listed price. The plan changes only once Razorpay confirms the payment. */
export function PayButton({ planKey, planName, hasYearly, testMode, disabled, why }: { planKey: string; planName: string; hasYearly: boolean; testMode: boolean; disabled: boolean; why: string | null }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function pay(period: "monthly" | "yearly") {
    setBusy(true); setMessage("");
    try {
      const r = await api.post<{ checkout: { url: string | null }; reused: boolean }>("/api/billing/checkout", { planKey, period });
      if (r.checkout.url) { window.open(r.checkout.url, "_blank", "noopener,noreferrer"); setMessage(`${r.reused ? "Reopened your payment link" : "Payment link opened"} in a new tab. The plan changes here once Razorpay confirms the payment${testMode ? " (test mode: no real money moves)" : ""}.`); }
    } catch (e) { setMessage(e instanceof Error ? e.message : "The payment link could not be created. Nothing was charged."); } finally { setBusy(false); }
  }
  if (disabled) return why ? <p className="mt-2 text-2xs text-muted">{why}</p> : null;
  return <div className="mt-2 space-y-1">
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void pay("monthly")}>Pay monthly</Button>
      {hasYearly && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void pay("yearly")}>Pay yearly</Button>}
    </div>
    {message && <p role="status" className="text-2xs text-secondary">{message}</p>}
    <span className="sr-only">{planName}</span>
  </div>;
}
