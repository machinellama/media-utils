// routes/splice.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { rm } = fs.promises;
const { spawn } = require('child_process');

module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.single('file'), async (req, res) => {
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

  return router;
};

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
