// Runs a command with the variables of an env file loaded, by name, never printed. Also sets OMNIKOM_ENV_FILE to the file.
//   [WITH_ENV_TIMEOUT_MIN=<minutes>] node tools/with-env.mjs "<env file>" -- <command> [args...]
// Lines are NAME=value; blank lines and # comments are skipped. The child is stopped, with everything it started, after
// WITH_ENV_TIMEOUT_MIN minutes (caller's environment, default 10, 0 = no limit): one line on stderr and exit 124. 127 = the command
// could not start, 2 = bad usage or a bad WITH_ENV_TIMEOUT_MIN, anything else is the child's own status.
// The code is tools/omnikom-cli/lib/with-env.mjs (so its mutation tests can reach it); this file only calls it.
import { main } from './omnikom-cli/lib/with-env.mjs';

process.exit(await main(process.argv.slice(2)));
