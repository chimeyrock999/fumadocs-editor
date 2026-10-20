---
packages:
  "@fumadocs-editor/core": patch
---

### `mkdir` checks write access to the folder's `meta.json`

The tree `mkdir` command creates both `<dir>/meta.json` and `<dir>/index.mdx`,
but only checked `SyncScope.write` on `index.mdx`. A scope that allowed
`index.mdx` and denied `meta.json` could still create `meta.json` this way.
`mkdir` now requires write access to both paths before it creates anything.
