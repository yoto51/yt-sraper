'use strict';

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

// ─── Resolve yt-dlp binary ────────────────────────────────────────────────────
function getYtDlp() {
  const pathsFile = path.join(__dirname, '..', 'bin', 'paths.json');
  if (fs.existsSync(pathsFile)) {
    try { return JSON.parse(fs.readFileSync(pathsFile, 'utf8')).ytdlp; } catch {}
  }
  return 'yt-dlp';
}

// On Render the persistent disk is mounted at /opt/render/project/src/downloads
// Locally it sits next to the project
const DOWNLOAD_DIR = process.env.RENDER
  ? path.join('/opt/render/project/src/downloads')
  : path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ─── Timestamp helpers ────────────────────────────────────────────────────────

/** Accept seconds (number/string) or HH:MM:SS.mmm → return seconds float */
function toSeconds(val) {
  if (val === '' || val === null || val === undefined) throw new Error('Timestamp is empty');
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':');
  if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  throw new Error(`Cannot parse timestamp: "${val}"`);
}

/** Seconds → HH:MM:SS (yt-dlp section format) */
function secToHMS(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(3);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(parseFloat(s).toFixed(3)).padStart(6,'0')}`;
}

function safeFilename(title) {
  return (title || 'clip').replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_').slice(0, 60);
}

// ─── Job store ────────────────────────────────────────────────────────────────
const downloadJobs = {};
let dlCounter = 0;

function createDownloadJob(params) {
  const id = `dl_${++dlCounter}_${Date.now()}`;
  downloadJobs[id] = {
    id, status: 'pending', progress: 0, stage: 'queued',
    params, filePath: null, fileName: null, error: null,
    startedAt: new Date().toISOString(),
  };
  return id;
}

// ─── Get video info ───────────────────────────────────────────────────────────
function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const YTDLP = getYtDlp();
    execFile(YTDLP, [
      '--no-warnings', '--print-json', '--skip-download',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      url
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error('Could not fetch video info. Check the URL.'));
      try {
        resolve(JSON.parse(stdout.trim().split('\n')[0]));
      } catch { reject(new Error('Failed to parse video info')); }
    });
  });
}

// ─── Core: download with yt-dlp section cutting ───────────────────────────────
async function downloadClip(jobId, { url, startSec, endSec }) {
  const job = downloadJobs[jobId];
  job.status = 'running';
  job.stage  = 'fetching video info';
  job.progress = 5;

  try {
    const durationSec = endSec - startSec;
    if (durationSec <= 0) throw new Error('End time must be after start time');

    // ── Step 1: get title for filename ─────────────────────────────────────
    const info = await getVideoInfo(url);
    const title    = safeFilename(info.title || 'clip');
    const startLbl = secToHMS(startSec).replace(/:/g,'-');
    const endLbl   = secToHMS(endSec).replace(/:/g,'-');
    const fileName = `${title}_${startLbl}_${endLbl}.mp4`;
    const filePath = path.join(DOWNLOAD_DIR, fileName);

    job.title    = info.title;
    job.duration = info.duration;
    job.fileName = fileName;
    job.filePath = filePath;
    job.stage    = 'downloading clip';
    job.progress = 15;

    // ── Step 2: yt-dlp with --download-sections ────────────────────────────
    // Format: *START-END  (the * means time range, not chapter name)
    const section = `*${secToHMS(startSec)}-${secToHMS(endSec)}`;
    const YTDLP = getYtDlp();

    const args = [
      '--no-warnings',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--download-sections', section,
      '--force-keyframes-at-cuts',   // cleaner cut points
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '-o', filePath,
      '--newline',                   // one progress line per update
      url,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          // yt-dlp progress lines look like:
          // [download]  45.3% of ~  10.23MiB at    2.50MiB/s ETA 00:04
          const m = line.match(/\[download\]\s+([\d.]+)%/);
          if (m) {
            const dlPct = parseFloat(m[1]);
            // map 0-100% download → 15-95% of our progress bar
            job.progress = Math.round(15 + dlPct * 0.80);
            job.stage = `downloading… ${dlPct.toFixed(1)}%`;
          }
          // merging step
          if (line.includes('[Merger]') || line.includes('Merging')) {
            job.stage = 'merging streams…';
            job.progress = 96;
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        const txt = chunk.toString();
        // surface meaningful errors
        if (txt.includes('ERROR')) job._lastError = txt.trim();
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(job._lastError || `yt-dlp exited with code ${code}`));
      });

      proc.on('error', (e) => reject(new Error('yt-dlp spawn error: ' + e.message)));
    });

    // ── Done ───────────────────────────────────────────────────────────────
    // yt-dlp may append .mp4 itself — find the actual output file
    let actualPath = filePath;
    if (!fs.existsSync(actualPath)) {
      // look for any file matching the base name
      const base = path.basename(filePath, '.mp4');
      const found = fs.readdirSync(DOWNLOAD_DIR).find(f => f.startsWith(base));
      if (found) actualPath = path.join(DOWNLOAD_DIR, found);
    }

    const stat = fs.statSync(actualPath);
    job.filePath   = actualPath;
    job.fileName   = path.basename(actualPath);
    job.status     = 'done';
    job.progress   = 100;
    job.stage      = 'complete';
    job.fileSize   = stat.size;
    job.finishedAt = new Date().toISOString();

  } catch(e) {
    job.status     = 'error';
    job.stage      = 'failed';
    job.error      = e.message;
    job.finishedAt = new Date().toISOString();
  }
}

module.exports = { downloadClip, createDownloadJob, downloadJobs, toSeconds, DOWNLOAD_DIR, getVideoInfo };
