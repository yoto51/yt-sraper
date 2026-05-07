# 🎬 YT Scraper

## How to run

1. Unzip the folder
2. Open Terminal, drag the folder into it (or `cd` into it)
3. Run:

```
npm install
npm start
```

4. Open your browser to **http://localhost:3131**

That's it. Everything else (yt-dlp, ffmpeg) downloads automatically on first run.

---

## ✂️ Clip Downloader

Paste a YouTube URL → set start & end times → click Download.

Cuts are **frame-accurate to the millisecond** — not snapped to keyframes.

You can type times as:
- `1:30` → 1 min 30 sec
- `1:30.500` → 1 min 30.5 sec  
- `0:01:30.500` → same with hours
- `90.5` → raw seconds

Files are saved to the `downloads/` folder inside the app.
