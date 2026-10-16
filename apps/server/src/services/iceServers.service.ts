import crypto from "node:crypto";
import { env } from "../config/env.js";

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const STUN_SERVERS: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

let warnedNoTurn = false;

function hmacCredential(secret: string, username: string): string {
  return crypto.createHmac("sha1", secret).update(username).digest("base64");
}

const METERED_FETCH_TIMEOUT_MS = 4000;

// metered.ca mints short-lived TURN credentials via its own REST API rather
// than the static shared-secret scheme below — see apps/server/.env.example.
// The response is already the exact `{urls, username?, credential?}` shape
// IceServer uses, so it's returned as-is. Never logs the request URL (it
// contains the API key in the query string) or any response body.
async function fetchMeteredIceServers(): Promise<IceServer[] | null> {
  if (!env.METERED_TURN_APP_NAME || !env.METERED_TURN_API_KEY) return null;

  const url = new URL(`https://${env.METERED_TURN_APP_NAME}.metered.live/api/v1/turn/credentials`);
  url.searchParams.set("apiKey", env.METERED_TURN_API_KEY);
  if (env.METERED_TURN_REGION) url.searchParams.set("region", env.METERED_TURN_REGION);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METERED_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[ice-servers] metered.ca credential request failed (status ${res.status}) — falling back.`);
      return null;
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || data.length === 0) {
      console.warn("[ice-servers] metered.ca returned an unexpected response shape — falling back.");
      return null;
    }
    return data as IceServer[];
  } catch {
    // Never log the error object itself — it can embed the request URL
    // (and therefore the API key) via its `cause`/`message` in some
    // runtimes. A generic message is enough to know this path failed.
    console.warn("[ice-servers] metered.ca credential request errored or timed out — falling back.");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Builds the ICE server list a client should use for one call attempt.
// `label` scopes the credential to the requesting user (not logged, not
// persisted) — it never identifies the call/match itself. Tries, in order:
// 1. metered.ca (if configured) — dynamic, per-request credentials.
// 2. TURN_URLS + TURN_STATIC_* — a static shared-secret or fixed pair.
// 3. STUN-only.
export async function getIceServers(label: string): Promise<{ iceServers: IceServer[]; turnConfigured: boolean }> {
  const meteredServers = await fetchMeteredIceServers();
  if (meteredServers) {
    return { iceServers: [...STUN_SERVERS, ...meteredServers], turnConfigured: true };
  }

  const servers: IceServer[] = [...STUN_SERVERS];
  const turnUrls =
    env.TURN_URLS?.split(",")
      .map((url) => url.trim())
      .filter(Boolean) ?? [];

  if (turnUrls.length === 0) {
    return { iceServers: servers, turnConfigured: false };
  }

  if (env.TURN_STATIC_AUTH_SECRET) {
    // Short-lived, per-request credential (coturn "REST API" / shared-secret
    // convention) — expires on its own, so nothing long-lived ever leaves
    // the server.
    const expiry = Math.floor(Date.now() / 1000) + env.TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiry}:${label}`;
    const credential = hmacCredential(env.TURN_STATIC_AUTH_SECRET, username);
    servers.push({ urls: turnUrls, username, credential });
    return { iceServers: servers, turnConfigured: true };
  }

  if (env.TURN_STATIC_USERNAME && env.TURN_STATIC_CREDENTIAL) {
    // Less secure fallback for a provider that only issues a single static
    // credential pair (no shared-secret support). Still only ever returned
    // over an authenticated API response, never committed to client source —
    // but it doesn't expire on its own, so rotate it periodically in the
    // provider's dashboard.
    servers.push({ urls: turnUrls, username: env.TURN_STATIC_USERNAME, credential: env.TURN_STATIC_CREDENTIAL });
    return { iceServers: servers, turnConfigured: true };
  }

  if (!warnedNoTurn) {
    warnedNoTurn = true;
    console.warn(
      "TURN_URLS is set but neither TURN_STATIC_AUTH_SECRET nor TURN_STATIC_USERNAME/TURN_STATIC_CREDENTIAL is " +
        "configured — falling back to STUN-only ICE servers. Calls across strict NATs/firewalls may fail.",
    );
  }
  return { iceServers: servers, turnConfigured: false };
}
