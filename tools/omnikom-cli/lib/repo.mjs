// Where the repository is. The CLI lives in tools/omnikom-cli but reuses files elsewhere in the repo (the canonical signature,
// the contract validator, the migrations, the staff scripts). OMNIKOM_REPO_ROOT lets the mutation runner run a modified COPY of
// the CLI against the real repo.
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(CLI_DIR, '..', '..');
export const repoPath = (...p) => join(REPO, ...p);
export const importRepo = rel => import(pathToFileURL(repoPath(rel)).href);
export const FIXTURES_DIR = join(CLI_DIR, 'fixtures');
