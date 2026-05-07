#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const BIN_DIR    = path.join(__dirname, 'bin');
const PATHS_FILE = path.join(BIN_DIR, 'paths.json');

if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

const isWin  = process.platform === 'win32';
const isMac  = process.platform === 'darwin';
const isArm  = os.arch() === 'arm64';

// Binary name per platform
const BIN_NAME = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);

// yt-dlp release URL per platform
const YTDLP_URL = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : isMac
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    : isArm
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

const G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m', R = '\x1b[31m', RST = '\x1b[0m';
const ok  = (s) => console.log(`${G}  ✓ ${s}${RST}`);
const inf = (s) => console.log(`${C}  → ${s}${RST}`);
const err = (s) => console.log(`${R}  ✗ ${s}${RST}`);

function binaryWorks(bin) {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 8000 }); return true; }
  catch { return false; }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const total = parseInt(res.headers['content-length'] || '0');
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total) process.stdout.write(`\r  ${Math.round(received/total*100)}% (${(received/1024/1024).toFixed(1)} MB)  `);
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
      }).on('error', reject);
    };
    get(url);
  });
}

async function main() {
  const platform = isWin ? 'Windows' : isMac ? 'macOS' : 'Linux';
  console.log(`\n${Y}  YT Scraper — Setup (${platform})${RST}`);

  // Already good — skip
  if (fs.existsSync(BIN_PATH) && binaryWorks(BIN_PATH)) {
    ok(`yt-dlp ready (${BIN_PATH})`);
    fs.writeFileSync(PATHS_FILE, JSON.stringify({ ytdlp: BIN_PATH }, null, 2));
    return;
  }

  inf(`Downloading yt-dlp for ${platform} (one-time)...`);
  try {
    await download(YTDLP_URL, BIN_PATH);
    if (!isWin) fs.chmodSync(BIN_PATH, 0o755);
    if (!binaryWorks(BIN_PATH)) throw new Error('Binary downloaded but cannot execute');
    fs.writeFileSync(PATHS_FILE, JSON.stringify({ ytdlp: BIN_PATH }, null, 2));
    ok('yt-dlp ready\n');
  } catch(e) {
    err('Could not auto-download yt-dlp: ' + e.message);
    process.exit(1);
  }
}

main();
