// Types of staging-env.mjs (the type check reads tests/flows.spec.ts, which imports it).
export const ROOT: string;
export const ASK_EMAIL: string;
export function stagingBuildEnv(env: Record<string, string | undefined>, opts?: { directFunctions?: boolean }): { missing: string[]; env?: undefined } | { env: Record<string, string | undefined>; missing?: undefined };
export function runWithStaging(args: string[], opts?: { timeoutMs?: number; directFunctions?: boolean }): number;
