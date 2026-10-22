---
packages:
  "@fumadocs-editor/core": patch
---

### Edited loose lists stay loose

A list that was not touched kept its source, but once anything inside it
changed, the whole list was written tight: the blank lines between its items
(and between the blocks of an item) were dropped. The list and item nodes
now keep mdast's `spread` as an attribute, so an edited list is written back
the way it was parsed. Lists made in the editor are still tight, and a new
item in a loose list is loose like its neighbours.
