/**
 * Resolve ffmpeg/ffprobe when `spawn('ffmpeg')` fails with ENOENT (not on PATH),
 * e.g. Node started from a desktop launcher with a minimal PATH.
 */
const fs = require('fs');
const path = require('path');

function existsExecutable(p) {
  if (!p || typeof p !== 'string') return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function binCandidates(baseName) {
  const out = [];
  if (process.platform === 'win32') {
    const exe = `${baseName}.exe`;
    if (process.env.LOCALAPPDATA) {
      out.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe));
    }
    out.push(
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', exe),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'ffmpeg', 'bin', exe)
    );
    return out;
  }
  if (process.platform === 'darwin') {
    return [`/opt/homebrew/bin/${baseName}`, `/usr/local/bin/${baseName}`, `/usr/bin/${baseName}`];
  }
  return [`/usr/bin/${baseName}`, `/usr/local/bin/${baseName}`, `/snap/bin/${baseName}`];
}

function firstExisting(paths) {
  for (const p of paths) {
    if (existsExecutable(p)) return p;
  }
  return null;
}

function getFfmpegPath() {
  const env = process.env.FFMPEG_PATH?.trim();
  if (env && existsExecutable(env)) return env;
  if (env) console.warn('[media-utils] FFMPEG_PATH is set but file not found:', env);

  const found = firstExisting(binCandidates('ffmpeg'));
  if (found) return found;
  return 'ffmpeg';
}

function getFfprobePath() {
  const env = process.env.FFPROBE_PATH?.trim();
  if (env && existsExecutable(env)) return env;
  if (env) console.warn('[media-utils] FFPROBE_PATH is set but file not found:', env);

  const ff = getFfmpegPath();
  if (ff && ff !== 'ffmpeg') {
    const dir = path.dirname(ff);
    const probe =
      process.platform === 'win32' ? path.join(dir, 'ffprobe.exe') : path.join(dir, 'ffprobe');
    if (existsExecutable(probe)) return probe;
  }

  const found = firstExisting(binCandidates('ffprobe'));
  if (found) return found;
  return 'ffprobe';
}

module.exports = { getFfmpegPath, getFfprobePath };
