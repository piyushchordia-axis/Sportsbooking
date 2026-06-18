---
name: External SVGs via <img> ignore currentColor
description: Why icon SVGs served from /public and rendered with <img> must bake explicit colors
---

# External SVG `<img>` does not inherit `currentColor`

When an SVG is referenced as `<img src="/images/...svg">` (or as a CSS
`background-image`), it renders in its **own** document context. `currentColor`
inside that SVG resolves to the SVG root's computed color (defaults to black),
**not** the surrounding page's text color. On a dark theme this makes the icon
invisible.

**Why:** the web app stores some icon paths in the DB (e.g. game `iconUrl`) and
serves them statically, so they must be plain files rendered via `<img>`. Inline
React/SVG components would inherit `currentColor`, but a DB-served URL cannot.

**How to apply:** for any SVG that will be loaded via `<img>` or as a CSS
background, bake an explicit `stroke`/`fill` (e.g. the brand color) into the file
instead of `currentColor`. Only use `currentColor` for SVGs inlined directly in
JSX. If an icon must follow theme/owner branding dynamically, inline it instead
of serving it as a file.
