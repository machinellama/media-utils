// routes/watch.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { rm } = fs.promises;

const VIDEO_EXTS = ['.mp4','.m4v','.mov','.mkv','.webm','.avi','.ts','.mts','.m2ts'];

module.exports = () => {
  const router = express.Router();

  router.post('/list', express.json(), async (req, res) => {
    const folder = req.body && req.body.folder;
    if (!folder) return res.status(400).json({ error: 'no folder' });
    try {
      const abs = path.resolve(folder);
      const all = [];
      function walk(dir){
        const items = fs.readdirSync(dir, { withFileTypes:true });
        const files = [];
        const folders = [];
        for (const it of items){
          const full = path.join(dir, it.name);
          if (it.isDirectory()){
            folders.push(walk(full));
          } else if (it.isFile()){
            const ext = path.extname(it.name).toLowerCase();
            if (VIDEO_EXTS.includes(ext)){
              const rel = path.relative(abs, full);
              const stat = fs.statSync(full);
              files.push({ name: it.name, path: rel.replace(/\\/g,'/'), size: stat.size });
              all.push({ name: it.name, path: rel.replace(/\\/g,'/'), size: stat.size, full });
            }
          }
        }
        return { name: path.basename(dir), files, folders };
      }
      const tree = walk(abs);
      const flat = all.map(a=>({ name:a.name, path:a.path, size:a.size }));
      res.json({ tree: [tree], flat });
    } catch (e){
      res.status(500).json({ error: 'scan failed' });
    }
  });

  router.get('/file', (req, res) => {
    const folder = req.query.folder;
    const rel = req.query.path;
    if (!folder || !rel) return res.status(400).end();
    const absRoot = path.resolve(folder);
    const absPath = path.resolve(absRoot, rel);
    if (!absPath.startsWith(absRoot)) return res.status(403).end();
    if (!fs.existsSync(absPath)) return res.status(404).end();
    const stat = fs.statSync(absPath);
    const range = req.headers.range;
    const contentType = mimeTypeFor(absPath);
    if (!range){
      res.setHeader('Accept-Ranges','bytes');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);
      const stream = fs.createReadStream(absPath);
      stream.pipe(res);
      return;
    }
    const parts = range.replace(/bytes=/,'').split('-');
    const start = parseInt(parts[0],10);
    const end = parts[1] ? parseInt(parts[1],10) : stat.size - 1;
    if (isNaN(start) || isNaN(end) || start > end) return res.status(416).end();
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Accept-Ranges','bytes');
    res.setHeader('Content-Length', (end-start)+1);
    res.setHeader('Content-Type', contentType);
    const stream = fs.createReadStream(absPath, { start, end });
    stream.pipe(res);
  });

  router.post('/stream-info', express.json(), (req, res) => {
    const { folder, path: rel } = req.body || {};
    if (!folder || !rel) return res.status(400).json({ error: 'missing' });
    const absRoot = path.resolve(folder);
    const absPath = path.resolve(absRoot, rel);
    if (!absPath.startsWith(absRoot)) return res.status(403).json({ error: 'forbidden' });
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'not found' });
    const ext = path.extname(absPath).toLowerCase();
    const playable = playableInBrowser(ext);
    res.json({ remuxNeeded: !playable });
  });

  router.post('/remux', express.json(), async (req, res) => {
    const { folder, path: rel } = req.body || {};
    if (!folder || !rel) return res.status(400).json({ error: 'missing' });
    const absRoot = path.resolve(folder);
    const absPath = path.resolve(absRoot, rel);
    if (!absPath.startsWith(absRoot)) return res.status(403).json({ error: 'forbidden' });
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'not found' });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
    const outPath = path.join(tmpDir, 'remuxed.mp4');

    try {
      await runFFmpeg(['-y','-i',absPath,'-c','copy','-movflags','+faststart',outPath]);
      res.setHeader('Content-Type','video/mp4');
      const stream = fs.createReadStream(outPath);
      stream.pipe(res);
      stream.on('close', async ()=>{ try{ await rm(tmpDir, { recursive:true, force:true }); }catch(e){} });
      stream.on('error', async ()=>{ try{ await rm(tmpDir, { recursive:true, force:true }); }catch(e){} });
    } catch (e){
      try{ await rm(tmpDir, { recursive:true, force:true }); }catch(err){}
      res.status(500).json({ error: 'remux failed' });
    }
  });

  return router;
};

function playableInBrowser(ext){
  const play = ['.mp4','.m4v','.webm','.ogg'];
  return play.includes(ext);
}

function mimeTypeFor(p){
  const ext = path.extname(p).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.ogg' || ext === '.ogv') return 'video/ogg';
  return 'application/octet-stream';
}

function runFFmpeg(args){
  return new Promise((resolve,reject)=>{
    const ff = spawn('ffmpeg', args);
    let stderr = '';
    ff.stderr.on('data', d => stderr += d.toString());
    ff.on('close', code => { if (code===0) resolve(); else reject(new Error('ffmpeg failed: '+code+'\n'+stderr)); });
  });
}
