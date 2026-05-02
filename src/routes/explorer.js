// routes/explorer.js
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');
const picomatch = require('picomatch');
const { z } = require('zod');
const multer = require('multer');

const extensions = require('../constants/extensions.json');
const { trashPaths } = require('../lib/server/trash');
const { pickNativeFolder } = require('../lib/server/nativeFolderDialog');
const { createSemaphore } = require('../lib/server/thumbnailQueue');
const { runFFmpeg } = require('./util');
const { getFfmpegPath, getFfprobePath } = require('../lib/server/ffmpegPath');

const THUMB_SIZE = 256;
const THUMB_DIR = path.join(os.homedir(), '.cache', 'media-utils', 'thumbnails');
const MAX_SEARCH = 5000;
const TEXT_PREVIEW_BYTES = 256 * 1024;

const uploadPngToDownloads = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }
});

function getDownloadsDir() {
  const custom = process.env.XDG_DOWNLOAD_DIR;
  if (custom && String(custom).trim()) return path.resolve(String(custom).trim());
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.USERPROFILE || home, 'Downloads');
  }
  return path.join(home, 'Downloads');
}

/** send() treats path segments like `.cache` as dotfiles and 404s unless allowed */
const SEND_DOTFILES_ALLOW = { dotfiles: 'allow' };

const allExts = new Set([
  ...extensions.VIDEO_EXTS,
  ...extensions.IMAGE_EXTS,
  ...extensions.PDF_EXTS,
  ...extensions.TEXT_EXTS,
  ...extensions.AUDIO_EXTS
]);

const thumbQueue = createSemaphore(3);

const jobs = new Map();

function jobCreate() {
  const id = randomUUID();
  jobs.set(id, { status: 'queued', progress: 0, message: '', error: null, result: null });
  return id;
}

function jobUpdate(id, patch) {
  const j = jobs.get(id);
  if (j) Object.assign(j, patch);
}

function ensureThumbDir() {
  try {
    fs.mkdirSync(THUMB_DIR, { recursive: true });
  } catch (e) {
    /* ignore */
  }
}

function resolveUnderRoot(rootFolder, rel) {
  const absRoot = path.resolve(rootFolder);
  const abs = path.resolve(absRoot, rel);
  if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) return null;
  return abs;
}

function fileKindByName(name) {
  const ext = path.extname(name).toLowerCase();
  if (extensions.VIDEO_EXTS.includes(ext)) return 'video';
  if (extensions.AUDIO_EXTS.includes(ext)) return 'audio';
  if (extensions.IMAGE_EXTS.includes(ext)) return 'image';
  if (extensions.PDF_EXTS.includes(ext)) return 'pdf';
  if (extensions.TEXT_EXTS.includes(ext)) return 'text';
  return 'other';
}

function matchesSearch(relPath, pattern) {
  const p = (pattern || '').trim();
  if (!p) return true;
  const base = path.basename(relPath);
  if (/[*?[\]{}]/.test(p)) {
    try {
      const pm = picomatch(p, { dot: true });
      return pm(relPath) || pm(base) || picomatch(p, { basename: true })(base);
    } catch (e) {
      return relPath.toLowerCase().includes(p.toLowerCase());
    }
  }
  const low = p.toLowerCase();
  return relPath.toLowerCase().includes(low) || base.toLowerCase().includes(low);
}

function sortFiles(files, sort, order) {
  const dir = order === 'desc' ? -1 : 1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => {
    if (sort === 'name') {
      const c = collator.compare(a.name, b.name);
      return c * dir;
    }
    if (sort === 'birthtime') {
      const av = a.birthtimeMs ?? a.mtimeMs;
      const bv = b.birthtimeMs ?? b.mtimeMs;
      if (av !== bv) return av < bv ? -dir : dir;
    } else {
      if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs < b.mtimeMs ? -dir : dir;
    }
    return collator.compare(a.name, b.name) * dir;
  });
}

async function listShallow(absRoot) {
  const dir = await fsp.readdir(absRoot, { withFileTypes: true });
  const files = [];
  for (const ent of dir) {
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!allExts.has(ext)) continue;
    const full = path.join(absRoot, ent.name);
    const st = await fsp.stat(full);
    const kind = fileKindByName(ent.name);
    if (kind === 'other') continue;
    files.push({
      name: ent.name,
      rel: ent.name,
      size: st.size,
      mtimeMs: st.mtimeMs,
      birthtimeMs: st.birthtimeMs,
      kind
    });
  }
  return files;
}

