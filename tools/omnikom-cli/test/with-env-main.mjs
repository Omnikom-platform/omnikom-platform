// What tools/with-env.mjs does, but through THIS copy of the CLI's lib/with-env.mjs (the mutation runner breaks a copy, and tools/with-env.mjs
// would still load the real one). Used by test/with-env.mjs.
import { main } from '../lib/with-env.mjs';

process.exit(await main(process.argv.slice(2)));
