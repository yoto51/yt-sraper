'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// ─── helpers ────────────────────────────────────────────────────────────────

function parseCount(str) {
  if (!str) return 0;
  const s = str.replace(/,/g, '').trim();
  if (s.endsWith('M')) return Math.round(parseFloat(s) * 1e6);
  if (s.endsWith('K')) return Math.round(parseFloat(s) * 1e3);
  return parseInt(s) || 0;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-accelerated-2d-canvas',
      '--single-process',
      '--no-zygote',
      '--lang=en-US',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
}

async function autoScroll(page, maxScrolls = 10) {
  for (let i = 0; i < maxScrolls; i++) {
    const prev = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1800));
    const next = await page.evaluate(() => document.body.scrollHeight);
    if (next === prev) break;
  }
}

// ─── 1. Search Videos ────────────────────────────────────────────────────────

async function scrapeSearchVideos(query, maxResults = 20) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await autoScroll(page, 5);

    const videos = await page.evaluate((max) => {
      const items = [];
      document.querySelectorAll('ytd-video-renderer').forEach(el => {
        if (items.length >= max) return;
        const titleEl = el.querySelector('#video-title');
        const metaEl = el.querySelector('#metadata-line');
        const channelEl = el.querySelector('.ytd-channel-name a');
        const thumbEl = el.querySelector('img');
        const meta = metaEl ? [...metaEl.querySelectorAll('span')].map(s => s.textContent.trim()) : [];
        items.push({
          title: titleEl?.textContent?.trim() || '',
          videoUrl: titleEl?.href || '',
          videoId: (titleEl?.href || '').match(/v=([^&]+)/)?.[1] || '',
          channelName: channelEl?.textContent?.trim() || '',
          channelUrl: channelEl?.href || '',
          views: meta[0] || '',
          uploadDate: meta[1] || '',
          duration: el.querySelector('span.ytd-thumbnail-overlay-time-status-renderer')?.textContent?.trim() || '',
          thumbnail: thumbEl?.src || thumbEl?.getAttribute('data-thumb') || '',
          description: el.querySelector('yt-formatted-string#description-text')?.textContent?.trim() || '',
        });
      });
      return items;
    }, maxResults);

    return videos;
  } finally {
    await browser.close();
  }
}

// ─── 2. Video Details ────────────────────────────────────────────────────────

async function scrapeVideoDetails(videoUrl) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  try {
    await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2500));

    // expand description
    try {
      await page.click('tp-yt-paper-button#expand');
      await new Promise(r => setTimeout(r, 500));
    } catch {}

    const data = await page.evaluate(() => {
      const getMeta = (prop) => document.querySelector(`meta[itemprop="${prop}"]`)?.getAttribute('content') || '';
      const getOg = (prop) => document.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') || '';

      const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string');
      const viewEl = document.querySelector('span.view-count');
      const dateEl = document.querySelector('#info-strings yt-formatted-string');
      const channelEl = document.querySelector('ytd-channel-name#channel-name yt-formatted-string a');
      const descEl = document.querySelector('#description-inline-expander yt-attributed-string') ||
                     document.querySelector('#description yt-formatted-string');
      const likeEl = document.querySelector('ytd-toggle-button-renderer:first-child #text');
      const categoryEl = document.querySelector('yt-formatted-string.ytd-rich-metadata-renderer');

      return {
        title: titleEl?.textContent?.trim() || getOg('og:title'),
        videoId: window.location.search.match(/v=([^&]+)/)?.[1] || '',
        videoUrl: window.location.href,
        viewCount: viewEl?.textContent?.replace(/[^0-9]/g, '') || '',
        uploadDate: dateEl?.textContent?.trim() || getMeta('uploadDate'),
        publishDate: getMeta('datePublished'),
        channelName: channelEl?.textContent?.trim() || '',
        channelUrl: channelEl?.href || '',
        channelId: channelEl?.href?.match(/\/@?([^/]+)/)?.[1] || '',
        description: descEl?.textContent?.trim() || '',
        likes: likeEl?.textContent?.trim() || '',
        category: categoryEl?.textContent?.trim() || '',
        thumbnail: getOg('og:image'),
        keywords: getMeta('keywords'),
        duration: getMeta('duration'),
        isFamilySafe: getMeta('isFamilyFriendly'),
        isLive: !!document.querySelector('.ytp-live-badge'),
      };
    });

    return data;
  } finally {
    await browser.close();
  }
}

// ─── 3. Comments ────────────────────────────────────────────────────────────

