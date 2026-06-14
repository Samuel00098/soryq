Real app media for the site — drop your files here, then flip the matching flags
in src/config.ts. Nothing else needs to change; until a flag is true the site
shows a polished placeholder, so it always looks finished.

────────────────────────────────────────────────────────────────────────────
1) HERO SCREENSHOT  (the big window in the hero)
   File:  screenshot.png   (a clean capture of Soryq running; ~1200px+ wide,
                            16:10-ish looks best)
   Then:  set  media.screenshotReady = true   in src/config.ts
   Result: the hero swaps its CSS mockup for your real screenshot.

────────────────────────────────────────────────────────────────────────────
2) DEMO VIDEO  ("See it in action" section)
   File:  demo.mp4         (a short screen recording of your workflow)
   File:  demo-poster.png  (optional still shown before the user hits play)
   Then:  set  media.videoReady = true   in src/config.ts
   Result: the section shows a real <video> player (poster shown until played).

   Recording checklist (you record; the wiring is already done):
   - Length: ~15–40s. Trim dead air; show momentum, not a tour.
   - Suggested beats: open project → run dev server in the terminal grid →
     edit a file (watch live preview update) → click an element with the DOM
     inspector → send it to the AI prompt → stage + commit in the Git sidebar.
   - Record at the app's native window size; 16:10 framing matches the player.
   - Export H.264 / MP4 (broadest browser support). Keep it a few MB — trim and
     compress; this file ships to every visitor.
   - The poster should be a crisp frame from the video (same aspect ratio).
   - Filenames can be anything — just update the paths in `media` (src/config.ts).

────────────────────────────────────────────────────────────────────────────
3) SCREENSHOTS GALLERY  ("A closer look" section)
   Six slots, one per app surface. Drop each PNG here with the filename below,
   then set that shot's  ready: true  in src/config.ts → gallery.shots.
   Each tile shows a labelled placeholder until its image is ready.

     shot-terminal.png   Multi-pane terminal grid   (featured — shown wider)
     shot-editor.png     CodeMirror 6 editor
     shot-preview.png    Live preview + DOM inspector
     shot-ai.png         AI assistant & orchestrator
     shot-git.png        Git in the sidebar
     shot-palette.png    Command palette

   - 16:10-ish framing looks best.
   - To change a caption, edit `title` / `blurb` for that shot in src/config.ts.
   - To hide the whole gallery for now, set  gallery.show = false  in config.ts.

Tip: large binaries committed to git bloat the repo. For the MP4 especially,
consider Git LFS or uploading via your host (Vercel) instead of committing it.
