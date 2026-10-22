import path from "node:path";
import type { Plugin } from "vite";
import { createSyncServer, type SyncServerOptions } from "./node/server";
import { ASSET_ENDPOINT, SYNC_ENDPOINT, UPLOAD_ENDPOINT } from "./protocol";

export interface EditorSyncOptions extends Omit<SyncServerOptions, "root"> {
  /** the mirrored directory, resolved against the Vite project root; defaults to it */
  root?: string;
  /**
   * See {@link SyncServerOptions.allowedHosts}. Defaults to Vite's
   * `server.allowedHosts`, so one setting covers the page and the sync server.
   */
  allowedHosts?: SyncServerOptions["allowedHosts"];
}

/**
 * Mounts the FS mirror on the Vite dev server: the sync websocket at
 * {@link SYNC_ENDPOINT}, media uploads at {@link UPLOAD_ENDPOINT} (stored
 * under `<root>/assets`, referenced as `./assets/…`), and asset serving at
 * `ASSET_ENDPOINT/<relative>` so the editor can display them.
 * Requests from hosts and origins outside `allowedHosts` are refused, then
 * `authenticate` guards every surface (see {@link SyncServerOptions.authenticate});
 * absent, everything else is allowed.
 */
export function editorSync(options: EditorSyncOptions = {}): Plugin {
  return {
    name: "fumadocs-editor-sync",
    apply: "serve",
    configureServer(server) {
      const sync = createSyncServer({
        ...options,
        root: path.resolve(server.config.root, options.root ?? "."),
        allowedHosts: options.allowedHosts ?? server.config.server.allowedHosts,
      });
      server.httpServer?.on("upgrade", (request, socket, head) => {
        if (request.url === SYNC_ENDPOINT) sync.handleUpgrade(request, socket, head as Buffer);
      });
      server.httpServer?.once("close", () => void sync.close());
      server.middlewares.use(UPLOAD_ENDPOINT, sync.handleUpload);
      server.middlewares.use(ASSET_ENDPOINT, sync.handleAsset);
    },
  };
}
