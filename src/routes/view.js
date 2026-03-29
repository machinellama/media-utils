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
    const absInput = path.join(path.resolve(folder), file);
    const absOutput = path.join(path.resolve(folder), newName);

    try {
      if (!cropArea || cropArea.width <= 0 || cropArea.height <= 0) {
        return res.status(400).json({ error: 'Invalid crop area' });
      }

      // 1. Create the sharp instance and handle auto-rotation (EXIF)
      // 2. Also apply the manual rotation from the UI slider if present
      let pipeline = sharp(absInput, { failOn: 'none' }).rotate(rotation || 0);

      // 3. Get metadata of the image AFTER rotation to ensure coordinates match
      const metadata = await pipeline.metadata();
      
      // 4. Clamp coordinates to image boundaries to prevent "bad extract area"
      // Sharp will throw an error if (left + width) > metadata.width
      const left = Math.max(0, Math.floor(cropArea.x));
      const top = Math.max(0, Math.floor(cropArea.y));
      
      // Ensure width/height don't go out of bounds
      const width = Math.min(Math.round(cropArea.width), metadata.width - left);
      const height = Math.min(Math.round(cropArea.height), metadata.height - top);

      // 5. Execute the extraction
      if (width <= 0 || height <= 0) {
        throw new Error("Crop area is outside image boundaries");
      }

      await pipeline
        .extract({ left, top, width, height })
        .toFile(absOutput);
        
      res.json({ success: true });
    } catch (e) {
      console.error("Crop error:", e);
      res.status(500).json({ error: e.message });
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
      } catch (e) {}
    }
    res.status(500).json({ error: 'Trash commands not found' });
  });

  return router;
};