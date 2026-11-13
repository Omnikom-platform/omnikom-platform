// Cloudflare Pages middleware of a preview build's deployment (book row B15 part b3): the runner copies it to functions/_middleware.js, draft-gate.mjs beside it,
// and writes draft-gate-key.mjs (the token's sha256 and end time). It runs before every page, file and /api/lead.
import { makeDraftGate } from './draft-gate.mjs';
import { GATE } from './draft-gate-key.mjs';

const gate = makeDraftGate(GATE);
export const onRequest = ({ request, next }) => gate(request, next);
