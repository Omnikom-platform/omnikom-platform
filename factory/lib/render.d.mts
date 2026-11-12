// Types for factory/lib/render.mjs as the dashboard's instant frame calls it (book row B15).
export function renderRow(o: Record<string, unknown>): Promise<{ path: string; html: string }>;
