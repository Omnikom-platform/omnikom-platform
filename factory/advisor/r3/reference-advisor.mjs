// The REFERENCE advisor for the R3 runner: today's omnikom.io engine and guided flow, loaded READ-ONLY from the lovable
// repo's TypeScript sources (needs --import ./factory/advisor/r3/ts-hook.mjs). Set LOVABLE_SRC to lovable-app/src/lib.
// It exists so the runner can prove itself: run on the reference, it must reproduce cp11 with zero graded changes.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const SRC = process.env.LOVABLE_SRC || 'E:/omnikom-wt/lovable/lovable-app/src/lib';
const imp = (f) => import(pathToFileURL(join(SRC, f)).href);
export async function loadAdvisor() {
  const [eng, script, routing] = await Promise.all([imp('advisor-engine/index.ts'), imp('advisor-script.ts'), imp('helper-routing.ts')]);
  const flow = {
    faq: script.faqChoices, enquiry: routing.enquiryChoices, scripted: script.getScriptedReply,
    site: routing.isSiteQuestion, enquiryScript: routing.shouldUseEnquiryScript, route: routing.routeToScript,
  };
  return { engine: eng.getEngine(), initialState: eng.initialState, flow, label: 'reference: lovable source ' + SRC };
}
