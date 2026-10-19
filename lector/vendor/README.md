# Vendored libraries

Browsers only start a Web Worker from the page's own origin, so the small JavaScript wrapper
of ffmpeg.wasm is copied here unchanged. The large ffmpeg core (`@ffmpeg/core`, about 32 MB)
is fetched from jsDelivr at runtime and cached by the browser.

| Folder | Package | Version | License |
|---|---|---|---|
| `ffmpeg/` | `@ffmpeg/ffmpeg` (dist/esm) | 0.12.15 | MIT |