async function searchTree(absRoot, pattern, count = { n: 0 }, truncated = { v: false }) {
  const out = [];
  async function walk(relBase) {
    const full = relBase ? path.join(absRoot, relBase) : absRoot;
    let entries;
    try {
      entries = await fsp.readdir(full, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      if (count.n >= MAX_SEARCH) {
        truncated.v = true;
        return;
      }
      const rel = relBase ? path.join(relBase, ent.name) : ent.name;
      const relPosix = rel.split(path.sep).join('/');
      if (ent.isDirectory()) {
        await walk(rel);
        if (count.n >= MAX_SEARCH) return;
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!allExts.has(ext)) continue;
      if (!matchesSearch(relPosix, pattern)) continue;
      const st = await fsp.stat(path.join(absRoot, rel));
      const kind = fileKindByName(ent.name);
      if (kind === 'other') continue;
      out.push({
        name: ent.name,
        rel: relPosix,
        size: st.size,
        mtimeMs: st.mtimeMs,
        birthtimeMs: st.birthtimeMs,
        kind,
        subpath: path.dirname(relPosix) === '.' ? '' : path.dirname(relPosix)
      });
      count.n++;
    }
  }
  await walk('');
  return { files: out, truncated: truncated.v };
}

function thumbKey(absPath, mtimeMs) {
  const h = crypto.createHash('sha256');
  h.update(absPath);
  h.update(String(mtimeMs));
  h.update(String(THUMB_SIZE));
  return h.digest('hex');
}

function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v' || ext === '.f4v') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.avi' || ext === '.divx') return 'video/x-msvideo';
  if (ext === '.wmv' || ext === '.asf') return 'video/x-ms-asf';
  if (ext === '.flv') return 'video/x-flv';
  if (ext === '.ts' || ext === '.mts' || ext === '.m2ts') return 'video/mp2t';
  if (ext === '.mpg' || ext === '.mpeg') return 'video/mpeg';
  if (ext === '.3gp' || ext === '.3g2') return 'video/3gpp';
  if (ext === '.ogv') return 'video/ogg';
  if (ext === '.vob') return 'video/mpeg';
  if (ext === '.rm' || ext === '.rmvb') return 'application/vnd.rn-realmedia';
  if (ext === '.mxf') return 'application/mxf';
  if (ext === '.nut') return 'video/x-nut';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.jfif' || ext === '.jif') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.heic' || ext === '.heif') return 'image/heic';
  if (ext === '.jxl') return 'image/jxl';
  if (ext === '.psd') return 'image/vnd.adobe.photoshop';
  if (ext === '.ppm') return 'image/x-portable-pixmap';
  if (ext === '.pgm') return 'image/x-portable-graymap';
  if (ext === '.pbm') return 'image/x-portable-bitmap';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg';
  if (ext === '.opus') return 'audio/opus';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.wma') return 'audio/x-ms-wma';
  if (ext === '.aiff' || ext === '.aif') return 'audio/aiff';
  if (ext === '.ape') return 'audio/x-ape';
  if (ext === '.mka') return 'audio/x-matroska';
  if (ext === '.dsf' || ext === '.dff') return 'audio/x-dsd';
  if (ext === '.txt' || ext === '.md' || ext === '.srt' || ext === '.vtt' || ext === '.log') {
    return 'text/plain; charset=utf-8';
  }
  if (ext === '.json') return 'application/json';
  if (ext === '.xml' || ext === '.svg' || ext === '.xsl' || ext === '.xslt' || ext === '.wsdl') {
    return 'application/xml';
  }
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'text/javascript; charset=utf-8';
  if (ext === '.tsx' || ext === '.cts') return 'text/plain; charset=utf-8';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.yaml' || ext === '.yml') return 'text/yaml; charset=utf-8';
  if (ext === '.graphql' || ext === '.gql') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

const FFMPEG_THUMB_TIMEOUT_MS = 90000;
const FFPROBE_DURATION_TIMEOUT_MS = 15000;