async function scrapeComments(videoUrl, maxComments = 50) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  try {
    await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => window.scrollTo(0, 600));
    await new Promise(r => setTimeout(r, 3000));

    let lastCount = 0;
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 2000));
      const count = await page.evaluate(() => document.querySelectorAll('ytd-comment-thread-renderer').length);
      if (count >= maxComments) break;
      if (count === lastCount) break;
      lastCount = count;
    }

    const comments = await page.evaluate((max) => {
      const items = [];
      document.querySelectorAll('ytd-comment-thread-renderer').forEach(el => {
        if (items.length >= max) return;
        const authorEl = el.querySelector('#author-text');
        const contentEl = el.querySelector('#content-text');
        const dateEl = el.querySelector('.published-time-text a');
        const likeEl = el.querySelector('#vote-count-middle');
        const replyEl = el.querySelector('#replies #count');
        const avatarEl = el.querySelector('#author-thumbnail img');
        const verifiedEl = el.querySelector('.ytd-badge-supported-renderer');
        items.push({
          author: authorEl?.textContent?.trim() || '',
          authorChannelUrl: authorEl?.href || '',
          authorChannelId: (authorEl?.href || '').split('@')[1]?.split('/')[0] || '',
          authorAvatar: avatarEl?.src || '',
          content: contentEl?.textContent?.trim() || '',
          publishedTime: dateEl?.textContent?.trim() || '',
          likeCount: likeEl?.textContent?.trim() || '0',
          replyCount: replyEl?.textContent?.trim() || '0',
          isVerified: !!verifiedEl,
        });
      });
      return items;
    }, maxComments);

    return comments;
  } finally {
    await browser.close();
  }
}

// ─── 4. Captions ────────────────────────────────────────────────────────────

async function scrapeCaptions(videoUrl) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  let captionData = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('timedtext') || url.includes('api/timedtext')) {
      try {
        const text = await response.text();
        if (text.includes('<text')) {
          const matches = [...text.matchAll(/<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]+)<\/text>/g)];
          captionData = matches.map(m => {
            const startMs = Math.round(parseFloat(m[1]) * 1000);
            const durMs = Math.round(parseFloat(m[2]) * 1000);
            const formatTime = (ms) => {
              const s = Math.floor(ms / 1000);
              const min = Math.floor(s / 60);
              const sec = s % 60;
              return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
            };
            return {
              startMs,
              durationMs: durMs,
              text: m[3].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
              formattedStart: formatTime(startMs),
              formattedEnd: formatTime(startMs + durMs),
            };
          });
        }
      } catch {}
    }
  });

  try {
    await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // try clicking CC button to trigger caption load
    try {
      await page.click('.ytp-subtitles-button');
      await new Promise(r => setTimeout(r, 2000));
    } catch {}

    return captionData.length > 0 ? captionData : [{ text: 'No captions found or captions are not available for this video.', startMs: 0, durationMs: 0, formattedStart: '00:00', formattedEnd: '00:00' }];
  } finally {
    await browser.close();
  }
}

// ─── 5. Channel Details ──────────────────────────────────────────────────────

async function scrapeChannelDetails(channelUrl) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  try {
    const aboutUrl = channelUrl.replace(/\/$/, '') + '/about';
    await page.goto(aboutUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const data = await page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';

      const statsEls = [...document.querySelectorAll('#right-column yt-formatted-string')];
      const links = [...document.querySelectorAll('#link-list-container a')].map(a => ({
        title: a.querySelector('.yt-simple-endpoint')?.textContent?.trim() || a.textContent.trim(),
        url: a.href,
      }));

      return {
        channelName: getText('ytd-channel-name yt-formatted-string') || getText('yt-dynamic-sizing-formatted-string'),
        channelUrl: window.location.href.replace('/about', ''),
        channelId: window.location.pathname.split('/')[1] || '',
        description: getText('#description-container yt-attributed-string') || getText('#description yt-formatted-string'),
        subscriberCount: getText('#subscriber-count') || getText('yt-formatted-string#subscriber-count'),
        viewCount: statsEls.find(e => e.textContent.includes('view'))?.textContent?.trim() || '',
        videoCount: statsEls.find(e => e.textContent.includes('video'))?.textContent?.trim() || '',
        joinedDate: statsEls.find(e => e.textContent.includes('Joined'))?.textContent?.trim() || '',
        country: statsEls.find(e => !e.textContent.includes('view') && !e.textContent.includes('video') && !e.textContent.includes('Joined') && !e.textContent.includes('subscriber'))?.textContent?.trim() || '',
        customLinks: links,
        thumbnail: getAttr('#channel-header-container img', 'src') || '',
      };
    });

    return data;
  } finally {
    await browser.close();
  }
}

// ─── 6. Channel Posts ────────────────────────────────────────────────────────

