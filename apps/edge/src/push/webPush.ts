// Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption
// (RFC 8291), built on the Worker's Web Crypto only — no npm dependency, no
// Node crypto. Nothing here logs keys, endpoints or payloads.

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

const enc = new TextEncoder();

// Only the browsers' real push services. The Worker POSTs to whatever endpoint
// is stored, so an arbitrary URL must never be accepted (and sendWebPush
// re-checks before every send).
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet, Opera
  "updates.push.services.mozilla.com", // Firefox
  "push.services.mozilla.com",
  "web.push.apple.com", // Safari (macOS, iOS/iPadOS home-screen apps)
  "push.apple.com",
  "notify.windows.com", // Edge on Windows (wns2-*.notify.windows.com)
];

export function isAllowedPushEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** True when the pair looks like a P-256 VAPID key pair (65-byte public, 32-byte private). */
export function vapidKeysLookValid(keys: Partial<VapidKeys>): keys is VapidKeys {
  try {
    return (
      typeof keys.subject === "string" &&
      /^(mailto:|https:)/.test(keys.subject) &&
      b64urlDecode(keys.publicKey ?? "").length === 65 &&
      b64urlDecode(keys.publicKey ?? "")[0] === 4 &&
      b64urlDecode(keys.privateKey ?? "").length === 32
    );
  } catch {
    return false;
  }
}

async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(keys.publicKey);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for one push service origin. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 60 * 60, sub: keys.subject })),
  );
  const unsigned = `${header}.${claims}`;
  const key = await importVapidPrivateKey(keys);
  // Web Crypto returns the raw r||s form JWS ES256 expects.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/**
 * Encrypts `plaintext` for one browser subscription (RFC 8291, single record).
 * `serverKeys` and `salt` are only injectable for the RFC test vector.
 */
export async function encryptPayload(
  target: Pick<PushTarget, "p256dh" | "auth">,
  plaintext: Uint8Array,
  serverKeys?: CryptoKeyPair,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("Invalid subscription keys");

  const asKeys =
    serverKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", asKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], asKeys.privateKey, 256),
  );

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 = padding delimiter of the last (and only) record.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

export type SendResult = "sent" | "gone" | "failed";

/**
 * Sends one push. "gone" means the subscription no longer exists (404/410) and
 * should be deleted; "failed" is anything else (kept, may work next time).
 */
export async function sendWebPush(
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  options: { ttlSeconds?: number; topic?: string; urgency?: "normal" | "high" } = {},
): Promise<SendResult> {
  if (!isAllowedPushEndpoint(target.endpoint)) return "gone";
  const url = new URL(target.endpoint);

  const body = await encryptPayload(target, enc.encode(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, keys),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds ?? 24 * 60 * 60),
    Urgency: options.urgency ?? "normal",
  };
  // Replaces an undelivered push with the same topic (e.g. many messages while the phone is offline).
  if (options.topic && /^[A-Za-z0-9_-]{1,32}$/.test(options.topic)) headers.Topic = options.topic;

  try {
    const res = await fetch(url.toString(), { method: "POST", headers, body });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
