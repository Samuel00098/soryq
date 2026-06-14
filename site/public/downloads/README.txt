Drop your built installers here, then set `downloadsAvailable = true` in
src/config.ts so the download buttons become real links.

Expected filenames (edit `downloads[].href` in src/config.ts to match yours):
  - Soryq_x64-setup.exe        (Windows, NSIS installer)
  - Soryq_aarch64.dmg          (macOS, Apple Silicon)
  - Soryq_x86_64.AppImage      (Linux)

These files are served from the site root, e.g. https://yourdomain/downloads/Soryq_x64-setup.exe
Large binaries committed to git will bloat the repo — consider Git LFS or
uploading them directly in your host (Vercel) instead of committing.
