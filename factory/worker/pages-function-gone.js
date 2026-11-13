// Cloudflare Pages middleware of a deployment that must answer 404 at the addresses of items that left the site (book row B12-E): the runner copies it to functions/_middleware.js,
// gone.mjs beside it, and writes gone-list.mjs ({ paths, page }). Never in a draft: the draft gate has this file name there. _routes.json invokes it for /api/lead and those addresses only.
import { makeGone } from './gone.mjs';
import { GONE } from './gone-list.mjs';

const gone = makeGone(GONE);
export const onRequest = ({ request, next }) => gone(request, next);
