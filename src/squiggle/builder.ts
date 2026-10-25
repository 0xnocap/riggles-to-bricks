// The page's side of the model workers: every model of a loaded Squiggle,
// built on first ask (Relief: 3 displays × 2 sizes, Mosaic: 2 sizes) and kept.
// Two workers when the device has the cores (one per size, so each keeps its
// ribbon); without Worker (Node, tests) the builds run here.
import type { Curve } from './curve';
import type { ImageCurve, RGBAImage } from './fromImage';
import type { Loaded } from './load';
import type { Display, Format, Scale, SqModel } from './model';
import { SourceError } from './source';
import type { BuildJob, WorkerReply, WorkerRequest } from './worker';

export type ModelRequest = { format: Format; display?: Display | null; scale: Scale; studs?: boolean };
// Backdrop is built but not offered: Cap cut it from the page on 2026-10-25.
// The builder keeps it, so it is one entry away if it ever comes back.
export const DISPLAYS: Display[] = ['frame', 'floating'];
export const SCALES: Scale[] = ['large', 'small'];

export interface Builds {
  /** the model for a request: built on first ask, then the same promise */
  get(r: ModelRequest): Promise<SqModel>;
  /** the models built so far (the smooth-top look) */
  relief: Partial<Record<Scale, Partial<Record<Display, SqModel>>>>;
  mosaic: Partial<Record<Scale, SqModel>>;
  /** build time of each model, ms, by request key */
  ms: Record<string, number>;
  /** every model */
  all(): Promise<{ relief: Record<Scale, Record<Display, SqModel>>; mosaic: Record<Scale, SqModel> }>;
}

// ---- the workers ----

type Pending = { ok: (r: Extract<WorkerReply, { ok: true }>) => void; ko: (e: Error) => void; trace: boolean };
let pool: Worker[] | null = null, nextId = 1;
const pending = new Map<number, Pending>();

function workers(): Worker[] {
  if (pool) return pool;
  pool = [];
  if (typeof Worker === 'undefined') return pool;
  const n = (navigator.hardwareConcurrency ?? 2) >= 4 ? 2 : 1;
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerReply>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.ok(e.data);
        else p.ko(p.trace ? new SourceError(e.data.message) : new Error(`Something went wrong while building: ${e.data.message}`));
      };
      w.onerror = e => { for (const [id, p] of pending) { pending.delete(id); p.ko(new Error(`The model worker stopped: ${e.message}`)); } };
      pool.push(w);
    }
  } catch { pool = []; }
  return pool;
}

function send(q: Omit<WorkerRequest, 'id'>, lane: number): Promise<Extract<WorkerReply, { ok: true }>> {
  const ws = workers(), id = nextId++;
  return new Promise((ok, ko) => {
    pending.set(id, { ok, ko, trace: 'trace' in q });
    ws[lane % ws.length].postMessage({ ...q, id } as WorkerRequest);
  });
}

/** A picture traced into a curve, off the main thread when possible. */
export async function traceImage(image: RGBAImage, sid: number | null): Promise<ImageCurve> {
  if (!workers().length) return (await import('./fromImage')).curveFromImage(image, { id: sid ?? undefined });
  return (await send({ trace: { image, sid } }, 0)).trace!;
}

// ---- the models of one Squiggle ----

const keys = new WeakMap<Loaded, string>();
let nextKey = 1;

/** the nameplate without a token number or hash: what is known */
function nameplate(m: SqModel, l: Loaded): SqModel {
  if (m.nameplate && (l.id === null || !l.hash)) {
    m.nameplate.lines = [l.id === null ? 'Chromie Squiggle' : `Chromie Squiggle #${l.id}`, 'Snowfro · Art Blocks · 2020'];
  }
  return m;
}

export function buildAll(loaded: Loaded): Builds {
  if (!keys.has(loaded)) keys.set(loaded, `sq${nextKey++}`);
  const key = keys.get(loaded)!, curve: Curve = loaded.curve, meta = { id: loaded.id ?? 0, hash: loaded.hash ?? '' };
  const cache = new Map<string, Promise<SqModel>>();
  const b: Builds = {
    relief: {}, mosaic: {}, ms: {},
    get(r) {
      const display = r.format === 'mosaic' ? null : r.display ?? 'frame', k = `${r.format}-${display ?? ''}-${r.scale}${r.studs ? '-studs' : ''}`;
      if (!cache.has(k)) {
        const job: BuildJob = { key, curve, meta, format: r.format, display, scale: r.scale, studs: r.studs };
        const t = performance.now();
        const run = workers().length
          ? send({ build: job }, r.scale === 'large' ? 0 : 1).then(x => { b.ms[k] = Math.round(x.ms); return x.model!; })
          : import('./worker').then(w => { const m = w.runBuild(job); b.ms[k] = Math.round(performance.now() - t); return m; });
        const p = run.then(m => {
          nameplate(m, loaded);
          if (!r.studs) {
            if (r.format === 'mosaic') b.mosaic[r.scale] = m;
            else (b.relief[r.scale] ??= {})[display!] = m;
          }
          return m;
        });
        p.catch(() => cache.delete(k));
        cache.set(k, p);
      }
      return cache.get(k)!;
    },
    async all() {
      const relief = {} as Record<Scale, Record<Display, SqModel>>, mosaic = {} as Record<Scale, SqModel>;
      await Promise.all(SCALES.flatMap(scale => [
        b.get({ format: 'mosaic', scale }).then(m => { mosaic[scale] = m; }),
        ...DISPLAYS.map(display => b.get({ format: 'relief', display, scale }).then(m => { (relief[scale] ??= {} as Record<Display, SqModel>)[display] = m; })),
      ]));
      return { relief, mosaic };
    },
  };
  return b;
}
