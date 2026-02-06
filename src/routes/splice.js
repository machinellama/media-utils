// routes/splice.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { rm } = fs.promises;
const { spawn } = require('child_process');

module.exports = (upload) => {
  const router = express.Router();

  async function runCmd(cmd, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args);
      let stderr = '';
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', code => {
        if (code === 0) resolve({ code, stderr });
        else reject(new Error(`${cmd} ${args.join(' ')} failed: ${code}\n${stderr}`));
      });
    });
  }

  async function needsRemuxToMp4(inputPath) {
    try {
      const ext = path.extname(inputPath || '').toLowerCase();
      if (ext === '.wmv' || ext === '.ts' || ext === '.m2ts') return true;
      const out = await new Promise((resolve, reject) => {
        const p = spawn('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=format_name',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          inputPath
        ]);
        let stdout = '';
        let stderr = '';
        p.stdout.on('data', d => stdout += d.toString());
        p.stderr.on('data', d => stderr += d.toString());
        p.on('close', code => {
          if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
          else reject(new Error('ffprobe failed: ' + stderr));
        });
      });
      const fmt = (out.stdout || '').trim();
      if (!fmt) return true;
      const names = fmt.split(',').map(s => s.trim().toLowerCase());
      const ok = names.some(n => n.includes('mp4') || n.includes('mov') || n.includes('isom') || n.includes('iso'));
      return !ok;
    } catch (err) {
      console.warn('[splice] ffprobe error, will remux: ', err.message || err);
      return true;
    }
  }

  async function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', args);
      let stderr = '';
      ff.stderr.on('data', d => stderr += d.toString());
      ff.on('close', code => {
        if (code === 0) resolve({ stderr });
        else reject(new Error('ffmpeg failed: ' + code + '\n' + stderr));
      });
    });
  }

  router.post('/', upload.single('file'), async (req, res) => {
    console.info('[splice] POST start', {
      file: req.file && req.file.originalname,
      hasRangesField: typeof req.body.ranges !== 'undefined',
      rangesRaw: req.body.ranges,
      remuxOnlyQuery: req.query.remuxOnly,
      remuxOnlyField: req.body.remuxOnly
    });

    if (!req.file) return res.status(400).json({ error: 'no file' });

    const isRemuxOnly = !!(req.query.remuxOnly || req.body.remuxOnly);

    let ranges = null;
    if (!isRemuxOnly) {
      if (!req.body.ranges) return res.status(400).json({ error: 'no ranges' });
      try {
        ranges = JSON.parse(req.body.ranges);
        if (!Array.isArray(ranges) || ranges.length === 0) throw new Error();
      } catch (e) {
        return res.status(400).json({ error: 'invalid ranges' });
      }
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splice-'));
    const uploadedPath = path.join(tmpDir, 'input' + path.extname(req.file.originalname || '.mp4'));
    try {
      fs.renameSync(req.file.path, uploadedPath);
    } catch (e) {
      console.error('[splice] failed to move uploaded file', e);
      try { await rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
      return res.status(500).json({ error: 'failed to store upload', detail: e.message });
    }

    let workInput = uploadedPath;
    let remuxedPath = null;

    try {
      const doRemux = await needsRemuxToMp4(uploadedPath);
      if (doRemux) {
        remuxedPath = path.join(tmpDir, 'input_remuxed.mp4');
        const ext = path.extname(uploadedPath).toLowerCase();
        const args = [
          '-y',
          '-fflags', '+genpts',
          '-i', uploadedPath
        ];
        if (ext === '.wmv') {
          args.push(
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            remuxedPath
          );
        } else if (ext === '.ts' || ext === '.m2ts') {
          args.push(
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            '-movflags', '+faststart',
            remuxedPath
          );
        } else {
          args.push(
            '-c', 'copy',
            '-movflags', '+faststart',
            remuxedPath
          );
        }
        await runFFmpeg(args);
        console.info('[splice] remuxed/converted uploaded file to mp4:', remuxedPath);
        workInput = remuxedPath;
      } else {
        console.info('[splice] uploaded file is mp4-like, no remux needed');
      }

      if (isRemuxOnly) {
        const returnPath = workInput;
        if (!fs.existsSync(returnPath)) throw new Error('remux output missing');
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(req.file.originalname || 'video')}.mp4"`);
        const stream = fs.createReadStream(returnPath);
        stream.pipe(res);
        stream.on('end', async () => {
          try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup failed', e); }
        });
        stream.on('error', async (err) => {
          console.error('[splice] stream error', err);
          try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup failed', e); }
        });
        return;
      }

      const segNames = [];
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const segName = path.join(tmpDir, `seg_${i}.mp4`);
        await runFFmpeg([
          '-y',
          '-ss', String(r.start),
          '-to', String(r.end),
          '-i', workInput,
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
      stream.on('error', async (err) => {
        console.error('[splice] stream error', err);
        try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { console.error('cleanup failed', e); }
      });
    } catch (err) {
      console.error('[splice] processing error', err && err.message ? err.message : err);
      try { await rm(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      res.status(500).json({ error: 'processing failed', detail: err && err.message ? err.message : String(err) });
    }
  });

  return router;
};
