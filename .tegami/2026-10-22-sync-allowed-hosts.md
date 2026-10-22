---
packages:
  "@fumadocs-editor/core": minor
  "@fumadocs-editor/studio": patch
---

### The sync server answers only to allowed hosts

`createSyncServer` and `editorSync` now check the `Host` and `Origin` headers
before `authenticate`, on the websocket upgrade and on the upload and asset
endpoints. `Host` must be `localhost`, a `*.localhost` name, an IP address or
an entry of the new `allowedHosts` option, which stops DNS rebinding. A
browser request must come from this server, a loopback origin or an allowed
host, which stops other web pages from opening the sync socket. Refused
requests get a 403.

`allowedHosts` follows Vite's `server.allowedHosts`: exact names, or
`.example.com` for a domain and its subdomains, and `true` turns the checks
off. `editorSync` defaults to Vite's own setting, so Studio picks it up from
`server.vite.server.allowedHosts`. If you serve the editor under a host name
other than `localhost`, add it there.
