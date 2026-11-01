import { readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Each test Worker keeps its Durable Object state in a fresh temp directory
// (see localWorker.ts). Windows can still hold a file for a moment after the
// process is killed, so the per-Worker cleanup is best-effort; this removes
// whatever is left once the whole run is over.
export default function globalSetup() {
  return () => {
    for (const name of readdirSync(os.tmpdir())) {
      if (!name.startsWith("edge-do-state-")) continue;
      try {
        rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        // a temp directory; nothing depends on it
      }
    }
  };
}
