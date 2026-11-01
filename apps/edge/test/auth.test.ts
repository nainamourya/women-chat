import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_INTERNAL_SECRET, startLocalWorker, type RunningWorker } from "./localWorker";
import { Fixtures } from "./seed";

// The server's auth router on the Worker: same validation and responses, with
// the Durable Object limiter underneath and CF-Connecting-IP as the client
// address. (`cf-connecting-ip` is sent by hand here; on Cloudflare the edge sets
// it and overwrites any client-supplied value.)
const SECRET = { "x-internal-api-secret": TEST_INTERNAL_SECRET };

let worker: RunningWorker;
let fx: Fixtures;
const createdEmails: string[] = [];

beforeAll(async () => {
  fx = new Fixtures();
  worker = await startLocalWorker(8860);
});
afterAll(async () => {
  worker?.stop();
  await fx?.cleanup();
  // Accounts created through the register / Google routes are not tracked by Fixtures.
  if (createdEmails.length > 0) {
    const { default: postgres } = await import("postgres");
    const { guardedTestDatabaseUrl } = await import("./localWorker");
    const sql = postgres(guardedTestDatabaseUrl(), { max: 1 });
    await sql`delete from users where email = any(${createdEmails})`;
    await sql.end({ timeout: 2 });
  }
});

let n = 0;
const uniqueIp = () => `192.0.2.${n++}`; // any distinct string works as a limiter key
const email = () => {
  const value = `edge-auth-${Date.now().toString(36)}-${n++}@example.test`;
  createdEmails.push(value);
  return value;
};

