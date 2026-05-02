/**
 * Limit concurrent CPU-heavy thumbnail generations (ffmpeg/sharp).
 */
function createSemaphore(max) {
  let active = 0;
  const queue = [];

  function next() {
    if (active >= max || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    active++;
    Promise.resolve()
      .then(fn)
      .then(
        v => {
          active--;
          resolve(v);
          next();
        },
        err => {
          active--;
          reject(err);
          next();
        }
      );
  }

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

module.exports = { createSemaphore };
