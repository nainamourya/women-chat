/* eslint-disable @next/next/no-img-element -- local preview of a not-yet-uploaded photo */
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GateNotice } from "@/components/social/GateNotice";
import { SocialPage } from "@/components/social/StateViews";
import { ApiError, errorMessage, social, type PostView } from "@/lib/social/api";
import { ImageError, prepareImage, type PreparedImage } from "@/lib/social/prepareImage";

const MAX_CAPTION = 2200;

export function NewPostClient() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<ApiError | null>(null);

  // Release the preview's object URL when it is replaced or the page closes.
  useEffect(() => {
    const url = image?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [image]);

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      setImage(await prepareImage(file));
    } catch (err) {
      setImage(null);
      setError(err instanceof ImageError ? err.message : errorMessage(err));
    } finally {
      setPreparing(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!image) return;
    setBusy(true);
    setError(null);
    try {
      const { post } = await social<{ post: PostView }>("/posts", {
        method: "POST",
        body: { caption, imageBase64: image.imageBase64, mimeType: image.mimeType },
      });
      router.push(`/post/${post.id}`);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "not_eligible" || err.code === "username_required")) setGate(err);
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (gate) return <SocialPage title="New post"><GateNotice error={gate} onResolved={() => setGate(null)} /></SocialPage>;

  return (
    <SocialPage title="New post">
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} className="sr-only" aria-label="Choose a photo" />

          {image ? (
            <div className="flex flex-col items-start gap-2">
              <img src={image.previewUrl} alt="Preview of your photo" className="aspect-square w-full rounded-md bg-background object-cover" />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                Choose a different photo
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={preparing}
              className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border text-sm text-muted hover:border-brand hover:text-foreground disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="10" r="1.6" />
                <path strokeLinecap="round" strokeLinejoin="round" d="m4 17 5-4.5 3 2.5 3.5-3.5L20 16" />
              </svg>
              {preparing ? "Preparing photo…" : "Choose a photo"}
            </button>
          )}
          <p className="text-xs text-muted">
            Photos are resized on your device, and location and camera details are removed before they&apos;re shared.
          </p>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Caption
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={MAX_CAPTION}
              rows={4}
              placeholder="Write a caption…"
              className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm font-normal text-foreground placeholder:text-muted focus-visible:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <span className="self-end text-xs font-normal text-muted">
              {caption.length}/{MAX_CAPTION}
            </span>
          </label>

          {error && <Alert variant="danger">{error}</Alert>}
          <Button type="submit" loading={busy} disabled={!image || preparing}>
            {busy ? "Posting…" : "Share post"}
          </Button>
        </form>
      </Card>
    </SocialPage>
  );
}
