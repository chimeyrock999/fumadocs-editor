import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { editorSync, type EditorSyncOptions } from "../../src/sync/vite";
import { send } from "./helpers";

let root: string | undefined;
let vite: ViteDevServer | undefined;

afterEach(async () => {
  await vite?.close();
  if (root) await rm(root, { recursive: true, force: true });
  vite = root = undefined;
});

const start = async (allowedHosts: string[] | undefined, options: EditorSyncOptions = {}) => {
  root = await mkdtemp(path.join(tmpdir(), "fde-vite-"));
  vite = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", allowedHosts, ws: false },
    plugins: [editorSync(options)],
  });
  await vite.listen();
  return (vite.httpServer!.address() as AddressInfo).port;
};

test("the sync socket refuses hosts Vite does not allow", async () => {
  const port = await start(undefined);
  expect(await send(port, { headers: { host: `localhost:${port}` } })).toBe(101);
  expect(await send(port, { headers: { host: "attacker.test" } })).toBe(403);
});

test("Vite's server.allowedHosts carries over to the sync server", async () => {
  const port = await start(["docs.internal"]);
  expect(await send(port, { headers: { host: "docs.internal" } })).toBe(101);
});

test("editorSync's own allowedHosts takes precedence", async () => {
  const port = await start(["docs.internal"], { allowedHosts: ["sync.internal"] });
  expect(await send(port, { headers: { host: "sync.internal" } })).toBe(101);
  expect(await send(port, { headers: { host: "docs.internal" } })).toBe(403);
});
