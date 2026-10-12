// assets/js/ask/progress.js
/**
 * Download progress for /ask/. The total comes from the model registry
 * (pinned file list + byte sizes), so the bar is accurate from the first
 * byte instead of growing as transformers.js discovers files. Zero imports.
 */

const MIN_SAMPLE_MS = 250;
const SMOOTHING = 0.3; // weight of the newest rate sample
export const TILE_BYTES = 4e6;

export function formatEta(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  return `${Math.round(seconds / 60)} min`;
}

/** Number of model-map tiles for a download of `bytes` (one per 4 MB). */
export function tileCount(bytes) {
  return Math.max(1, Math.ceil(bytes / TILE_BYTES));
}

export class DownloadProgress {
  /** @param {Array<{path: string, bytes: number}>} files */
  constructor(files, now = () => performance.now()) {
    this.sizes = new Map(files.map((f) => [f.path, f.bytes]));
    this.total = files.reduce((sum, f) => sum + f.bytes, 0);
    this.loaded = new Map();
    this.now = now;
    this.rate = null; // bytes per second, smoothed
    this.last = null;
  }

  update(path, loaded) {
    if (!this.sizes.has(path)) return;
    const prev = this.loaded.get(path) ?? 0;
    this.loaded.set(path, Math.min(Math.max(prev, loaded), this.sizes.get(path)));
    this.sample();
  }

  complete(path) {
    if (!this.sizes.has(path)) return;
    this.loaded.set(path, this.sizes.get(path));
    this.sample();
  }

  get loadedBytes() {
    let sum = 0;
    for (const v of this.loaded.values()) sum += v;
    return sum;
  }

  get fraction() {
    return this.total ? this.loadedBytes / this.total : 0;
  }

  get etaSeconds() {
    if (!this.rate || this.rate <= 0) return null;
    return (this.total - this.loadedBytes) / this.rate;
  }

  sample() {
    const t = this.now();
    const b = this.loadedBytes;
    if (this.last === null) {
      this.last = { t, b };
      return;
    }
    const dt = t - this.last.t;
    if (dt < MIN_SAMPLE_MS) return;
    const instant = ((b - this.last.b) / dt) * 1000;
    this.rate = this.rate === null ? instant : (1 - SMOOTHING) * this.rate + SMOOTHING * instant;
    this.last = { t, b };
  }

  label() {
    const mb = (x) => Math.round(x / 1e6);
    const pct = Math.floor(this.fraction * 100);
    const eta = this.etaSeconds;
    const tail = eta !== null && pct < 100 ? ` · ~${formatEta(eta)} left` : "";
    return `${mb(this.loadedBytes)} / ${mb(this.total)} MB · ${pct}%${tail}`;
  }
}
