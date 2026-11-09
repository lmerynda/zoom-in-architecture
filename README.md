# Zoom-in architecture

A zoomable map of a software system. Scroll in from the whole landscape to a single file and on into its code, without separate diagrams per level. Children open as soon as they are legible, edges route between cards at every depth, and the controls borrow from games: fast travel, a command wheel, target cycling and routes.

It maps the application's architecture, not its folders. The work is split in two:
- **Code supplies the facts.** It finds the application's files from its entry points, so tests, build configs and tooling drop out, and reads the references between them (imports, typed fields, calls by name) in JS/TS, C#, Java, Rust, Go and Python. It is a fast pattern scanner, not a compiler: a reference made by reflection, dependency injection by string or generated code can be missed, and nothing on the map says so.
- **An AI agent supplies the structure.** Following the [map-repo skill](skills/map-repo/SKILL.md), it groups files into the apps and components that do the work, names them, and adds the calls between processes, each with `file:line` evidence. The arrows between files come only from the code; the agent adds only cross-process links, and every one of those is checkable: the viewer shows its cited lines beside it, and `check` refuses a link without evidence. `check` proves a cited line exists and warns when it is not a line the scanner marked; whether the line supports the link is for the reader to judge, one click away.

The project uploads its map to the viewer, which shows when and from which commit each map was built; `publish --watch` updates an open map in place as the code changes. The viewer also browses hand-written [LikeC4](https://likec4.dev) models.

```bash
cd spike
npm install
npm run dev        # http://localhost:5180
node scripts/zoom.mjs install-skill   # once: the map-repo skill, for Claude Code and Codex
```

Then, in a Claude Code or Codex session in the project to map: `/map-repo .`. The project uploads its map to the viewer; the viewer never reads the project's folder.

This is a spike: a prototype for finding out what works.
- [spike/README.md](spike/README.md): running it, mapping a repository, the controls and the measuring scripts.
- [docs/research](docs/research): the landscape research behind it and what the spike found.

MIT licensed; see [LICENSE](LICENSE).
