const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');

const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];

module.exports = () => {
  const router = express.Router();

  // List images in a folder
  router.post('/list', express.json(), async (req, res) => {
    const { folder } = req.body;
    if (!folder) return res.status(400).json({ error: 'No folder provided' });

    try {
      const absRoot = path.resolve(folder);
      const items = fs.readdirSync(absRoot, { withFileTypes: true });

      const images = items
        .filter(it => it.isFile() && IMG_EXTS.includes(path.extname(it.name).toLowerCase()))
        .map(it => {
          const fullPath = path.join(absRoot, it.name);
          const stat = fs.statSync(fullPath);
          return {
            name: it.name,
            path: it.name, // relative to root
            size: stat.size,
            mtime: stat.mtimeMs
          };
        });

      res.json({ images });
    } catch (e) {
      res.status(500).json({ error: 'Failed to scan directory' });
    }
  });

  // Serve full image
  router.get('/file', (req, res) => {
    const { folder, file } = req.query;
    const absPath = path.join(path.resolve(folder), file);
    if (!fs.existsSync(absPath)) return res.status(404).end();
    res.sendFile(absPath);
  });

  router.get('/thumbnail', async (req, res) => {
    const { folder, file } = req.query;
    const absPath = path.join(path.resolve(folder), file);

    try {
      const thumb = await sharp(absPath, { failOn: 'none' }) // <--- ADD THIS
        .rotate()
        .resize(320, 320, { fit: 'cover', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
      res.send(thumb);
    } catch (e) {
      res.sendFile(absPath);
    }
  });

  router.post('/crop', express.json(), async (req, res) => {
    const { folder, file, cropArea, newName, rotation } = req.body;
    if (!folder || !file || !newName) return res.status(400).json({ error: 'folder, file and newName required' });

    try {
      const absFolder = path.resolve(folder);
      const absInput = path.join(absFolder, file);
      const absOutput = path.join(absFolder, newName);

      if (!fs.existsSync(absInput)) return res.status(404).json({ error: 'input file not found' });
      if (!path.resolve(absOutput).startsWith(absFolder + path.sep)) return res.status(400).json({ error: 'newName resolves outside folder' });
      if (!cropArea || cropArea.width <= 0 || cropArea.height <= 0) return res.status(400).json({ error: 'Invalid crop area' });

      const rotationAngle = typeof rotation === 'number' ? rotation : 0;

      // Build pipeline and apply EXIF auto-rotation + manual rotation
      const base = sharp(absInput, { failOn: 'none' }).rotate(rotationAngle);

      // Read metadata AFTER rotate() so dimensions match pixel data
      const metadata = await base.metadata();
      if (!metadata.width || !metadata.height) throw new Error('Unable to determine image dimensions');

      // Clamp coordinates to integer bounds
      const left = Math.max(0, Math.floor(cropArea.x || 0));
      const top = Math.max(0, Math.floor(cropArea.y || 0));
      const width = Math.min(Math.round(cropArea.width), metadata.width - left);
      const height = Math.min(Math.round(cropArea.height), metadata.height - top);
      if (width <= 0 || height <= 0) return res.status(400).json({ error: 'Crop area is outside image boundaries' });

      // Perform extract WITHOUT metadata (avoid sharp's metadata validation issues)
      await base.extract({ left, top, width, height }).toFile(absOutput);

      // Use exiftool to copy all metadata (EXIF, ICC, etc.) and normalize orientation to 1
      try {
        await new Promise((resolve, reject) => {
          const p = spawn('exiftool', [
            '-overwrite_original',
            '-TagsFromFile', absInput,
            '-all:all',
            '-orientation#=1',
            absOutput
          ]);
          p.on('close', code => code === 0 ? resolve() : reject(new Error('exiftool failed with code ' + code)));
          p.on('error', reject);
        });
      } catch (exifErr) {
        console.error('exiftool step failed (non-fatal):', exifErr);
      }

      return res.json({ success: true, output: newName });
    } catch (e) {
      console.error('Crop error:', e);
      return res.status(500).json({ error: e.message || 'Crop failed' });
    }
  });

  // Delete to Trash (same logic as video)
  router.post('/delete', express.json(), async (req, res) => {
    const { folder, file } = req.body;
    const absPath = path.join(path.resolve(folder), file);

    const trashCommands = [
      { cmd: 'gio', args: ['trash', absPath] },
      { cmd: 'gvfs-trash', args: [absPath] },
      { cmd: 'trash-put', args: [absPath] }
    ];

    for (const t of trashCommands) {
      try {
        await new Promise((resolve, reject) => {
          const p = spawn(t.cmd, t.args);
          p.on('close', code => code === 0 ? resolve() : reject());
          p.on('error', reject);
        });
        return res.json({ success: true });
      } catch (e) { }
    }
    res.status(500).json({ error: 'Trash commands not found' });
  });

  return router;
};