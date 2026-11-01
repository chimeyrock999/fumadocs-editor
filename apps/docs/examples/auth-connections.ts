import type { SyncServer } from "@fumadocs-editor/core/node";

declare const sync: SyncServer;
declare function sessionIdOf(cookie: string | undefined): string | undefined;

// signed out: end every socket of that session; reconnects are rejected
export function signedOut(sessionId: string) {
  for (const conn of sync.connections()) {
    if (sessionIdOf(conn.request.headers.cookie) === sessionId) conn.close();
  }
}

// read access taken away: check every connection again
export async function accessRevoked() {
  await Promise.all(sync.connections().map((conn) => conn.reauthenticate()));
}
