// subtitles-router.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const fetch = global.fetch || require('node-fetch'); // ensure fetch exists in Node

require('dotenv').config();

const APP_NAME = 'MySubtitleApp';
const APP_VERSION = '1.0';
const USER_AGENT = `${APP_NAME} v${APP_VERSION}`;

const OPENSUBTITLES_KEY = process.env.OPENSUBTITLES_KEY || null;
const OPENSUBTITLES_USER = process.env.OPENSUBTITLES_USER || null;
const OPENSUBTITLES_PASS = process.env.OPENSUBTITLES_PASS || null;
const API_BASE = 'https://api.opensubtitles.com/api/v1';

let osToken = null;
let osTokenExpiry = 0;

async function apiFetch(pathname, opts = {}) {
  const headers = Object.assign({}, opts.headers || {}, {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json'
  });

  if (OPENSUBTITLES_KEY) headers['Api-Key'] = OPENSUBTITLES_KEY;
  if (opts.useAuth) {
    if (!osToken) throw new Error('missing auth token');
    headers['Authorization'] = `Bearer ${osToken}`;
  }

  return fetch(`${API_BASE}${pathname}`, Object.assign({}, opts, { headers }));
}

async function ensureToken() {
  const now = Date.now();
  if (osToken && osTokenExpiry > now + 5 * 1000) return;

  if (!OPENSUBTITLES_KEY) {
    throw new Error('OPENSUBTITLES_KEY is required for downloads (to obtain bearer token)');
  }

  const loginPayload = {};
  if (OPENSUBTITLES_USER && OPENSUBTITLES_PASS) {
    loginPayload.username = OPENSUBTITLES_USER;
    loginPayload.password = OPENSUBTITLES_PASS;
  }

  const res = await apiFetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loginPayload)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => null);
    if (res.status === 401 && (!OPENSUBTITLES_USER || !OPENSUBTITLES_PASS)) {
      throw new Error('OpenSubtitles login failed (401). The API appears to require username/password; set OPENSUBTITLES_USER and OPENSUBTITLES_PASS environment variables for authenticated login.');
    }
    throw new Error(`OpenSubtitles login failed: ${res.status} ${txt || ''}`);
  }

  const json = await res.json();
  const token = json.token || json.data?.token || json?.data?.token;
  if (!token) throw new Error('OpenSubtitles login did not return a token');

  osToken = token;
  let ttlMs = 23 * 60 * 60 * 1000;
  if (json.expires_in && typeof json.expires_in === 'number') ttlMs = json.expires_in * 1000;
  osTokenExpiry = Date.now() + ttlMs;
}

module.exports = () => {
  const router = express.Router();

  router.post('/search', express.json(), async (req, res) => {
    try {
      const { searchName, language } = req.body;
      const lang = (language || 'en').toLowerCase();
      const query = encodeURIComponent(searchName);
      const pathname = `/subtitles?query=${query}&languages=${encodeURIComponent(lang)}&limit=50`;

      const apiRes = await apiFetch(pathname, { method: 'GET' });
      if (!apiRes.ok) {
        const txt = await apiRes.text().catch(() => null);
        return res.status(apiRes.status).json({ error: 'OpenSubtitles search failed', detail: txt });
      }
      const body = await apiRes.json();

      const results = (body.data || []).map(item => ({
        subtitle_id: item.attributes?.subtitle_id || item.attributes?.id || item.id,
        language: item.attributes?.language || item.language,
        download_count: item.attributes?.download_count || item.download_count,
        hearing_impaired: item.attributes?.hearing_impaired || false,
        release: item.attributes?.feature_details?.title || item.attributes?.release || item.attributes?.feature_details?.title,
        year: item.attributes?.feature_details?.year || item.attributes?.year,
        imdb_id: item.attributes?.feature_details?.imdb_id || item.attributes?.imdb_id,
        files: (item.attributes?.files || []).map(f => ({
          file_id: f.file_id || f.id,
          file_name: f.file_name,
          format: f.format || null,
          cd_number: f.cd_number || null
        })),
        raw: item
      }));

      return res.json({ results });
    } catch (err) {
      console.error('Search error', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/download', express.json(), async (req, res) => {
    try {
      const { filePath, fileId, subFormat } = req.body;
      if (!filePath || !fileId) return res.status(400).json({ error: 'filePath and fileId required' });

      const absVideo = path.resolve(filePath);
      if (!fs.existsSync(absVideo)) return res.status(404).json({ error: 'Video file not found' });

      await ensureToken();

      const payload = { file_id: Number(fileId) };
      if (subFormat) payload.sub_format = subFormat;

      const apiRes = await apiFetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        useAuth: true
      });

      if (!apiRes.ok) {
        const txt = await apiRes.text().catch(() => null);
        return res.status(apiRes.status).json({ error: 'OpenSubtitles download request failed', detail: txt });
      }
      const json = await apiRes.json();
      const downloadUrl = json.link?.url || json.data?.link || json.link || json.url || json.data?.file;
      if (!downloadUrl) return res.status(500).json({ error: 'No download URL returned by OpenSubtitles' });

      const subRes = await fetch(downloadUrl);
      if (!subRes.ok) return res.status(502).json({ error: 'Failed to download subtitle file' });

      // read as buffer
      const arrayBuffer = await subRes.arrayBuffer();
      let buf = Buffer.from(arrayBuffer);

      // Detect compression or archive and handle common case: gzip (.gz)
      const contentType = (subRes.headers.get('content-type') || '').toLowerCase();
      const contentDisp = subRes.headers.get('content-disposition') || '';
      const filenameGuess = (() => {
        try {
          const m = contentDisp.match(/filename\*=UTF-8''(.+)|filename="?([^"]+)"?/);
          return m ? decodeURIComponent(m[1] || m[2]) : null;
        } catch (e) {
          return null;
        }
      })();

      const lowerName = (filenameGuess || '').toLowerCase();

      // If gzip content-type or filename ends with .gz, attempt to gunzip
      if (contentType.includes('gzip') || lowerName.endsWith('.gz')) {
        try {
          buf = zlib.gunzipSync(buf);
        } catch (e) {
          console.warn('Failed to gunzip subtitle, continuing with raw buffer', e);
        }
      }

      // If it's a zip archive (filename ends with .zip) we can't reliably extract without extra dependency.
      // Return an error suggesting to add a zip extraction dependency instead of writing empty file.
      if (lowerName.endsWith('.zip')) {
        return res.status(415).json({ error: 'Downloaded subtitle is a ZIP archive; extract it before writing (add unzip support to the server).' });
      }

      // If buffer is empty, return error instead of writing empty file
      if (!buf || buf.length === 0) {
        return res.status(502).json({ error: 'Downloaded subtitle file is empty' });
      }

      // decide extension from filename or content-type detection
      let outExt = '.srt';
      if (filenameGuess && path.extname(filenameGuess)) outExt = path.extname(filenameGuess);
      else if (contentType.includes('vtt')) outExt = '.vtt';
      else if (contentType.includes('xml')) outExt = '.xml';

      const videoDir = path.dirname(absVideo);
      const videoBase = path.basename(absVideo, path.extname(absVideo));
      const outPath = path.join(videoDir, `${videoBase}${outExt}`);

      fs.writeFileSync(outPath, buf);
      return res.json({ success: true, path: outPath });
    } catch (err) {
      console.error('Download error', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
};
