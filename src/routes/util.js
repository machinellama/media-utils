const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

// Helper: ensure dimensions are even (required by many encoders like libx264)
// Returns an ffmpeg pad/crop scale expression or null if not needed.
function evenDimensionFilterExpression(width, height) {
  // If both even, no need. If odd, we will scale/pad to even.
  // We'll use "pad" to add 1 pixel if odd to make even dimensions without significant distortion.
  const makeEven = (v) => (v % 2 === 0 ? v : v + 1);
  const evenW = makeEven(width);
  const evenH = makeEven(height);
  if (evenW === width && evenH === height) return null;
  // pad syntax: pad=width:height:x:y:color
  // We'll pad on the right/bottom by default: x=0,y=0
  return `pad=${evenW}:${evenH}:0:0:black`;
}

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

async function probeVideoDimensions(inputPath) {
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0:s=x',
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
    if (!out.stdout) return null;
    const parts = out.stdout.split('x').map(s => Number(s));
    if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
    return { width: parts[0], height: parts[1] };
  } catch (e) {
    console.warn('[splice] probe failed', e && e.message ? e.message : e);
    return null;
  }
}

module.exports = {
  needsRemuxToMp4,
  runFFmpeg,
  evenDimensionFilterExpression,
  probeVideoDimensions,
  runCmd
}