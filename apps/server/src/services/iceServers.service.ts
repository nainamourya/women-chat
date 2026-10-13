import crypto from "node:crypto";
import { env } from "../config/env.js";

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const STUN_SERVERS: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

let warnedNoTurn = false;

function hmacCredential(secret: string, username: string): string {
  return crypto.createHmac("sha1", secret).update(username).digest("base64");
}

// Builds the ICE server list a client should use for one call attempt.
// `label` scopes the credential to the requesting user (not logged, not
// persisted) — it never identifies the call/match itself.
export function getIceServers(label: string): { iceServers: IceServer[]; turnConfigured: boolean } {
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