async function scrapeChannelPosts(channelUrl, maxPosts = 20) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  try {
    const postsUrl = channelUrl.replace(/\/$/, '') + '/community';
    await page.goto(postsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await autoScroll(page, 5);

    const posts = await page.evaluate((max) => {
      const items = [];
      document.querySelectorAll('ytd-backstage-post-thread-renderer').forEach(el => {
        if (items.length >= max) return;
        const authorEl = el.querySelector('#author-text');
        const contentEl = el.querySelector('#content-text yt-attributed-string') || el.querySelector('#content-text');
        const dateEl = el.querySelector('yt-formatted-string#published-time-text a');
        const likeEl = el.querySelector('#vote-count-middle');
        const commentEl = el.querySelector('#reply-button-end yt-formatted-string');
        const imageEl = el.querySelector('img.yt-img-shadow');
        const postLinkEl = el.querySelector('#published-time-text a');
        const voteEls = [...el.querySelectorAll('.choice-text')];

        items.push({
          author: authorEl?.textContent?.trim() || '',
          authorChannelUrl: authorEl?.href || '',
          content: contentEl?.textContent?.trim() || '',
          publishedTime: dateEl?.textContent?.trim() || '',
          likeCount: likeEl?.textContent?.trim() || '0',
          commentCount: commentEl?.textContent?.trim() || '0',
          imageUrl: imageEl?.src || '',
          postUrl: postLinkEl?.href || window.location.href,
          postId: (postLinkEl?.href || '').match(/posts\/([^?]+)/)?.[1] || '',
          totalVotes: voteEls.length > 0 ? voteEls.map(v => v.textContent.trim()).join(' | ') : '',
        });
      });
      return items;
    }, maxPosts);

    return posts;
  } finally {
    await browser.close();
  }
}

// ─── 7. Playlists from channel ───────────────────────────────────────────────

async function scrapePlaylists(channelUrl, maxItems = 20) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  try {
    const playlistUrl = channelUrl.replace(/\/$/, '') + '/playlists';
    await page.goto(playlistUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await autoScroll(page, 4);

    const playlists = await page.evaluate((max) => {
      const items = [];
      document.querySelectorAll('ytd-grid-playlist-renderer, ytd-playlist-renderer').forEach(el => {
        if (items.length >= max) return;
        const titleEl = el.querySelector('#video-title') || el.querySelector('a#video-title');
        const countEl = el.querySelector('yt-formatted-string.ytd-thumbnail-overlay-side-panel-renderer') || el.querySelector('#video-count-text');
        const thumbEl = el.querySelector('img');
        const linkEl = el.querySelector('a[href*="playlist"]') || titleEl;
        const updateEl = el.querySelector('.ytd-grid-playlist-renderer yt-formatted-string:last-child');

        items.push({
          title: titleEl?.textContent?.trim() || '',
          playlistUrl: linkEl?.href || '',
          playlistId: (linkEl?.href || '').match(/list=([^&]+)/)?.[1] || '',
          videoCount: countEl?.textContent?.trim() || '',
          thumbnail: thumbEl?.src || '',
          lastUpdated: updateEl?.textContent?.trim() || '',
        });
      });
      return items;
    }, maxItems);

    return playlists;
  } finally {
    await browser.close();
  }
}

// ─── 8. Shorts ───────────────────────────────────────────────────────────────

async function scrapeShorts(channelUrl, maxItems = 20) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  try {
    const shortsUrl = channelUrl.replace(/\/$/, '') + '/shorts';
    await page.goto(shortsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await autoScroll(page, 4);

    const shorts = await page.evaluate((max) => {
      const items = [];
      document.querySelectorAll('ytd-rich-item-renderer, ytd-reel-item-renderer').forEach(el => {
        if (items.length >= max) return;
        const linkEl = el.querySelector('a[href*="/shorts/"]');
        const titleEl = el.querySelector('#video-title') || el.querySelector('span#video-title');
        const viewEl = el.querySelector('span.ytd-thumbnail-overlay-resume-playback-renderer') ||
                       el.querySelector('#overlays span');
        const thumbEl = el.querySelector('img');
        const shortId = (linkEl?.href || '').match(/\/shorts\/([^?/]+)/)?.[1] || '';

        if (!linkEl) return;
        items.push({
          title: titleEl?.textContent?.trim() || el.getAttribute('aria-label') || '',
          shortUrl: linkEl?.href || '',
          shortId,
          thumbnail: thumbEl?.src || '',
          viewCount: viewEl?.textContent?.trim() || '',
          accessibilityText: el.getAttribute('aria-label') || '',
        });
      });
      return items;
    }, maxItems);

    return shorts;
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeSearchVideos,
  scrapeVideoDetails,
  scrapeComments,
  scrapeCaptions,
  scrapeChannelDetails,
  scrapeChannelPosts,
  scrapePlaylists,
  scrapeShorts,
};
