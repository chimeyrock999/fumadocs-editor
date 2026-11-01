---
packages:
  "@fumadocs-editor/core": minor
---

### Manage open sync connections from the host

A scope was fixed for the life of a connection, and the server relayed every
update of an open document without asking `read` again, so a host could not
stop a socket whose session ended or whose access was taken away.
`SyncServer.connections()` now lists the authenticated connections, each
with its `request`, `payload` and `user`:

- `close()` ends the connection; the client reconnects and authenticates
  again.
- `reauthenticate()` runs `authenticate` again: `null` closes the
  connection, a scope replaces the current one, and files, documents and
  tree entries it may no longer read stop reaching it.
