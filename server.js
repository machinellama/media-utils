// server.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const app = express();
const upload = multer({ dest: os.tmpdir() });
const { rm } = fs.promises;

app.post('/splice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  if (!req.body.ranges) return res.status(400).json({ error: 'no ranges' });

  let ranges;
  try {
    ranges = JSON.parse(req.body.ranges);
    if (!Array.isArray(ranges) || ranges.length === 0) throw new Error();
  } catch (e) {
    return res.status(400).json({ error: 'invalid ranges' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splice-'));
  const uploadedPath = path.join(tmpDir, 'input' + path.extname(req.file.originalname || '.mp4'));
  fs.renameSync(req.file.path, uploadedPath);

  try {
    const segNames = [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const segName = path.join(tmpDir, `seg_${i}.mp4`);
      await runFFmpeg([
        '-y',
        '-ss', String(r.start),
        '-to', String(r.end),
        '-i', uploadedPath,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        segName,
      ]);
      segNames.push(segName);
    }

    const listPath = path.join(tmpDir, 'list.txt');
    const listContent = segNames.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    const outPath = path.join(tmpDir, 'output_spliced.mp4');
    await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(req.file.originalname || 'video')}_spliced.mp4"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', async () => {
      try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup failed', e); }
    });
    stream.on('error', async () => {
      try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup failed', e); }
    });
  } catch (err) {
    console.error(err);
    try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    res.status(500).json({ error: 'processing failed' });
  }
});

app.post('/combine', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'no files' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'combine-'));

  try {
    // move uploaded parts into tmpDir with predictable names
    const partPaths = [];
    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i];
      const dest = path.join(tmpDir, `part_${i}${path.extname(f.originalname) || '.mp4'}`);
      fs.renameSync(f.path, dest);
      partPaths.push(dest);
    }

    // If client supplied 'order' as JSON of names, try to respect it
    let orderedPaths = partPaths;
    if (req.body.order) {
      try {
        const orderNames = JSON.parse(req.body.order);
        if (Array.isArray(orderNames) && orderNames.length) {
          const map = {};
          partPaths.forEach(p => map[path.basename(p).replace(/^part_\d+_/, '')] = p);
          const resolved = [];
          for (const name of orderNames) {
            const key = name;
            if (map[key]) resolved.push(map[key]);
          }
          if (resolved.length === orderNames.length) orderedPaths = resolved;
        }
      } catch (e){ /* ignore and use upload order */ }
    }

    // Create concat list file with safe paths
    const listPath = path.join(tmpDir, 'list.txt');
    const listContent = orderedPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    const outPath = path.join(tmpDir, 'output_combined.mp4');
    // use concat demuxer
    await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="combined.mp4"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', async () => {
      try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup failed', e); }
    });
    stream.on('error', async () => {
      try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup failed', e); }
    });
  } catch (err) {
    console.error(err);
    try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    res.status(500).json({ error: 'processing failed' });
  }
});

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    let stderr = '';
    ff.stderr.on('data', d => stderr += d.toString());
    ff.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg failed: ' + code + '\n' + stderr));
    });
  });
}

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Server listening on ${port}`));
