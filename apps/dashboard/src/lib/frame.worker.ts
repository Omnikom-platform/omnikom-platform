// The instant frame's worker (book row B15): the factory's renderer runs here, off the page's thread. contracts/validate.mjs reads process.argv when it
// loads (its command line) and a browser has no process: it is set first, and the renderer is loaded after it.
import type { FrameInput } from './frame';

(globalThis as { process?: unknown }).process ??= { argv: [] };
const renderer = import('./frame-render');
const scope = self as unknown as { onmessage: ((e: MessageEvent<FrameInput>) => void) | null; postMessage: (m: unknown) => void };
scope.onmessage = async (e) => {
  try { scope.postMessage({ n: e.data.n, html: await (await renderer).frameHtml(e.data) }); }
  catch (err) { scope.postMessage({ n: e.data.n, error: String(err instanceof Error ? err.message : err).slice(0, 200) }); }
};
