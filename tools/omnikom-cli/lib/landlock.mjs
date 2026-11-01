// The land lock's name, in ONE place (DECISIONS 45, the landing queue): the branch `omnikom land` takes on the remote so that two heads never
// both move master. commands/land.mjs takes and releases it, commands/hooks.mjs lets the pre-push hook allow it, and a unit check reads the
// real .github/workflows/ci.yml and asserts that its `push: branches-ignore:` list is exactly [LOCK_BRANCH] (every push of the lock would
// otherwise start a ci run on its empty root commit).
export const LOCK_BRANCH = 'land-lock';
export const LOCK_REF = `refs/heads/${LOCK_BRANCH}`;
export const STALE_LOCK_MINUTES = 90;
