# Entropy

A personal writing dashboard for stories & graphic novels. Word-like document editor,
real file/folder management, Word/Excel/PDF/image import, and Claude built in for
writing help and document search. Installable as a PWA on desktop **and iPad**.

## Run it

```bash
npm install
npm run gen:icons   # one-time: generates PWA icons (or: node scripts/gen-icons.js)
npm run dev
```

Open http://localhost:5173

- **Backend** (file management + Claude proxy) runs on `:5174`.
- **Frontend** (Vite) runs on `:5173` and proxies `/api` + `/files` to the backend.

### Connect Claude
Click **Settings** (sidebar) → paste your Anthropic API key → Save. The key is stored
locally in `.entropy/config.json` and only ever sent to Anthropic.

### Where do my files live?
Everything is real files on disk under `entropy-workspace/` (override with the
`ENTROPY_WORKSPACE` env var). Projects are top-level folders; documents are saved as
portable `.html` files.

## Install on iPad / desktop (PWA)
Run the production build and serve it, then "Add to Home Screen" (iPad Safari) or use
the install button in the address bar (Chrome/Edge desktop):

```bash
npm run build
npm start            # serves the built app on :5174
```

For iPad, point Safari at your PC's LAN address (e.g. `http://192.168.x.x:5174`) while
the server is running on your machine.

## Going fully native later
This is structured so it can be wrapped in **Tauri 2** (desktop installers + iOS) without
rewriting the UI — the backend logic moves into Tauri commands.
