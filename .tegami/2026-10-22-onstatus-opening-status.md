---
packages:
  "@fumadocs-editor/ui": patch
---

### `sync.onStatus` reports the status a document opens with

`onStatus` only fired when the status differed from the last value the root
held, which starts as `synced`. A document that opened clean was never
reported, and after `path` changed the host kept the previous document's
status (for example `dirty`) for the new one. `onStatus` is now called with
the current status once the document for `path` is open, again after `path`
changes, and then on every change, as before.
