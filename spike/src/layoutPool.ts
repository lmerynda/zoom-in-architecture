import type { LayoutJob, LayoutKind, LocalLayout } from './layout'

/** Runs ELK over all containers, spread across a few workers so the UI thread only draws. */
export async function runLayout(jobs: LayoutJob[], kind: LayoutKind): Promise<Map<number, LocalLayout>> {
  const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1, Math.ceil(jobs.length / 200)))
  const chunks: LayoutJob[][] = Array.from({ length: workers }, () => [])
  // Biggest jobs first, each to the lightest chunk, so workers finish together.
  const load = new Array(workers).fill(0)
  for (const j of [...jobs].sort((a, b) => b.children.length - a.children.length)) {
    const k = load.indexOf(Math.min(...load))
    chunks[k].push(j)
    load[k] += j.children.length + j.edges.length
  }
  const results = await Promise.all(chunks.map(chunk => new Promise<LocalLayout[]>((resolve, reject) => {
    const w = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = ev => { resolve(ev.data); w.terminate() }
    w.onerror = ev => { reject(new Error(ev.message)); w.terminate() }
    w.postMessage({ jobs: chunk, kind })
  })))
  const out = new Map<number, LocalLayout>()
  for (const r of results) for (const L of r) out.set(L.id, L)
  return out
}
