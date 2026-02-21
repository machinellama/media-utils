// routes/splice.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { rm } = fs.promises;
const { needsRemuxToMp4, runFFmpeg, evenDimensionFilterExpression, probeVideoDimensions } = require('./util');

module.exports = (upload) => {
  const router = express.Router();

  router.post('/', upload.single('file'), async (req, res) => {
    console.info('[splice] POST start', {
      file: req.file && req.file.originalname,
      hasRangesField: typeof req.body.ranges !== 'undefined',
      rangesRaw: req.body.ranges,
      remuxOnlyQuery: req.query.remuxOnly,
      remuxOnlyField: req.body.remuxOnly,
      rotateField: req.body.rotate,
      outputFilenameField: req.body.outputFilename,
      saveFolderQuery: req.query.saveFolder,
      saveFolderField: req.body.saveFolder,
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

    // parse rotate degrees (optional)
    let rotateDeg = 0;
    if (typeof req.body.rotate !== 'undefined' && req.body.rotate !== null && String(req.body.rotate).trim() !== '') {
      const n = Number(req.body.rotate);
      if (!Number.isFinite(n)) {
        return res.status(400).json({ error: 'invalid rotate value' });
      }
      // normalize to 0-360
      rotateDeg = ((n % 360) + 360) % 360;
    }

    // parse output filename (optional)
    let outputFilename = null;
    if (typeof req.body.outputFilename === 'string' && req.body.outputFilename.trim() !== '') {
      outputFilename = req.body.outputFilename.trim();
      // ensure .mp4 extension
      if (!/\.[^/.]+$/.test(outputFilename)) outputFilename += '.mp4';
      // sanitize filename to avoid path traversal
      outputFilename = path.basename(outputFilename);
    }

    // New: parse saveFolder (optional) - prefer body then query
    let saveFolder = null;
    const saveFolderRaw = (typeof req.body.saveFolder !== 'undefined' ? req.body.saveFolder : req.query.saveFolder);
    if (typeof saveFolderRaw === 'string' && saveFolderRaw.trim() !== '') {
      saveFolder = saveFolderRaw.trim();
      // resolve to absolute path
      if (!path.isAbsolute(saveFolder)) {
        // make it absolute relative to server cwd
        saveFolder = path.resolve(process.cwd(), saveFolder);
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

        // If saveFolder provided, copy final file into that folder (use outputFilename or original name)
        let savedTo = null;
        if (saveFolder) {
          // Ensure folder exists
          fs.mkdirSync(saveFolder, { recursive: true });
          const filenameForSave = outputFilename || `${path.basename(req.file.originalname || 'video')}.mp4`;
          const finalSavePath = path.join(saveFolder, filenameForSave);
          fs.copyFileSync(returnPath, finalSavePath);
          savedTo = finalSavePath;
          console.info('[splice] remux-only output saved to', finalSavePath);
        }

        res.setHeader('Content-Type', 'video/mp4');
        const dispositionName = outputFilename || `${path.basename(req.file.originalname || 'video')}.mp4`;
        res.setHeader('Content-Disposition', `inline; filename="${dispositionName}"`);
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
        // we extract with copy to preserve quality; later we'll apply rotate if requested
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

      const joinedPath = path.join(tmpDir, 'output_spliced.mp4');
      await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', joinedPath]);

      // If rotation requested, apply transform to the joined file.
      let finalPath = joinedPath;
      if (rotateDeg && Number(rotateDeg) % 360 !== 0) {
        const rotatedPath = path.join(tmpDir, 'output_spliced_rotated.mp4');

        // Probe original dimensions so we can ensure even dimensions before encoding.
        const dims = await probeVideoDimensions(joinedPath);

        // Build filter list: optional pad to even dims, then rotate.
        const filters = [];
        if (dims && (dims.width % 2 !== 0 || dims.height % 2 !== 0)) {
          const padExpr = evenDimensionFilterExpression(dims.width, dims.height);
          if (padExpr) filters.push(padExpr);
        }

        // rotate filter expects radians. Use shortest path to handle multiples of 90 cleanly via transpose where possible.
        // If rotation is 90/180/270, using transpose/transpose=2 and transpose=1 is better (fast, no re-scale).
        const r = rotateDeg % 360;
        let rotateFilter = null;
        if (r === 90) {
          // transpose=1 rotates 90° clockwise
          filters.push('transpose=1');
        } else if (r === 270) {
          // transpose=2 rotates 90° counter-clockwise (transpose=2 is rotate 90° counterclockwise and vertical flip)
          filters.push('transpose=2');
        } else if (r === 180) {
          // rotate 180 via transpose twice or via rotate PI
          filters.push('transpose=1,transpose=1');
        } else {
          // arbitrary rotation: use rotate in radians and expand output to hold rotated frame
          const angleRad = (rotateDeg * Math.PI) / 180;
          // use bilinear interpolation and set out_w/out_h to rotw/roth to avoid cropping
          rotateFilter = `rotate=${angleRad}:ow=rotw(iw):oh=roth(ih):bilinear=1`;
          filters.push(rotateFilter);
        }

        // Combine filters if any
        const vf = filters.join(',');

        // When re-encoding, ensure output dimensions are even (libx264 requirement).
        // We'll set -pix_fmt yuv420p to be broadly compatible.
        const ffArgs = [
          '-y',
          '-i', joinedPath,
          '-vf', vf,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          rotatedPath
        ];

        // If we couldn't probe dimensions, be defensive: add a final crop/pad to even via ffmpeg expression after rotate
        // (ffmpeg will error if encoder gets odd dimensions). We add an extra pad to force even sizes if necessary.
        if (!dims) {
          // Append a final pad to even values using ffmpeg expressions (makes width/height even)
          // This uses modulo arithmetic: pad=ceil(iw/2)*2:ceil(ih/2)*2
          const fallbackPad = `pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black`;
          ffArgs[3] = vf ? (vf + ',' + fallbackPad) : fallbackPad; // ffArgs[3] is the '-vf' value
        }

        // Run ffmpeg re-encode with filters
        try {
          await runFFmpeg(ffArgs);
        } catch (err) {
          // If encoding failed due to odd dimension issues, attempt a safer pipeline: pre-pad to even dims then rotate.
          const errMsg = err && err.message ? err.message : String(err);
          if (errMsg.includes('width not divisible by 2') || errMsg.includes('height not divisible by 2') || errMsg.includes('Error while opening encoder')) {
            console.warn('[splice] encoder odd-dimension failure, retrying with explicit pad to even dims');

            // Build pad based on probed dims if available, otherwise use expression-based pad
            let padFilter;
            if (dims) {
              const padExpr = evenDimensionFilterExpression(dims.width, dims.height);
              padFilter = padExpr || null;
            } else {
              padFilter = `pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black`;
            }

            const retryFilters = [];
            if (padFilter) retryFilters.push(padFilter);

            // reuse transpose/rotate logic
            if (r === 90) retryFilters.push('transpose=1');
            else if (r === 270) retryFilters.push('transpose=2');
            else if (r === 180) retryFilters.push('transpose=1,transpose=1');
            else {
              const angleRad = (rotateDeg * Math.PI) / 180;
              retryFilters.push(`rotate=${angleRad}:ow=rotw(iw):oh=roth(ih):bilinear=1`);
            }

            const retryVf = retryFilters.join(',');
            const retryArgs = [
              '-y',
              '-i', joinedPath,
              '-vf', retryVf,
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '18',
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac',
              '-b:a', '128k',
              '-movflags', '+faststart',
              rotatedPath
            ];
            await runFFmpeg(retryArgs);
          } else {
            throw err;
          }
        }

        finalPath = rotatedPath;
      }

      // If saveFolder provided, copy finalPath into that folder (use outputFilename or spliced default)
      if (saveFolder) {
        const saveDir = saveFolder;
        fs.mkdirSync(saveDir, { recursive: true });
        const filenameForSave = outputFilename || `${path.basename(req.file.originalname || 'video')}_spliced.mp4`;
        const destination = path.join(saveDir, filenameForSave);
        fs.copyFileSync(finalPath, destination);
        console.info('[splice] final output saved to', destination);
      }

      // Set response headers and filename (use outputFilename if provided)
      const dispositionName = outputFilename || `${path.basename(req.file.originalname || 'video')}_spliced.mp4`;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${dispositionName}"`);
      const stream = fs.createReadStream(finalPath);
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
