export const WORKSPACE_A: string;
export type PlannedRow = { id: string; collection: string; title: string };
export function plan(): Promise<{ remove: PlannedRow[]; kept: (PlannedRow & { newer: string })[] }>;
export function removeRows(ids: string[]): Promise<{ id: string; ok: boolean; message: string }[]>;
