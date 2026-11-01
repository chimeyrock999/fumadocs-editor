import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as Y from "yjs";
import type { CollabBinding } from "../../src/sync/collab";
import type { SyncScope } from "../../src/sync/node/server";
import { connect, online, peer, serve, sleep, textEditor, until } from "./helpers";

let root: string;
let server: Awaited<ReturnType<typeof serve>>;

/** per payload: whether the next `authenticate` lets it in, and whether it may read */
const access = new Map<string, "full" | "no-read" | "rejected">();

const authenticate = async ({ payload }: { payload?: unknown }): Promise<SyncScope | null> => {
  if (typeof payload !== "string") return null;
  const state = access.get(payload) ?? "full";
  if (state === "rejected") return null;
  return {
    user: { name: payload },
    read: state === "full" || ((p) => !p.startsWith("doc")),
    write: state === "full",
  };
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-connections-"));
  await writeFile(path.join(root, "doc.mdx"), "# Doc\n\nfirst\n");
  await writeFile(path.join(root, "doc-file.mdx"), "# File\n");
  await writeFile(path.join(root, "other.mdx"), "# Other\n");
  server = await serve({ root, authenticate, helloTimeoutMs: 1000 });
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const handleOf = (payload: string) =>
  until(() => server.sync.connections().find((conn) => conn.payload === payload));

const joinDoc = async (token: string, file: string) => {
  const client = connect(server.url, { auth: () => token, collab: true });
  const session = client.open(file, { editor: textEditor().editor, components: [] });
  const binding = await until(() => session.collab() ?? undefined, 8000);
  return {
    client,
    binding,
    close() {
      session.close();
      client.close();
    },
  };
};

const textAt = (binding: CollabBinding, index: number): Y.XmlText =>
  (binding.doc.getXmlFragment("default").get(index) as Y.XmlElement).get(0) as Y.XmlText;

test("connections lists authenticated connections with their request, payload and user", async () => {
  const before = server.sync.connections().length;
  const waiting = await peer(server.url, "listed");
  await sleep(100);
  // no hello yet: not a connection
  expect(server.sync.connections()).toHaveLength(before);
  await waiting.hello();
  const handle = await handleOf("listed");
  expect(handle.user).toEqual({ name: "listed" });
  expect(handle.request.url).toBe("/__fde_sync");
  waiting.close();
  await waiting.closed;
  await until(() => (server.sync.connections().includes(handle) ? undefined : true));
});

test("after reauthenticate, a collab doc the connection may no longer read stops relaying to it", async () => {
  const a = await joinDoc("ann", "doc.mdx");
  const b = await joinDoc("bob", "doc.mdx");
  textAt(b.binding, 1).insert(0, "one ");
  await until(() => (textAt(a.binding, 1).toString().includes("one") ? true : undefined));

  access.set("ann", "no-read");
  expect(await (await handleOf("ann")).reauthenticate()).toBe(true);
  textAt(b.binding, 1).insert(0, "two ");
  await sleep(300);
  expect(textAt(a.binding, 1).toString()).not.toContain("two");
  // nor are its edits taken
  textAt(a.binding, 1).insert(0, "HACK ");
  await sleep(300);
  expect(textAt(b.binding, 1).toString()).not.toContain("HACK");
  a.close();
  b.close();
  access.delete("ann");
}, 15000);

test("after reauthenticate, a file the connection may no longer read is not pushed to it", async () => {
  const client = await peer(server.url, "cid");
  await client.hello();
  await client.request({ type: "subscribe", resource: "file", path: "doc-file.mdx" });
  await client.request({ type: "subscribe", resource: "file", path: "other.mdx" });
  await writeFile(path.join(root, "doc-file.mdx"), "# File v2\n");
  await until(() =>
    client.pushes.some((m) => m.type === "update" && "text" in m && m.text === "# File v2\n")
      ? true
      : undefined,
  );

  access.set("cid", "no-read");
  expect(await (await handleOf("cid")).reauthenticate()).toBe(true);
  await writeFile(path.join(root, "doc-file.mdx"), "# File v3\n");
  // a file it still reads keeps coming
  await writeFile(path.join(root, "other.mdx"), "# Other v2\n");
  await until(() =>
    client.pushes.some((m) => m.type === "update" && "text" in m && m.text === "# Other v2\n")
      ? true
      : undefined,
  );
  await sleep(200);
  expect(
    client.pushes.some((m) => m.type === "update" && "text" in m && m.text === "# File v3\n"),
  ).toBe(false);
  client.close();
  access.delete("cid");
}, 10000);

test("reauthenticate closes a connection authenticate now rejects", async () => {
  const client = connect(server.url, { auth: () => "dan" });
  await online(client);
  const handle = await handleOf("dan");
  access.set("dan", "rejected");
  expect(await handle.reauthenticate()).toBe(false);
  expect(server.sync.connections()).not.toContain(handle);
  // the reconnect meets the same answer
  await until(() => (client.status() === "denied" ? true : undefined), 8000);
  client.close();
  access.delete("dan");
}, 10000);

test("close ends the connection; the client reconnects and authenticates again", async () => {
  const client = connect(server.url, { auth: () => "eve" });
  await online(client);
  const first = await handleOf("eve");
  first.close();
  expect(server.sync.connections()).not.toContain(first);
  await until(() => (client.status() === "offline" ? true : undefined));
  await online(client);
  const second = await handleOf("eve");
  expect(second).not.toBe(first);
  client.close();
}, 10000);

test("after reauthenticate, a tree subscriber is sent the tree its new scope reads", async () => {
  const client = await peer(server.url, "fay");
  await client.hello();
  const first = await client.request({ type: "subscribe", resource: "tree" });
  expect(JSON.stringify(first)).toContain("doc.mdx");

  access.set("fay", "no-read");
  expect(await (await handleOf("fay")).reauthenticate()).toBe(true);
  const pushed = await until(() =>
    client.pushes.find((m) => m.type === "update" && m.resource === "tree"),
  );
  expect(JSON.stringify(pushed)).not.toContain("doc.mdx");
  expect(JSON.stringify(pushed)).toContain("other.mdx");
  client.close();
  access.delete("fay");
});
