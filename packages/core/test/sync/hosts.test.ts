import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { IncomingMessage, OutgoingHttpHeaders } from "node:http";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHostCheck } from "../../src/sync/node/hosts";
import { peer, send, serve } from "./helpers";

let root: string;
let strict: Awaited<ReturnType<typeof serve>>;
let open: Awaited<ReturnType<typeof serve>>;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-hosts-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets/pic.png"), "png");
  strict = await serve({ root, allowedHosts: ["docs.internal", ".example.com"] });
  open = await serve({ root, allowedHosts: true });
});

afterAll(async () => {
  await strict.close();
  await open.close();
  await rm(root, { recursive: true, force: true });
});

const upgrade = (headers: OutgoingHttpHeaders, port = strict.port) => send(port, { headers });

describe("websocket upgrade", () => {
  test("loopback hosts and same-origin pages are accepted", async () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "[::1]", "192.168.1.20"]) {
      const authority = `${host}:${strict.port}`;
      expect(await upgrade({ host: authority })).toBe(101);
      expect(await upgrade({ host: authority, origin: `http://${authority}` })).toBe(101);
    }
    // a page on another loopback port, e.g. a separate dev server for the editor
    expect(await upgrade({ host: "127.0.0.1", origin: "http://localhost:3000" })).toBe(101);
  });

  test("a foreign Host header is refused", async () => {
    expect(await upgrade({ host: `attacker.test:${strict.port}` })).toBe(403);
    expect(await upgrade({ host: "attacker.test", origin: "http://attacker.test" })).toBe(403);
  });

  test("a foreign Origin is refused, even on a loopback Host", async () => {
    for (const origin of ["https://attacker.test", "http://10.0.0.5:8080", "null", "file://"]) {
      expect(await upgrade({ host: `127.0.0.1:${strict.port}`, origin })).toBe(403);
    }
  });

  test("allowedHosts admits exact names and subdomains for Host and Origin", async () => {
    expect(await upgrade({ host: "docs.internal", origin: "http://docs.internal" })).toBe(101);
    expect(await upgrade({ host: "sync.example.com", origin: "https://editor.example.com" })).toBe(
      101,
    );
    expect(await upgrade({ host: "example.com" })).toBe(101);
    expect(await upgrade({ host: "notexample.com" })).toBe(403);
    expect(await upgrade({ host: "docs.internal.attacker.test" })).toBe(403);
  });

  test("allowedHosts: true turns the checks off", async () => {
    expect(
      await upgrade({ host: "attacker.test", origin: "https://attacker.test" }, open.port),
    ).toBe(101);
  });

  test("an accepted connection completes the hello", async () => {
    const client = await peer(strict.url);
    expect(await client.hello()).toMatchObject({ type: "hello" });
    client.close();
  });
});

describe("media endpoints", () => {
  const foreign = { host: "attacker.test", origin: "http://attacker.test" };

  test("a foreign Host or Origin is refused before anything is read or stored", async () => {
    const before = await readdir(path.join(root, "assets"));
    for (const headers of [foreign, { host: "127.0.0.1", origin: "https://attacker.test" }]) {
      expect(
        await send(strict.port, {
          path: "/__fde_upload",
          method: "POST",
          headers: { ...headers, "content-type": "image/png" },
        }),
      ).toBe(403);
      expect(await send(strict.port, { path: "/__fde_asset/assets/pic.png", headers })).toBe(403);
    }
    expect(await readdir(path.join(root, "assets"))).toEqual(before);
  });

  test("loopback requests and the opt-out still reach the handlers", async () => {
    expect(await send(strict.port, { path: "/__fde_asset/assets/pic.png" })).toBe(200);
    expect(await send(open.port, { path: "/__fde_asset/assets/pic.png", headers: foreign })).toBe(
      200,
    );
  });
});

test("a request without a Host header is judged on its Origin alone", () => {
  const allowed = createHostCheck();
  const at = (headers: Record<string, string>) => allowed({ headers } as IncomingMessage);
  expect(at({})).toBe(true);
  expect(at({ origin: "http://localhost:5173" })).toBe(true);
  expect(at({ origin: "https://attacker.test" })).toBe(false);
});
