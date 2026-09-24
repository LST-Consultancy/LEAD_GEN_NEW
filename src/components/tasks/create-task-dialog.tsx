"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, tasksApi } from "@/lib/api/client";

const PRIORITIES = [["LOW", "Low"], ["MEDIUM", "Medium"], ["HIGH", "High"], ["URGENT", "Urgent"]] as const;
const CHANNELS = [["", "Any / not a contact task"], ["EMAIL", "Email"], ["PHONE", "Call"], ["WHATSAPP", "WhatsApp"], ["LINKEDIN", "LinkedIn"], ["IN_PERSON", "In person"]] as const;

/**
 * A task or reminder, attached to a lead or deal when opened from one.
 * The server's createTask schema is the contract: title 1–200, description up
 * to 2000, owner defaults to the creator.
 */
export function CreateTaskDialog({
  leadId,
  dealId,
  defaultTitle = "",
  trigger = "button",
  label = "Add task",
}: {
  leadId?: string;
  dealId?: string;
  defaultTitle?: string;
  trigger?: "button" | "ghost";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState(defaultTitle);
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState("MEDIUM");
  const [channel, setChannel] = React.useState("");
  const [due, setDue] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit() {
    setPending(true);
    try {
      await tasksApi.create({
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        priority,
        ...(channel ? { channel } : {}),
        ...(due ? { dueAt: new Date(due).toISOString() } : {}),
        ...(leadId ? { leadId } : {}),
        ...(dealId ? { dealId } : {}),
      });
      toast.success("Task added", { description: "It is in My Queue." });
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't add that task", { description: err instanceof ApiError ? err.message : "Nothing was changed." });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant={trigger === "button" ? "secondary" : "ghost"}
        size={trigger === "button" ? "sm" : "xs"}
        onClick={() => { setTitle(defaultTitle); setDescription(""); setPriority("MEDIUM"); setChannel(""); setDue(""); setOpen(true); }}
      >
        <Plus />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>Goes to My Queue{leadId ? " and appears on this lead" : ""}. A due time turns it into a reminder.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="What needs doing" htmlFor="task-title" required>
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus placeholder="Follow up on the RFP timeline" />
            </Field>
            <Field label="Details" htmlFor="task-desc">
              <Textarea id="task-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Priority" htmlFor="task-priority">
                <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
                  {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Channel" htmlFor="task-channel">
                <select id="task-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs">
                  {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Due" htmlFor="task-due">
              <Input id="task-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" size="sm" loading={pending} disabled={title.trim().length < 1} onClick={submit}>Add task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
