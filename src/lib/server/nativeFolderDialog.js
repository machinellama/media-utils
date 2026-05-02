const { execFileSync } = require('child_process');

/**
 * Opens a native OS folder picker (local server only). Returns absolute path or null.
 */
function pickNativeFolder() {
  try {
    if (process.platform === 'win32') {
      const cmd = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
        '$f.Description = "Select folder";',
        'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath } else { exit 1 }'
      ].join(' ');
      const out = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', cmd], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000
      }).trim();
      return out || null;
    }
    if (process.platform === 'darwin') {
      const out = execFileSync(
        'osascript',
        [
          '-e',
          'tell application "System Events" to return POSIX path of (choose folder with prompt "Select folder")'
        ],
        { encoding: 'utf8', timeout: 120000 }
      ).trim();
      return out || null;
    }
    try {
      const out = execFileSync(
        'zenity',
        ['--file-selection', '--directory', '--title=Select folder'],
        { encoding: 'utf8', timeout: 120000 }
      ).trim();
      if (out) return out;
    } catch (_) {
      /* canceled or missing */
    }
    try {
      const out = execFileSync('kdialog', ['--getexistingdirectory'], {
        encoding: 'utf8',
        timeout: 120000
      }).trim();
      if (out) return out;
    } catch (_) {
      /* canceled or missing */
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { pickNativeFolder };
