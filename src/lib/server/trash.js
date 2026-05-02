const { spawn } = require('child_process');

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} failed: ${code}\n${stderr}`));
    });
    p.on('error', reject);
  });
}

async function trashOne(absPath) {
  const trashCommands = [
    { cmd: 'gio', args: ['trash', absPath] },
    { cmd: 'gvfs-trash', args: [absPath] },
    { cmd: 'trash-put', args: [absPath] }
  ];
  for (const t of trashCommands) {
    try {
      await runProcess(t.cmd, t.args);
      return;
    } catch (e) {
      /* try next */
    }
  }
  throw new Error('no-trash-command');
}

/**
 * @param {string[]} absPaths
 * @returns {{ ok: string[], errors: { path: string, error: string }[] }}
 */
async function trashPaths(absPaths) {
  const ok = [];
  const errors = [];
  for (const absPath of absPaths) {
    try {
      await trashOne(absPath);
      ok.push(absPath);
    } catch (e) {
      errors.push({ path: absPath, error: e.message || String(e) });
    }
  }
  return { ok, errors };
}

module.exports = { trashPaths, trashOne };
