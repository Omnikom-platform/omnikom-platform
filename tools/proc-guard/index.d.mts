// Types for tools/proc-guard/index.mjs, so the TypeScript of apps/dashboard can import it.
export const PREFIXES: string[];
export const PARENT_CHECKED: string[];
export const NO_OWNER_MAX_AGE_MS: number;
export interface Proc { pid: number; ppid: number; name: string; cmd: string }
export interface Leak { pid: number; name: string; folder: string }
export interface Guarded { dir: string; release(o?: { keep?: boolean }): void }
export interface SweepOptions { tmp?: string; now?: number; log?: (line: string) => void; pgCtl?: string[] }
export interface Swept { dir: string; why: string; stopped: boolean; killed: number; removed: boolean }
export function listProcs(): Proc[];
export function isAlive(pid: number): boolean;
export function killTree(pid: number): boolean;
export function killFolderProcs(dir: string, procs?: Proc[]): number;
export function leaks(prefixes?: string[], o?: { tmp?: string; procs?: Proc[] }): Leak[];
export function guardedTemp(prefix: string, kind?: string, opts?: { tmp?: string; label?: string; pgCtl?: string[] }): Guarded;
export function guardedTempEnv(prefix: string, kind?: string, opts?: { tmp?: string; label?: string; pgCtl?: string[] }): Guarded;
export function runLimited(cmd: string, args?: string[], opts?: Record<string, unknown>): Promise<{ status: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; error: Error | null; pid: number | undefined }>;
export function sweep(prefixes?: string[], o?: SweepOptions): Swept[];
