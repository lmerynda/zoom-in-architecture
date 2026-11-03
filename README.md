# Zoom-in architecture

A zoomable map of a software system. Scroll in from the whole landscape to a single file, without separate diagrams per level. Children open as soon as they are legible, edges route between cards at every depth, and the controls borrow from games: fast travel, a command wheel, target cycling and routes.

It maps the application's architecture, not its folders. The work is split in two:
- **Code supplies the facts.** It finds the application's files from its entry points, so tests, build configs and tooling drop out, and resolves every reference between them in JS/TS, C#, Java, Rust, Go and Python.
- **An AI agent supplies the structure.** Following the [map-repo skill](.claude/skills/map-repo/SKILL.md), it groups files into the apps and components that do the work, names them, and adds the calls between processes, each with `file:line` evidence. It never invents a relation between files.

The map publishes into the viewer, and source edits update the open map in place. The viewer also browses hand-written [LikeC4](https://likec4.dev) models.

```bash
cd spike
npm install
npm run dev        # http://localhost:5180
```

Then, in Claude Code in this repository: `/map-repo <path of a local repository>`.

This is a spike: a prototype for finding out what works.
- [spike/README.md](spike/README.md): running it, mapping a repository, the controls and the measuring scripts.
- [docs/research](docs/research): the landscape research behind it and what the spike found.

MIT licensed; see [LICENSE](LICENSE).
