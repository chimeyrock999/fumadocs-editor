---
packages:
  "@fumadocs-editor/ui": minor
---

### Add behaviour with `extensions`

`MdxEditor.Root` (and `MdxEditor`) take `extensions`: TipTap extensions
for behaviour on top of the document, such as decorations over text,
keyboard shortcuts, plugin state or commands. Like `components`, the list
is fixed for the life of the root. It is applied to every live editor the
root builds, also after a switch back from the MDX tab and in a read-only
editor. Built-in shortcuts and plugins, TipTap's core ones included, win a
tie in `priority`. An extension that adds a node or a mark, or takes a name
or a command already in use, is left out with a console error. See the new
Extensions page.
