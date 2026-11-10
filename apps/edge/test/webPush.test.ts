import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, encryptPayload, isAllowedPushEndpoint, vapidAuthorization, vapidKeysLookValid } from "../src/push/webPush";

// Pure crypto checks; no Worker, no network.
const enc = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// The receiving browser's side of RFC 8291, written independently of the sender.
async function decrypt(body: Uint8Array, uaKeys: CryptoKeyPair, uaPublic: Uint8Array, authSecret: Uint8Array) {
  const salt = body.slice(0, 16);
  const idLen = body[20];
  const asPublic = body.slice(21, 21 + idLen);
  const ciphertext = body.slice(21 + idLen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], uaKeys.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  expect(padded[padded.length - 1]).toBe(2); // last-record delimiter
  return new TextDecoder().decode(padded.slice(0, -1));
}

async function newBrowserSubscription() {
  const uaKeys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPublic = new Uint8Array((await crypto.subtle.exportKey("raw", uaKeys.publicKey)) as ArrayBuffer);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { uaKeys, uaPublic, authSecret, target: { p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(authSecret) } };
}

async function newVapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { pair, keys: { publicKey: b64urlEncode(publicRaw), privateKey: jwk.d!, subject: "mailto:support@giigirl.com" } };
}

describe("Web Push payload encryption (RFC 8291)", () => {
  it("a browser holding the subscription keys can decrypt the payload", async () => {
    const sub = await newBrowserSubscription();
    const message = JSON.stringify({ title: "GiiGirl", body: "You have a new message", url: "/messages" });
    const body = await encryptPayload(sub.target, enc.encode(message));

    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096); // record size
    expect(body[20]).toBe(65); // key id = sender's uncompressed public key
    expect(await decrypt(body, sub.uaKeys, sub.uaPublic, sub.authSecret)).toBe(message);
  });

  it("matches the RFC 8291 Appendix A test vector byte for byte", async () => {
    const asPublic = b64urlDecode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", x: b64urlEncode(asPublic.slice(1, 33)), y: b64urlEncode(asPublic.slice(33)) },
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const publicKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, true, []);
    const body = await encryptPayload(
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      enc.encode("When I grow up, I want to be a watermelon"),
      { publicKey, privateKey },
      b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"),
    );
    expect(b64urlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("uses a fresh key and salt every time (no two bodies alike)", async () => {
    const sub = await newBrowserSubscription();
    const a = await encryptPayload(sub.target, enc.encode("same"));
    const b = await encryptPayload(sub.target, enc.encode("same"));
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
  });

  it("someone with a different auth secret cannot decrypt", async () => {
    const sub = await newBrowserSubscription();
    const body = await encryptPayload(sub.target, enc.encode("secret"));
    await expect(decrypt(body, sub.uaKeys, sub.uaPublic, crypto.getRandomValues(new Uint8Array(16)))).rejects.toThrow();
  });

  it("rejects malformed subscription keys", async () => {
    await expect(encryptPayload({ p256dh: "AAAA", auth: "AAAA" }, enc.encode("x"))).rejects.toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a JWT for the push service's origin that verifies with the public key", async () => {
    const { pair, keys } = await newVapidKeys();
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc123", keys, 1_800_000_000);
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [jwt, k] = [match![1], match![2]];
    expect(k).toBe(keys.publicKey);

    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 12 * 3600, sub: "mailto:support@giigirl.com" });

    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64urlDecode(s), enc.encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("only accepts a well-formed P-256 key pair and a mailto:/https: subject", async () => {
    const { keys } = await newVapidKeys();
    expect(vapidKeysLookValid(keys)).toBe(true);
    expect(vapidKeysLookValid({ ...keys, subject: "support@giigirl.com" })).toBe(false);
    expect(vapidKeysLookValid({ ...keys, privateKey: "short" })).toBe(false);
    expect(vapidKeysLookValid({ ...keys, publicKey: undefined })).toBe(false);
  });
});

describe("push endpoint allow-list", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QAbc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts the real push service %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc", // not https
    "https://evil.example/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.example/x",
    "https://notfcm.googleapis.com/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://127.0.0.1/x",
    "not a url",
  ])("refuses %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});
