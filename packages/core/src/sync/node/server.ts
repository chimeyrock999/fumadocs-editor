import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { decodeMessage } from "../codec";
import { PROTOCOL } from "../protocol";
import { createDocAuthority } from "./authority";
import type { Connection, Incoming, Resource } from "./connection";
import { createFiles } from "./files";
import { createHostCheck, type AllowedHosts } from "./hosts";
import { createMediaHandlers, type UploadLimits } from "./media";
import { createAuthorize, type SyncAuthenticate } from "./scope";
import { createTreeResource } from "./workspace";
import { createWsCarrier } from "./ws";

export type { AllowedHosts } from "./hosts";
export type { SyncAuthenticate, SyncScope } from "./scope";

export interface SyncServerOptions {
  /** directory whose `.md`/`.mdx` files are mirrored */
  root: string;
  /**
   * Maps a connection or media request to a {@link SyncScope}; `null`
   * rejects. Runs once per connection (again on every reconnect, so
   * refreshed tokens apply) and once per HTTP media request. Absent =
   * allow-all with write, the zero-config dev behaviour.
   */
  authenticate?: SyncAuthenticate;
  /**
   * Host names the server answers to, besides `localhost`, `*.localhost` and
   * IP addresses; `true` allows any. Checked before `authenticate`, on the
   * websocket upgrade and on the media endpoints: a request whose Host header
   * names another host is refused with 403, which stops DNS rebinding. A
   * browser request is also refused when its Origin is neither this server,
   * a loopback origin nor an allowed host, which stops cross-site pages from
   * opening the websocket. Entries follow Vite's `server.allowedHosts`: an
   * exact host name, or `.example.com` for the domain and its subdomains.
   * @defaultValue `[]`
   */
  allowedHosts?: AllowedHosts;
  /** how long a connection may sit without its hello before it is closed */
  helloTimeoutMs?: number;
  /** how long an open document outlives its last client before eviction (default 60s) */
  evictAfterMs?: number;
  /**
   * Upload endpoint limits, enforced before anything is stored and
   * independent of auth: an oversized body is refused with 413, a body whose
   * content-type the pattern rejects (or that has none) with 415. Defaults:
   * 10 MiB, `image/*`.
   */
  upload?: UploadLimits;
}

export interface SyncServer {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** POST media endpoint: stores under `assets/`, requires write on the stored path */
  handleUpload(request: IncomingMessage, response: ServerResponse): void;
  /** GET asset endpoint (`/<relative>` after the mount prefix), requires read */
  handleAsset(request: IncomingMessage, response: ServerResponse): void;
  close(): Promise<void>;
}

const error = (id: unknown, message: string) => JSON.stringify({ type: "error", id, message });

/**
 * The sync protocol over the dev-server directory: files, the workspace
 * tree and collab docs as resources, every one checked against the scope
 * `authenticate` resolves at the hello, always on the normalized
 * root-relative path.
 */
export function createSyncServer({
  root,
  authenticate,
  allowedHosts,
  helloTimeoutMs = 10_000,
  evictAfterMs,
  upload = {},
}: SyncServerOptions): SyncServer {
  const authorize = createAuthorize(authenticate);
  const allowed = createHostCheck(allowedHosts);
  const files = createFiles(root, {
    changed: (relative, state) => docs.diskChanged(relative, state),
    event: (event, relative) => tree.event(event, relative),
  });
  const docs = createDocAuthority({ files, evictAfterMs });
  const tree = createTreeResource(files, async (relative) => {
    // a pending save would otherwise recreate the file
    await docs.drop(relative);
    await files.unlink(relative);
  });
  const resources = new Map<unknown, Resource>([
    ["file", files],
    ["tree", tree],
    ["doc", docs],
  ]);

  const dispatch = (conn: Connection, message: Incoming): Promise<void> | void => {
    const resource = resources.get(message.resource);
    if (resource) {
      if (message.type === "subscribe") return resource.subscribe(conn, message);
      if (message.type === "unsubscribe") return resource.unsubscribe(conn, message);
      if (message.type === "update") return resource.update(conn, message);
    }
    throw new Error(`unknown message: ${String(message.type)} ${String(message.resource)}`);
  };

  const leave = (conn: Connection) => {
    for (const resource of resources.values()) resource.leave(conn);
  };

  const carrier = createWsCarrier((peer, request) => {
    let conn: Connection | undefined;
    let authenticating = false;
    let closed = false;
    const helloTimer = setTimeout(() => {
      if (!conn) peer.close();
    }, helloTimeoutMs);

    return {
      receive(data) {
        let message: Incoming;
        try {
          message = decodeMessage(data);
        } catch {
          return;
        }
        if (!message || typeof message !== "object") return;
        if (conn) {
          const current = conn;
          const fail = (reason: unknown) => {
            const text = reason instanceof Error ? reason.message : String(reason);
            if (typeof message.id === "number") current.send(error(message.id, text));
          };
          try {
            void dispatch(current, message)?.then(() => {
              // closed while the resource awaited IO: it registered after `leave` ran
              if (closed) leave(current);
            }, fail);
          } catch (reason) {
            fail(reason);
          }
          return;
        }
        // nothing precedes authentication: only the first hello starts the exchange
        if (message.type !== "hello" || authenticating) {
          if (typeof message.id === "number") peer.send(error(message.id, "not authenticated"));
          return;
        }
        if (message.protocol !== PROTOCOL) {
          peer.send(error(message.id, `unsupported protocol: ${String(message.protocol)}`));
          return peer.close();
        }
        authenticating = true;
        void authorize(request, message.auth).then((scope) => {
          if (closed) return;
          if (!scope) {
            peer.send(error(message.id, "access denied"));
            return peer.close();
          }
          clearTimeout(helloTimer);
          conn = { scope, send: peer.send };
          peer.send(JSON.stringify({ type: "hello", id: message.id, user: scope.user }));
        });
      },
      closed() {
        closed = true;
        clearTimeout(helloTimer);
        if (conn) leave(conn);
      },
    };
  });

  const media = createMediaHandlers(files, authorize, upload);

  return {
    handleUpgrade(request, socket, head) {
      if (allowed(request)) return carrier.handleUpgrade(request, socket, head);
      socket.once("finish", () => socket.destroy());
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    },

    handleUpload(request, response) {
      if (allowed(request)) return media.handleUpload(request, response);
      response.statusCode = 403;
      response.end();
    },

    handleAsset(request, response) {
      if (allowed(request)) return media.handleAsset(request, response);
      response.statusCode = 403;
      response.end();
    },

    async close() {
      tree.close();
      await files.close();
      await docs.close();
      carrier.close();
    },
  };
}
