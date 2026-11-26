// Watched-fail for run-cp11.mjs: the reference advisor with one known-wrong change (every price.base reply carries an
// invented total). The runner must exit 1 and name graded-worse rows. Run it the same way as the reference.
import { loadAdvisor as ref } from './reference-advisor.mjs';
export async function loadAdvisor() {
  const a = await ref();
  const respond = a.engine.respond.bind(a.engine);
  const engine = Object.create(a.engine);
  engine.respond = (s, t) => { const r = respond(s, t); if ((r.reply.intents || []).includes('price.base')) r.reply = { ...r.reply, text: r.reply.text + ' Three callers are $3,897 per month.' }; return r; };
  return { ...a, engine, label: 'MUTANT: invented seat total on price.base' };
}
