---
packages:
  "@fumadocs-editor/core": patch
---

### A document opened while the client is offline settles `opened`

`opened` settled when the client went offline or was denied after the
document was opened, but not when it was already offline: the status
listener only hears changes, and a failed reconnect keeps the status at
`offline`. Such a document stayed loading until the client came back online,
which may be never. `opened` now rejects at once when the client is already
offline or denied, so the editor falls back to its own content, and a later
answer still merges in after a reconnect.
