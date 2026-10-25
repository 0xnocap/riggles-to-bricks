// Builds riggle models off the main
// thread. Requests and replies are plain objects (nothing transferred). The
// curve of the last Squiggles is kept, so the three displays of one size share
// one ribbon (display.ts caches it per curve).
import type { Curve } from './curve';
import { curveFromImage, type ImageCurve, type RGBAImage } from './fromImage';
import type { Display, Format, Scale, SqModel } from './model';
import { buildRiggleModel } from '../riggle/build';

export interface BuildJob { key: string; curve: Curve; meta: { id: number; hash: string }; format: Format; display: Display | null; scale: Scale; studs?: boolean }
export type WorkerRequest = { id: number; build: BuildJob } | { id: number; trace: { image: RGBAImage; sid: number | null } };
export type WorkerReply =
  | { id: number; ok: true; model?: SqModel; trace?: ImageCurve; ms: number }
  | { id: number; ok: false; message: string };

const curves = new Map<string, Curve>();

/** one model; the same curve object for a key, whatever copy the request brought */
export function runBuild(j: BuildJob): SqModel {
  let curve = curves.get(j.key);
  if (!curve) {
    curve = j.curve;
    curves.set(j.key, curve);
    while (curves.size > 3) curves.delete(curves.keys().next().value!);
  }
  return buildRiggleModel(curve, j.meta, { format: j.format, display: j.display ?? 'frame', scale: j.scale, studs: !!j.studs });
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const q = e.data, t = performance.now();
    let reply: WorkerReply;
    try {
      reply = 'build' in q ? { id: q.id, ok: true, model: runBuild(q.build), ms: performance.now() - t }
        : { id: q.id, ok: true, trace: curveFromImage(q.trace.image, { id: q.trace.sid ?? undefined }), ms: performance.now() - t };
    } catch (err) {
      reply = { id: q.id, ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    (self as unknown as Worker).postMessage(reply);
  };
}
