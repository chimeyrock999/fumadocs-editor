---
packages:
  "@fumadocs-editor/ui": patch
---

### Uploaded images go where they were dropped

`insertImages` read the insert position before awaiting `MediaProvider.upload()`
and used it unchanged afterwards. If the document changed during the upload
(typing, a collaborator, a sync merge), the image landed at a stale offset:
in the wrong place, replacing the wrong text for the slash command, or
failing with `RangeError: Position N out of range` once the document had
shrunk, leaving the uploaded file without an image. The position now follows
every change made while the uploads run. Several dropped images also keep
their order instead of being inserted in reverse.
