// Work order 18: isInstant, the body check of lead-update follow_up and lead-task due. A pure function, in its own file so its mutants
// run this file alone (a few milliseconds) and not the whole crm3b file.
import { isInstant } from '../_shared/http.ts';
import { assert, t } from './util.ts';

// ---------- isInstant (the body check of follow_up and due) ----------
t('isInstant: a date and time with an offset on a real day is one; a date, a missing offset, a day that does not exist and a wrong clock are not', () => {
  for (const ok of ['2026-11-20T10:00:00Z', '2026-11-20T10:00Z', '2026-11-20T10:00:00.123+02:00', '2026-02-28T23:59:59-05:30', '2028-02-29T00:00:00Z']) assert(isInstant(ok), `${ok} is valid`);
  for (const bad of ['2026-11-20', '2026-11-20T10:00:00', '2026-02-30T10:00:00Z', '2027-02-29T10:00:00Z', '2026-13-01T10:00:00Z', '2026-11-20T24:00:00Z', '2026-11-20T10:75:00Z', '2026-11-20T10:00:75Z',
    '2026-11-20T10:00:00+99:00', '2026-11-20T10:00:00+16:00', '2026-11-20T10:00:00+02:60', '2026-11-20 10:00:00Z', 'tomorrow', '', '2026-11-20T10:00:00Zjunk']) assert(!isInstant(bad), `${bad} is not valid`);
});
