"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { errorMessage, social, type ConversationView, type Page } from "@/lib/social/api";
import { MemberAvatar } from "./MemberAvatar";

// Share a post: copy its link, use the device's share sheet, or send it to
// someone you can message. Each action reports success only if it actually
// succeeded, and shows the reason when it didn't.
export function ShareDialog({ open, onClose, postId }: { open: boolean; onClose: () => void; postId: string }) {
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [people, setPeople] = useState<ConversationView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLink(`${window.location.origin}/post/${postId}`);
      try {
        const page = await social<Page<ConversationView>>("/conversations?limit=30");
        if (!cancelled) {
          setPeople(page.items.filter((c) => c.canSend));
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, postId]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setStatus({ kind: "success", text: "Link copied." });
    } catch {
      setStatus({ kind: "error", text: "Couldn't copy automatically. Select the link above and copy it." });
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: "A post on GiiGirl", url: link });
    } catch (err) {
      // Closing the share sheet is not a failure.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setStatus({ kind: "error", text: "Couldn't open the share options on this device." });
      }
    }
  }

  async function sendTo(conversation: ConversationView) {
    setSending(conversation.id);
    setStatus(null);
    try {
      await social(`/conversations/${conversation.id}/messages`, { method: "POST", body: { postId } });
      setSent((prev) => new Set(prev).add(conversation.id));
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err) });
    } finally {
      setSending(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share post">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <input
            readOnly
            value={link}
            aria-label="Post link"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-muted"
          />
          <p className="text-xs text-muted">Only signed-in GiiGirl members can open this link.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              Copy link
            </Button>
            {canNativeShare && (
              <Button type="button" variant="outline" size="sm" onClick={nativeShare}>
                Share…
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Send in a message</h3>
          {loadError && <Alert variant="danger">{loadError}</Alert>}
          {!loadError && people === null && <p className="text-sm text-muted">Loading…</p>}
          {people !== null && people.length === 0 && (
            <p className="text-sm text-muted">You can message members who follow you and whom you follow back. None yet.</p>
          )}
          <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
            {people?.map((c) => (
              <li key={c.id} className="flex items-center gap-3">
                <MemberAvatar user={c.other} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.other.displayName}</span>
                <Button
                  type="button"
                  size="sm"
                  variant={sent.has(c.id) ? "ghost" : "outline"}
                  loading={sending === c.id}
                  disabled={sent.has(c.id)}
                  onClick={() => sendTo(c)}
                >
                  {sent.has(c.id) ? "Sent" : "Send"}
                </Button>
              </li>
            ))}
          </ul>
        </div>

        {status && <Alert variant={status.kind === "success" ? "success" : "danger"}>{status.text}</Alert>}
        <Button type="button" variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