/** @returns {Promise<number|null>} duration in seconds, or null if unknown */
function probeDurationSeconds(inputPath) {
  return new Promise(resolve => {
    const p = spawn(getFfprobePath(), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath
    ]);
    let stdout = '';
    p.stdout.on('data', d => {
      stdout += d.toString();
    });
    const t = setTimeout(() => {
      p.kill('SIGKILL');
      resolve(null);
    }, FFPROBE_DURATION_TIMEOUT_MS);
    p.on('close', code => {
      clearTimeout(t);
      if (code !== 0) {
        resolve(null);
        return;
      }
      const v = parseFloat(String(stdout).trim());
      if (!Number.isFinite(v) || v <= 0) resolve(null);
      else resolve(v);
    });
    p.on('error', () => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

function runFfmpegThumbOnce(input, output, w, h, ssPos) {
  return new Promise((resolve, reject) => {
    const ff = spawn(getFfmpegPath(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-ss',
      ssPos,
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      '-f',
      'image2',
      output
    ]);
    let err = '';
    ff.stderr.on('data', d => {
      err += d.toString();
    });
    const t = setTimeout(() => {
      ff.kill('SIGKILL');
      reject(new Error('ffmpeg thumb timeout'));
    }, FFMPEG_THUMB_TIMEOUT_MS);
    ff.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ffmpeg thumb exit ${code}`));
    });
    ff.on('error', e => {
      clearTimeout(t);
      if (e && e.code === 'ENOENT') {
        reject(
          new Error(
            `ffmpeg not found (tried "${getFfmpegPath()}"). Install ffmpeg or set FFMPEG_PATH in .env.`
          )
        );
        return;
      }
      reject(e);
    });
  });
}

async function runFfmpegThumb(input, output, w, h) {
  const candidates = [];
  const dur = await probeDurationSeconds(input);
  if (dur != null && Number.isFinite(dur) && dur > 0) {
    candidates.push(String(dur / 2));
  }
  candidates.push('1', '0');
  const uniq = [];
  for (const c of candidates) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== c) uniq.push(c);
  }
  let lastErr;
  for (const ss of uniq) {
    try {
      await runFfmpegThumbOnce(input, output, w, h, ss);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

module.exports = () => {
  const router = express.Router();
  ensureThumbDir();

  const listSchema = z.object({
    folder: z.string(),
    sort: z.enum(['name', 'mtime', 'birthtime']).default('name'),
    order: z.enum(['asc', 'desc']).default('asc')
  });

  router.post('/list', express.json(), async (req, res) => {
    const parsed = listSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid body' });
    const { folder, sort, order } = parsed.data;
    try {
      const absRoot = path.resolve(folder);
      await fsp.access(absRoot);
      const stat = await fsp.stat(absRoot);
      if (!stat.isDirectory()) return res.status(400).json({ error: 'not a directory' });
      let files = await listShallow(absRoot);
      files = sortFiles(files, sort, order);
      res.json({ files });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'list failed' });
    }
  });

  router.post('/list-subfolders', express.json(), async (req, res) => {
    const schema = z.object({ folder: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid body' });
    try {
      const absRoot = path.resolve(parsed.data.folder);
      await fsp.access(absRoot);
      const stat = await fsp.stat(absRoot);
      if (!stat.isDirectory()) return res.status(400).json({ error: 'not a directory' });
      const entries = await fsp.readdir(absRoot, { withFileTypes: true });
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const dirs = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort((a, b) => collator.compare(a, b));
      res.json({ dirs });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'list failed' });
    }
  });

  router.post('/pick-folder', async (req, res) => {
    const chosen = pickNativeFolder();
    if (!chosen) {
      return res.json({ path: null });
    }
    const resolved = path.resolve(chosen.trim());
    try {
      await fsp.access(resolved);
      const st = await fsp.stat(resolved);
      if (!st.isDirectory()) return res.status(400).json({ error: 'not a directory' });
    } catch {
      return res.status(400).json({ error: 'path not accessible' });
    }
    res.json({ path: resolved });
  });

  const searchSchema = z.object({
    folder: z.string(),
    pattern: z.string().default(''),
    sort: z.enum(['name', 'mtime', 'birthtime']).default('name'),
    order: z.enum(['asc', 'desc']).default('asc')
  });

  router.post('/search', express.json(), async (req, res) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid body' });
    const { folder, pattern, sort, order } = parsed.data;
    try {
      const absRoot = path.resolve(folder);
      const { files, truncated } = await searchTree(absRoot, pattern);
      const sorted = sortFiles(
        files.map(f => ({
          name: f.name,
          rel: f.rel,
          size: f.size,
          mtimeMs: f.mtimeMs,
          birthtimeMs: f.birthtimeMs,
          kind: f.kind,
          subpath: f.subpath
        })),
        sort,
        order
      );
      res.json({ files: sorted, truncated });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'search failed' });
    }
  });

  const clearThumbsSchema = z.object({
    folder: z.string(),
    recursive: z.boolean().optional().default(false)
  });

  /** Delete cached JPEG thumbs for files in folder (shallow or full tree). Red error tiles stay until cleared. */
  router.post('/clear-thumbnails', express.json(), async (req, res) => {
    const parsed = clearThumbsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid body' });
    const { folder, recursive } = parsed.data;
    try {
      const absRoot = path.resolve(folder);
      await fsp.access(absRoot);
      const stRoot = await fsp.stat(absRoot);
      if (!stRoot.isDirectory()) return res.status(400).json({ error: 'not a directory' });

      let targets;
      if (recursive) {
        const { files } = await searchTree(absRoot, '');
        targets = files.map(f => ({
          absPath: path.join(absRoot, f.rel.split('/').join(path.sep)),
          mtimeMs: f.mtimeMs
        }));
      } else {
        const shallow = await listShallow(absRoot);
        targets = shallow.map(f => ({
          absPath: path.join(absRoot, f.rel),
          mtimeMs: f.mtimeMs
        }));
      }

      let removed = 0;
      for (const { absPath, mtimeMs } of targets) {
        const key = thumbKey(absPath, mtimeMs);
        const cachePath = path.join(THUMB_DIR, `${key}.jpg`);
        try {
          await fsp.unlink(cachePath);
          removed++;
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }

      res.json({ removed, cacheDir: THUMB_DIR, recursive });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'clear-thumbnails failed' });
    }
  });

  router.get('/thumbnail', async (req, res) => {
    const folder = req.query.folder;
    const rel = req.query.rel || req.query.file;
    const mtimeQ = req.query.mtime;
    if (!folder || !rel) return res.status(400).end();
    const absPath = resolveUnderRoot(folder, rel);
    if (!absPath || !fs.existsSync(absPath)) return res.status(404).end();

    try {
      const st = await fsp.stat(absPath);
      const mtimeMs = mtimeQ ? Number(mtimeQ) : st.mtimeMs;
      const key = thumbKey(absPath, mtimeMs);
      const cachePath = path.join(THUMB_DIR, `${key}.jpg`);

      const kind = fileKindByName(path.basename(absPath));

      try {
        if (fs.existsSync(cachePath)) {
          const cst = await fsp.stat(cachePath);
          if (cst.mtimeMs >= st.mtimeMs) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(cachePath, SEND_DOTFILES_ALLOW);
          }
        }
      } catch (e) {
        /* regenerate */
      }

      await thumbQueue(async () => {
        try {
          if (fs.existsSync(cachePath)) {
            const cst = await fsp.stat(cachePath);
            if (cst.mtimeMs >= st.mtimeMs) return;
          }
          if (kind === 'image') {
            const buf = await sharp(absPath, { failOn: 'none' })
              .rotate()
              .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', withoutEnlargement: true })
              .jpeg({ quality: 78 })
              .toBuffer();
            await fsp.writeFile(cachePath, buf);
          } else if (kind === 'video') {
            const tmpOut = path.join(os.tmpdir(), `mu-thumb-${key}-${randomUUID()}.jpg`);
            try {
              await runFfmpegThumb(absPath, tmpOut, THUMB_SIZE, THUMB_SIZE);
              await fsp.copyFile(tmpOut, cachePath);
            } finally {
              await fsp.unlink(tmpOut).catch(() => {});
            }
          } else if (kind === 'pdf') {
            try {
              const buf = await sharp(absPath, { failOn: 'none', density: 72 })
                .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
                .jpeg({ quality: 78 })
                .toBuffer();
              await fsp.writeFile(cachePath, buf);
            } catch (e) {
              const placeholder = await sharp({
                create: { width: THUMB_SIZE, height: THUMB_SIZE, channels: 3, background: { r: 40, g: 44, b: 52 } }
              })
                .jpeg()
                .toBuffer();
              await fsp.writeFile(cachePath, placeholder);
            }
          } else if (kind === 'audio') {
            const placeholder = await sharp({
              create: { width: THUMB_SIZE, height: THUMB_SIZE, channels: 3, background: { r: 72, g: 68, b: 58 } }
            })
              .jpeg()
              .toBuffer();
            await fsp.writeFile(cachePath, placeholder);
          } else {
            const placeholder = await sharp({
              create: { width: THUMB_SIZE, height: THUMB_SIZE, channels: 3, background: { r: 55, g: 60, b: 70 } }
            })
              .jpeg()
              .toBuffer();
            await fsp.writeFile(cachePath, placeholder);
          }
        } catch (e) {
          console.error(
            '[thumbnail] generation failed (dark red tile = this error was cached for)',
            absPath,
            e && e.message ? e.message : e
          );
          try {
            const placeholder = await sharp({
              create: { width: THUMB_SIZE, height: THUMB_SIZE, channels: 3, background: { r: 60, g: 30, b: 30 } }
            })
              .jpeg()
              .toBuffer();
            await fsp.writeFile(cachePath, placeholder);
          } catch (e2) {
            console.error('thumb placeholder', e2);
            throw e;
          }
        }
      });

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(cachePath, SEND_DOTFILES_ALLOW);
    } catch (e) {
      console.error('thumbnail', e);
      if (!res.headersSent) res.status(500).end();
    }
  });

  router.get('/file', (req, res) => {
    const folder = req.query.folder;
    const rel = req.query.rel || req.query.path;
    if (!folder || !rel) return res.status(400).end();
    const absRoot = path.resolve(folder);
    const absPath = path.resolve(absRoot, rel);
    if (!absPath.startsWith(absRoot + path.sep) && absPath !== absRoot) return res.status(403).end();
    if (!fs.existsSync(absPath)) return res.status(404).end();

    const kind = fileKindByName(path.basename(absPath));
    const stat = fs.statSync(absPath);

    if (kind === 'video' || kind === 'audio') {
      const range = req.headers.range;
      const contentType = mimeFor(absPath);
      if (!range) {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size);
        return fs.createReadStream(absPath).pipe(res);
      }
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      if (isNaN(start) || isNaN(end) || start > end) return res.status(416).end();
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', (end - start) + 1);
      res.setHeader('Content-Type', contentType);
      return fs.createReadStream(absPath, { start, end }).pipe(res);
    }

    res.setHeader('Content-Type', mimeFor(absPath));
    return res.sendFile(absPath, SEND_DOTFILES_ALLOW);
  });

  router.get('/text-preview', async (req, res) => {
    const folder = req.query.folder;
    const rel = req.query.rel;
    if (!folder || !rel) return res.status(400).json({ error: 'missing' });
    const absPath = resolveUnderRoot(folder, rel);
    if (!absPath) return res.status(403).json({ error: 'forbidden' });
    try {
      const fh = await fsp.open(absPath, 'r');
      const buf = Buffer.alloc(Math.min(TEXT_PREVIEW_BYTES, (await fh.stat()).size));
      await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      const text = buf.toString('utf8');
      res.json({ text, truncated: (await fsp.stat(absPath)).size > TEXT_PREVIEW_BYTES });
    } catch (e) {
      res.status(500).json({ error: 'read failed' });
    }
  });

  const deleteSchema = z.object({
    items: z.array(z.object({ root: z.string(), rel: z.string() }))
  });

  router.post('/delete', express.json(), async (req, res) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const { items } = parsed.data;
    const absPaths = [];
    for (const it of items) {
      const a = resolveUnderRoot(it.root, it.rel);
      if (a) absPaths.push(a);
    }
    const { ok, errors } = await trashPaths(absPaths);
    res.json({ deleted: ok.length, errors });
  });

  const renameSchema = z.object({
    root: z.string(),
    rel: z.string(),
    newName: z.string()
  });

  router.post('/rename', express.json(), async (req, res) => {
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const { root, rel, newName } = parsed.data;
    const absFrom = resolveUnderRoot(root, rel);
    if (!absFrom) return res.status(403).json({ error: 'forbidden' });
    const dir = path.dirname(absFrom);
    const safeName = path.basename(newName);
    if (safeName !== newName || safeName.includes('..') || safeName.includes('/') || safeName.includes('\\')) {
      return res.status(400).json({ error: 'bad name' });
    }
    const absTo = path.join(dir, safeName);
    if (!absTo.startsWith(path.resolve(root) + path.sep) && absTo !== path.resolve(root)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      await fsp.rename(absFrom, absTo);
      res.json({ ok: true, rel: path.relative(path.resolve(root), absTo).split(path.sep).join('/') });
    } catch (e) {
      res.status(500).json({ error: e.message || 'rename failed' });
    }
  });

  function safeRelSegments(relDir) {
    const t = String(relDir || '').trim().replace(/\\/g, '/');
    if (!t) return '';
    const parts = t.split('/').filter(Boolean);
    for (const p of parts) {
      if (p === '.' || p === '..') return null;
    }
    return parts.join('/');
  }

  router.post('/mkdir', express.json(), async (req, res) => {
    const schema = z.object({ root: z.string(), name: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const rawName = parsed.data.name.trim();
    const name = path.basename(rawName);
    if (!name || name !== rawName.replace(/[/\\]/g, '') || name === '.' || name === '..') {
      return res.status(400).json({ error: 'bad name' });
    }
    const absRoot = path.resolve(parsed.data.root);
    const absNew = path.join(absRoot, name);
    if (!absNew.startsWith(absRoot + path.sep) && absNew !== absRoot) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      await fsp.mkdir(absNew);
      res.json({ ok: true, name });
    } catch (e) {
      if (e.code === 'EEXIST') return res.status(409).json({ error: 'exists' });
      console.error(e);
      res.status(500).json({ error: e.message || 'mkdir failed' });
    }
  });

  const pasteSchema = z.object({
    destRoot: z.string(),
    mode: z.enum(['copy', 'cut']),
    items: z.array(z.object({ root: z.string(), rel: z.string() }))
  });

  function uniqueDest(absDestDir, baseName) {
    let dest = path.join(absDestDir, baseName);
    if (!fs.existsSync(dest)) return dest;
    const ext = path.extname(baseName);
    const stem = ext ? baseName.slice(0, -ext.length) : baseName;
    let n = 1;
    while (fs.existsSync(dest)) {
      dest = path.join(absDestDir, `${stem} (${n})${ext}`);
      n++;
    }
    return dest;
  }

  router.post('/move', express.json(), async (req, res) => {
    const schema = z.object({
      root: z.string(),
      destRelDir: z.string().min(1),
      items: z.array(z.object({ rel: z.string() })).min(1)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const { root, destRelDir, items } = parsed.data;
    const destSafe = safeRelSegments(destRelDir);
    if (destSafe == null) return res.status(400).json({ error: 'bad destination' });
    const absRoot = path.resolve(root);
    const absDestDir = path.join(absRoot, destSafe);
    if (!absDestDir.startsWith(absRoot + path.sep) && absDestDir !== absRoot) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const st = await fsp.stat(absDestDir);
      if (!st.isDirectory()) return res.status(400).json({ error: 'not a directory' });
    } catch {
      return res.status(400).json({ error: 'destination missing' });
    }

    const results = [];
    const errors = [];
    for (const it of items) {
      const absFrom = resolveUnderRoot(root, it.rel);
      if (!absFrom || !fs.existsSync(absFrom)) {
        errors.push({ rel: it.rel, error: 'missing' });
        continue;
      }
      let srcStat;
      try {
        srcStat = await fsp.stat(absFrom);
      } catch (e) {
        errors.push({ rel: it.rel, error: e.message || 'stat' });
        continue;
      }
      if (!srcStat.isFile()) {
        errors.push({ rel: it.rel, error: 'not a file' });
        continue;
      }
      const fromDir = path.dirname(absFrom);
      if (path.resolve(fromDir) === path.resolve(absDestDir)) {
        errors.push({ rel: it.rel, error: 'already there' });
        continue;
      }
      const base = path.basename(absFrom);
      const absTo = uniqueDest(absDestDir, base);
      try {
        await fsp.rename(absFrom, absTo);
        results.push({
          rel: it.rel,
          toRel: path.relative(absRoot, absTo).split(path.sep).join('/')
        });
      } catch (e) {
        errors.push({ rel: it.rel, error: e.message || String(e) });
      }
    }
    res.json({ ok: results, errors });
  });

  router.post('/paste', express.json(), async (req, res) => {
    const parsed = pasteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const { destRoot, mode, items } = parsed.data;
    const absDestRoot = path.resolve(destRoot);
    const results = [];
    const errors = [];
    for (const it of items) {
      const absSrc = resolveUnderRoot(it.root, it.rel);
      if (!absSrc || !fs.existsSync(absSrc)) {
        errors.push({ rel: it.rel, error: 'missing source' });
        continue;
      }
      const base = path.basename(absSrc);
      const destPath = uniqueDest(absDestRoot, base);
      try {
        if (mode === 'copy') {
          await fsp.copyFile(absSrc, destPath);
        } else {
          await fsp.rename(absSrc, destPath);
        }
        results.push({
          from: it,
          toRel: path.relative(absDestRoot, destPath).split(path.sep).join('/')
        });
      } catch (e) {
        errors.push({ rel: it.rel, error: e.message || String(e) });
      }
    }
    res.json({ ok: results, errors });
  });

  router.post(
    '/save-download-png',
    uploadPngToDownloads.single('image'),
    async (req, res) => {
      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'no image' });
      const dir = getDownloadsDir();
      try {
        await fsp.mkdir(dir, { recursive: true });
      } catch (e) {
        return res.status(500).json({ error: 'downloads folder' });
      }
      let base =
        (req.body?.basename && String(req.body.basename).trim()) || `video_frame_${Date.now()}`;
      base = path.basename(base).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!base.toLowerCase().endsWith('.png')) base += '.png';
      let absOut = path.join(dir, base);
      let n = 1;
      while (fs.existsSync(absOut)) {
        const stem = base.replace(/\.png$/i, '');
        absOut = path.join(dir, `${stem}_${n}.png`);
        n++;
      }
      try {
        await fsp.writeFile(absOut, req.file.buffer);
        res.json({ ok: true, filename: path.basename(absOut), path: absOut });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message || 'write failed' });
      }
    }
  );

  router.post('/crop', express.json(), async (req, res) => {
    const schema = z.object({
      folder: z.string(),
      file: z.string(),
      cropArea: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number()
      }),
      rotation: z.number().optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const { folder, file, cropArea, rotation } = parsed.data;
    const absFolder = path.resolve(folder);
    const absInput = resolveUnderRoot(folder, file);
    if (!absInput) return res.status(403).json({ error: 'forbidden' });

    const base = path.basename(file, path.extname(file));
    const ext = path.extname(file);
    let newName = `${base}_cropped${ext}`;
    let absOutput = path.join(path.dirname(absInput), newName);
    let n = 1;
    while (fs.existsSync(absOutput)) {
      newName = `${base}_cropped_${n}${ext}`;
      absOutput = path.join(path.dirname(absInput), newName);
      n++;
    }

    try {
      const rot = typeof rotation === 'number' ? rotation : 0;
      const baseSharp = sharp(absInput, { failOn: 'none' }).rotate(rot);
      const metadata = await baseSharp.metadata();
      if (!metadata.width || !metadata.height) throw new Error('dimensions');
      const left = Math.max(0, Math.floor(cropArea.x || 0));
      const top = Math.max(0, Math.floor(cropArea.y || 0));
      const width = Math.min(Math.round(cropArea.width), metadata.width - left);
      const height = Math.min(Math.round(cropArea.height), metadata.height - top);
      if (width <= 0 || height <= 0) return res.status(400).json({ error: 'bad crop' });
      await baseSharp.extract({ left, top, width, height }).toFile(absOutput);
      if (!absOutput.startsWith(absFolder + path.sep)) return res.status(400).json({ error: 'outside folder' });
      res.json({ success: true, output: path.basename(absOutput) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || 'crop failed' });
    }
  });

  const combineSchema = z.object({
    folder: z.string(),
    paths: z.array(z.string()),
    outputName: z.string()
  });

  router.post('/combine', express.json(), async (req, res) => {
    const parsed = combineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const { folder, paths, outputName } = parsed.data;
    const absRoot = path.resolve(folder);
    const jobId = jobCreate();
    res.status(202).json({ jobId });

    setImmediate(async () => {
      jobUpdate(jobId, { status: 'running', message: 'ffmpeg' });
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expl-combine-'));
      try {
        const partPaths = [];
        for (let i = 0; i < paths.length; i++) {
          const rel = paths[i];
          const abs = resolveUnderRoot(folder, rel);
          if (!abs || !fs.existsSync(abs)) throw new Error('missing ' + rel);
          const dest = path.join(tmpDir, `part_${i}${path.extname(abs) || '.mp4'}`);
          await fsp.copyFile(abs, dest);
          partPaths.push(dest);
        }
        const listPath = path.join(tmpDir, 'list.txt');
        const listContent = partPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        await fsp.writeFile(listPath, listContent);
        const outTmp = path.join(tmpDir, 'out.mp4');
        await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outTmp]);
        const safeOut = path.basename(outputName) || 'combined.mp4';
        const finalPath = uniqueDest(absRoot, safeOut.endsWith('.mp4') ? safeOut : `${safeOut}.mp4`);
        await fsp.copyFile(outTmp, finalPath);
        jobUpdate(jobId, {
          status: 'done',
          progress: 100,
          result: { path: path.relative(absRoot, finalPath).split(path.sep).join('/') }
        });
      } catch (e) {
        jobUpdate(jobId, { status: 'error', error: e.message || String(e) });
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  router.post('/remux-video', express.json(), async (req, res) => {
    const schema = z.object({ folder: z.string(), rel: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const { folder, rel } = parsed.data;
    const abs = resolveUnderRoot(folder, rel);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'not found' });
    const jobId = jobCreate();
    res.status(202).json({ jobId });
    setImmediate(async () => {
      jobUpdate(jobId, { status: 'running', message: 'remux' });
      const tmp = path.join(os.tmpdir(), `rmx-${randomUUID()}.mp4`);
      try {
        await runFFmpeg(['-y', '-i', abs, '-c', 'copy', '-movflags', '+faststart', tmp]);
        const stem = abs.slice(0, -path.extname(abs).length);
        const outAbs = stem + '.mp4';
        await fsp.rename(tmp, outAbs);
        if (outAbs !== abs) await fsp.unlink(abs).catch(() => {});
        const relOut = path.relative(path.resolve(folder), outAbs).split(path.sep).join('/');
        jobUpdate(jobId, { status: 'done', result: { rel: relOut } });
      } catch (e) {
        await fsp.unlink(tmp).catch(() => {});
        jobUpdate(jobId, { status: 'error', error: e.message || String(e) });
      }
    });
  });

  router.get('/jobs/:id', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: 'unknown job' });
    res.json(j);
  });

  const convertVideosSchema = z.object({
    items: z.array(z.object({ root: z.string(), rel: z.string() })),
    mode: z.enum(['missing_target', 'all']).default('missing_target')
  });

  router.post('/convert-videos', express.json(), async (req, res) => {
    const parsed = convertVideosSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const jobId = jobCreate();
    res.status(202).json({ jobId });
    const { items, mode } = parsed.data;

    setImmediate(async () => {
      jobUpdate(jobId, { status: 'running' });
      const errors = [];
      let done = 0;
      for (const it of items) {
        const abs = resolveUnderRoot(it.root, it.rel);
        if (!abs || !fs.existsSync(abs)) {
          errors.push({ rel: it.rel, error: 'missing' });
          jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
          continue;
        }
        try {
          const ext = path.extname(abs).toLowerCase();
          const stem = abs.slice(0, -ext.length);
          const outPath = `${stem}.mp4`;
          if (mode === 'missing_target' && ext === '.mp4') {
            done++;
            jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
            continue;
          }
          const tmp = path.join(os.tmpdir(), `cv-${randomUUID()}.mp4`);
          const baseArgs = [
            '-y',
            '-i',
            abs,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart'
          ];
          try {
            await runFFmpeg([...baseArgs, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', tmp]);
          } catch (e1) {
            try {
              await runFFmpeg([...baseArgs, tmp]);
            } catch (e2) {
              await runFFmpeg(['-y', '-i', abs, '-c', 'copy', '-movflags', '+faststart', tmp]);
            }
          }
          await fsp.rename(tmp, outPath);
          done++;
        } catch (e) {
          errors.push({ rel: it.rel, error: e.message || String(e) });
        }
        jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
      }
      jobUpdate(jobId, { status: 'done', result: { converted: done, errors } });
    });
  });

  const convertImagesSchema = z.object({
    items: z.array(z.object({ root: z.string(), rel: z.string() })),
    format: z.enum(['png', 'webp']),
    mode: z.enum(['missing_target', 'all']).default('missing_target')
  });

  router.post('/convert-images', express.json(), async (req, res) => {
    const parsed = convertImagesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const jobId = jobCreate();
    res.status(202).json({ jobId });
    const { items, format, mode } = parsed.data;

    setImmediate(async () => {
      jobUpdate(jobId, { status: 'running' });
      const errors = [];
      let done = 0;
      for (const it of items) {
        const abs = resolveUnderRoot(it.root, it.rel);
        if (!abs || !fs.existsSync(abs)) {
          errors.push({ rel: it.rel, error: 'missing' });
          jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
          continue;
        }
        try {
          const ext = path.extname(abs).toLowerCase();
          const targetExt = `.${format}`;
          const outPath = abs.replace(/\.[^.]+$/, '') + targetExt;
          if (mode === 'missing_target' && ext === targetExt) {
            done++;
            jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
            continue;
          }
          const tmp = path.join(os.tmpdir(), `ci-${randomUUID()}${targetExt}`);
          const img = sharp(abs, { failOn: 'none' }).rotate();
          if (format === 'png') await img.png().toFile(tmp);
          else await img.webp({ quality: 85 }).toFile(tmp);
          await fsp.rename(tmp, outPath);
          done++;
        } catch (e) {
          errors.push({ rel: it.rel, error: e.message || String(e) });
        }
        jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
      }
      jobUpdate(jobId, { status: 'done', result: { converted: done, errors } });
    });
  });

  const convertAudioSchema = z.object({
    items: z.array(z.object({ root: z.string(), rel: z.string() })),
    mode: z.enum(['missing_target', 'all']).default('missing_target')
  });

  router.post('/convert-audio', express.json(), async (req, res) => {
    const parsed = convertAudioSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid' });
    const jobId = jobCreate();
    res.status(202).json({ jobId });
    const { items, mode } = parsed.data;

    setImmediate(async () => {
      jobUpdate(jobId, { status: 'running' });
      const errors = [];
      let done = 0;
      for (const it of items) {
        const abs = resolveUnderRoot(it.root, it.rel);
        if (!abs || !fs.existsSync(abs)) {
          errors.push({ rel: it.rel, error: 'missing' });
          jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
          continue;
        }
        try {
          const ext = path.extname(abs).toLowerCase();
          const stem = abs.slice(0, -ext.length);
          const outPath = `${stem}.mp3`;
          if (mode === 'missing_target' && ext === '.mp3') {
            done++;
            jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
            continue;
          }
          const tmp = path.join(os.tmpdir(), `ca-${randomUUID()}.mp3`);
          await runFFmpeg(['-y', '-i', abs, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', tmp]);
          await fsp.rename(tmp, outPath);
          done++;
        } catch (e) {
          errors.push({ rel: it.rel, error: e.message || String(e) });
        }
        jobUpdate(jobId, { progress: Math.round((100 * (done + errors.length)) / items.length) });
      }
      jobUpdate(jobId, { status: 'done', result: { converted: done, errors } });
    });
  });

  return router;
};
