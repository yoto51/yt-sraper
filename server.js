'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { downloadClip, createDownloadJob, downloadJobs, toSeconds, DOWNLOAD_DIR } = require('./src/downloader');
const {
  scrapeSearchVideos,
  scrapeVideoDetails,
  scrapeComments,
  scrapeCaptions,
  scrapeChannelDetails,
  scrapeChannelPosts,
  scrapePlaylists,
  scrapeShorts,
} = require('./src/scraper');
const { toCSV, toJSON, toXLSX, toHTML } = require('./src/exporter');

const app = express();
const PORT = process.env.PORT || 3131;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Job Queue (simple in-memory) ────────────────────────────────────────────
const jobs = {};
let jobCounter = 0;

function createJob(type, params) {
  const id = `job_${++jobCounter}_${Date.now()}`;
  jobs[id] = { id, type, params, status: 'running', startedAt: new Date().toISOString(), data: null, error: null };
  return id;
}

function finishJob(id, data) {
  if (jobs[id]) { jobs[id].status = 'done'; jobs[id].data = data; jobs[id].finishedAt = new Date().toISOString(); }
}

function failJob(id, err) {
  if (jobs[id]) { jobs[id].status = 'error'; jobs[id].error = err.message || String(err); jobs[id].finishedAt = new Date().toISOString(); }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/status', (_, res) => res.json({ ok: true, jobs: Object.values(jobs).slice(-20) }));

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Search Videos
app.post('/api/scrape/videos', async (req, res) => {
  const { query, maxResults = 20 } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  const id = createJob('videos', { query, maxResults });
  res.json({ jobId: id });
  scrapeSearchVideos(query, maxResults).then(d => finishJob(id, d)).catch(e => failJob(id, e));
});

// Video Details
app.post('/api/scrape/video-details', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const id = createJob('video-details', { url });
  res.json({ jobId: id });
  scrapeVideoDetails(url).then(d => finishJob(id, [d])).catch(e => failJob(id, e));
});

// Comments
app.post('/api/scrape/comments', async (req, res) => {
  const { url, maxComments = 50 } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const id = createJob('comments', { url, maxComments });
  res.json({ jobId: id });
  scrapeComments(url, maxComments).then(d => finishJob(id, d)).catch(e => failJob(id, e));
});

// Captions
app.post('/api/scrape/captions', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const id = createJob('captions', { url });
  res.json({ jobId: id });
  scrapeCaptions(url).then(d => finishJob(id, d)).catch(e => failJob(id, e));
});

// Channel Details
app.post('/api/scrape/channel', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const id = createJob('channel', { url });
  res.json({ jobId: id });
  scrapeChannelDetails(url).then(d => finishJob(id, [d])).catch(e => failJob(id, e));
});

// Channel Posts
app.post('/api/scrape/posts', async (req, res) => {
  const { url, maxPosts = 20 } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const id = createJob('posts', { url, maxPosts });
  res.json({ jobId: id });
  scrapeChannelPosts(url, maxPosts).then(d => finishJob(id, d)).catch(e => failJob(id, e));
});

// Playlists
app.post('/api/scrape/playlists', async (req, res) => {
  const { url, maxItems = 20 } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const id = createJob('playlists', { url, maxItems });
  res.json({ jobId: id });
  scrapePlaylists(url, maxItems).then(d => finishJob(id, d)).catch(e => failJob(id, e));
});

// Shorts
app.post('/api/scrape/shorts', async (req, res) => {
  const { url, maxItems = 20 } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const id = createJob('shorts', { url, maxItems });
  res.json({ jobId: id });
  scrapeShorts(url, maxItems).then(d => finishJob(id, d)).catch(e => failJob(id, e));
});

// ─── Export ───────────────────────────────────────────────────────────────────

app.get('/api/export/:jobId/:format', (req, res) => {
  const { jobId, format } = req.params;
  const job = jobs[jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'done') return res.status(400).json({ error: 'Job not finished yet' });
  const data = job.data || [];
  const name = `yt_${job.type}_${jobId}`;

  if (format === 'csv') {
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    return res.send(toCSV(data));
  }
  if (format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${name}.json"`);
    res.setHeader('Content-Type', 'application/json');
    return res.send(toJSON(data));
  }
  if (format === 'xlsx') {
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(toXLSX(data));
  }
  if (format === 'html') {
    res.setHeader('Content-Disposition', `attachment; filename="${name}.html"`);
    res.setHeader('Content-Type', 'text/html');
    return res.send(toHTML(data));
  }
  res.status(400).json({ error: 'Unknown format. Use csv, json, xlsx, or html' });
});

app.listen(PORT, () => {
  console.log(`\n🎬  YouTube Scraper running at http://localhost:${PORT}\n`);
});

// ─── Download / Clip Routes ───────────────────────────────────────────────────

app.post('/api/download/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const { execFile } = require('child_process');
  const { downloadJobs: _dj, DOWNLOAD_DIR: _dd, ...binPaths } = require('./src/downloader');
  const ytdlpBin = (() => { try { return JSON.parse(require('fs').readFileSync('./bin/paths.json','utf8')).ytdlp; } catch { return 'yt-dlp'; } })();
  execFile(ytdlpBin, [
    '--no-warnings', '--print-json', '--skip-download',
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    url
  ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
    if (err) return res.status(400).json({ error: 'Could not fetch video info. Check the URL.' });
    try {
      const info = JSON.parse(stdout.trim().split('\n')[0]);
      res.json({
        title: info.title,
        duration: info.duration,
        thumbnail: info.thumbnail,
        uploader: info.uploader,
        viewCount: info.view_count,
      });
    } catch { res.status(500).json({ error: 'Failed to parse video info' }); }
  });
});

app.post('/api/download/clip', async (req, res) => {
  const { url, start, end } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (start === undefined || start === '') return res.status(400).json({ error: 'start time is required' });
  if (end === undefined || end === '') return res.status(400).json({ error: 'end time is required' });
  let startSec, endSec;
  try {
    startSec = toSeconds(start);
    endSec   = toSeconds(end);
  } catch(e) { return res.status(400).json({ error: e.message }); }
  if (endSec <= startSec) return res.status(400).json({ error: 'End time must be after start time' });
  const jobId = createDownloadJob({ url, start, end, startSec, endSec });
  res.json({ jobId });
  downloadClip(jobId, { url, startSec, endSec });
});

app.get('/api/download/status/:jobId', (req, res) => {
  const job = downloadJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/download/file/:jobId', (req, res) => {
  const job = downloadJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'done') return res.status(400).json({ error: 'File not ready yet' });
  if (!fs.existsSync(job.filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.download(job.filePath, job.fileName);
});

app.get('/api/download/jobs', (req, res) => {
  res.json(Object.values(downloadJobs).slice(-50).reverse());
});
