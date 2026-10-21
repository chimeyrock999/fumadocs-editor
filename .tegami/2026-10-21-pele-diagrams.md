---
packages:
  "@fumadocs-editor/ui": minor
---

### Mermaid diagrams render with Pele

`mermaid` code blocks are now drawn by [Pele](https://pele.run) instead of
`mermaid`. Pele has no runtime dependencies and loads each diagram type on
first use. Diagrams update as you type instead of 300 ms after, use the
editor's font (or Pele's `--pele-font` variable when the page sets it), and
follow its light and dark theme. Pele has its own layout and visual style, so
diagrams look different from Mermaid's output.