async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}, secret = true) {
  const res = await fetch(`${worker.baseUrl}/api/auth${path}`, {
    method,
    headers: { ...(secret ? SECRET : {}), "content-type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any, headers: res.headers };
}

const register = (e: string, ip: string, extra: Record<string, unknown> = {}) =>
  call("POST", "/register", { email: e, password: "correct horse battery", displayName: "Edge Tester", ageConfirmed18: true, ...extra }, { "cf-connecting-ip": ip });

describe("auth routes", () => {
  it("needs the internal secret", async () => {
    for (const [method, path, body] of [
      ["POST", "/register", {}],
      ["POST", "/login", {}],
      ["POST", "/oauth/google", {}],
      ["POST", "/confirm-age", {}],
      ["GET", `/account-status/${crypto.randomUUID()}`, undefined],
    ] as const) {
      const res = await call(method, path, body, {}, false);
      expect(res.status, path).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized." });
    }
  });

  it("register validates input", async () => {
    const ip = uniqueIp();
    for (const bad of [{ email: "nope" }, { password: "short" }, { displayName: "x" }, { ageConfirmed18: "yes" }]) {
      const res = await register(email(), ip, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body).toHaveProperty("error");
    }
  });

  it("registers a member without exposing the password hash, refuses a duplicate email, and logs in", async () => {
    const ip = uniqueIp();
    const e = email();
    const created = await register(e, ip);
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ email: e, displayName: "Edge Tester" });
    expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);

    const duplicate = await register(e, ip);
    expect(duplicate.status).toBe(409);

    const login = await call("POST", "/login", { email: e, password: "correct horse battery" }, { "cf-connecting-ip": ip });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email: e });
    expect(JSON.stringify(login.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("a wrong password and an unknown email give the same generic 401", async () => {
    const ip = uniqueIp();
    const e = email();
    await register(e, ip);
    const wrong = await call("POST", "/login", { email: e, password: "not the password" }, { "cf-connecting-ip": ip });
    const unknown = await call("POST", "/login", { email: email(), password: "whatever" }, { "cf-connecting-ip": ip });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("limits logins per email (5 per 15 minutes) regardless of IP", async () => {
    const e = email();
    for (let i = 0; i < 5; i++) {
      const res = await call("POST", "/login", { email: e, password: "x" }, { "cf-connecting-ip": uniqueIp() });
      expect(res.status).toBe(401);
    }
    const limited = await call("POST", "/login", { email: e.toUpperCase(), password: "x" }, { "cf-connecting-ip": uniqueIp() });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many attempts. Please try again later." });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("limits logins per client IP (20 per 15 minutes), using CF-Connecting-IP, and counts malformed requests", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 20; i++) {
      const res = await call("POST", "/login", i % 2 ? { email: `bad-email-${n++}` } : { email: email(), password: "x" }, { "cf-connecting-ip": ip });
      expect([400, 401]).toContain(res.status);
    }
    expect((await call("POST", "/login", { email: email(), password: "x" }, { "cf-connecting-ip": ip })).status).toBe(429);
    // A different address is unaffected.
    expect((await call("POST", "/login", { email: email(), password: "x" }, { "cf-connecting-ip": uniqueIp() })).status).toBe(401);
  }, 60_000);

  it("limits registrations per client IP (5 per hour)", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) expect((await register(email(), ip)).status).toBe(201);
    const limited = await register(email(), ip);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many attempts. Please try again later." });
  });

  it("each client address has its own register budget", async () => {
    // On Cloudflare the edge sets CF-Connecting-IP and overwrites any client value, so
    // the header cannot be used to dodge a limit from outside. (Local wrangler always
    // supplies an address, so the 'no address at all' branch of the routes cannot be
    // reached here; it is the same `if (req.ip)` guard the Express server has.)
    const a = uniqueIp();
    const b = uniqueIp();
    for (let i = 0; i < 5; i++) expect((await register(email(), a)).status).toBe(201);
    expect((await register(email(), a)).status).toBe(429);
    expect((await register(email(), b)).status).toBe(201);
  });

  it("account-status reports active, deleted and unknown members", async () => {
    const active = await fx.member();
    const deleted = await fx.member({ accountStatus: "deleted" });
    expect((await call("GET", `/account-status/${active.id}`)).body).toEqual({ accountStatus: "active" });
    expect((await call("GET", `/account-status/${deleted.id}`)).body).toEqual({ accountStatus: "deleted" });
    expect((await call("GET", `/account-status/${crypto.randomUUID()}`)).body).toEqual({ accountStatus: "deleted" });
    const bad = await call("GET", "/account-status/nope");
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "Invalid user id." });
  });

  it("Google sign-in creates the member once and finds them again", async () => {
    const e = email();
    const body = { email: e, googleId: `g-${crypto.randomUUID()}`, displayName: "Gina" };
    const first = await call("POST", "/oauth/google", body);
    expect(first.status).toBe(200);
    const second = await call("POST", "/oauth/google", body);
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect((await call("POST", "/oauth/google", { email: "nope" })).status).toBe(400);
  });

  it("confirm-age validates its input", async () => {
    expect((await call("POST", "/confirm-age", { userId: "nope" })).status).toBe(400);
    const member = await fx.member({ ageConfirmed18: false });
    const res = await call("POST", "/confirm-age", { userId: member.id });
    expect(res.status).toBe(200);
  });

  it("password hashing cost (informational): register and login time on the local runtime", async () => {
    const ip = uniqueIp();
    const e = email();
    const t0 = performance.now();
    await register(e, ip);
    const registerMs = performance.now() - t0;
    const t1 = performance.now();
    await call("POST", "/login", { email: e, password: "correct horse battery" }, { "cf-connecting-ip": ip });
    const loginMs = performance.now() - t1;
    console.log(`[info] local workerd: register ${registerMs.toFixed(0)} ms, login ${loginMs.toFixed(0)} ms (wall time, includes DB; NOT Cloudflare CPU time)`);
    expect(registerMs).toBeLessThan(10_000);
  });
});

describe("verification routes that remain on the server's router", () => {
  it("status returns the member's latest submission (none yet), and validates the id", async () => {
    const m = await fx.member();
    const res = await fetch(`${worker.baseUrl}/api/verification/video/status/${m.id}`, { headers: SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ submission: null });
    expect((await fetch(`${worker.baseUrl}/api/verification/video/status/nope`, { headers: SECRET })).status).toBe(400);
  });

  it("the prototype simulate route is a 404 outside development (it cannot skip human review)", async () => {
    const m = await fx.member({ verificationStatus: "unverified" });
    const res = await fetch(`${worker.baseUrl}/api/verification/simulate`, {
      method: "POST",
      headers: { ...SECRET, "content-type": "application/json" },
      body: JSON.stringify({ userId: m.id }),
    });
    expect(res.status).toBe(404);
    const profile = await fetch(`${worker.baseUrl}/api/profile/${m.id}`, { headers: SECRET });
    expect(((await profile.json()) as any).profile.verificationStatus).toBe("unverified");
  });
});
