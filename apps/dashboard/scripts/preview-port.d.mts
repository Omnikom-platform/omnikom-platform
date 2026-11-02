// Types of preview-port.mjs (the type check reads playwright.config.ts, vite.config.ts and tests/support/staging.ts, which import it).
export const BLOCK: readonly [number, number];
export const MAX_TRIES: number;
export const LISTEN: string;
export const PORT_ENV: string;
export const BIND_FAILURE: RegExp;
export function pickPort(rand?: () => number): number;
export function nextPort(port: number): number;
export function inBlock(port: number): boolean;
export function baseUrl(port: number): string;
export function portFromEnv(env?: Record<string, string | undefined>): number | null;
export function isBindFailure(error: unknown): boolean;
export function probe(port: number): Promise<boolean>;
export function choosePort(opts?: { probeFn?: (port: number) => Promise<boolean>; rand?: () => number; say?: (line: string) => void }): Promise<number>;
export function portForPlaywright(opts?: { env?: Record<string, string | undefined>; probeFn?: (port: number) => Promise<boolean>; rand?: () => number; say?: (line: string) => void }): Promise<number>;
export function startOnBlock<T>(start: (port: number) => Promise<T>, opts?: { rand?: () => number; say?: (line: string) => void }): Promise<{ port: number; server: T }>;
