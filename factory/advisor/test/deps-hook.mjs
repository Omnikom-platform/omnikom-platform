// Mutant runs (lib-test-kit) copy engine/ to a temporary folder, where a bare import such as "xstate" finds no node_modules.
// This resolve hook looks the advisor's own dependencies up from factory/advisor/, whichever folder imports them. Imported
// first by every test that runs engine mutants in-process.
import { register } from 'node:module';
const ADV = JSON.stringify(new URL('../package.json', import.meta.url).href);
register('data:text/javascript,' + encodeURIComponent(
  'export async function resolve(s, c, next) { return /^(?:xstate|@xstate\\/)/.test(s) ? next(s, { ...c, parentURL: ' + ADV + ' }) : next(s, c); }'));
