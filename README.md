# Zoom-in architecture

A zoomable map of a software system. Scroll in from the whole landscape to a single file, without separate diagrams per level. Children open as soon as they are legible, edges route between cards at every depth, and the controls borrow from games: fast travel, a command wheel, target cycling and routes.

Point it at a repository and it builds the map from the code. Projects come from `.csproj`, `Cargo.toml`, `package.json` and Unity folders, and relations come from references between files. It also browses hand-written [LikeC4](https://likec4.dev) models. Editing either updates the open map in place.

```bash
cd spike
npm install
npm run dev        # http://localhost:5180, then "+ Import" and the path of a local repository
```

This is a spike: a prototype for finding out what works.
- [spike/README.md](spike/README.md): running it, importing, the controls and the measuring scripts.
- [docs/research](docs/research): the landscape research behind it and what the spike found.

MIT licensed; see [LICENSE](LICENSE).
