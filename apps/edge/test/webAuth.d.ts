// Type stub for the web app's session helper, which the web-proxy rehearsal test
// (webProxy.test.ts) replaces at runtime. Lets the edge typecheck follow the
// import from apps/web without pulling in the web app's auth stack.
declare module "@/lib/auth" {
  export function auth(): Promise<{ user?: { id?: string } } | null>;
}
