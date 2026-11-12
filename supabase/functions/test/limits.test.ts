// E16 (migration 41): the plan limits on sites, photos and files, and publishes a day. The walls are tenancy.test.sql T47; this proves the
// words the dashboard gets: S-LIMIT is a 409 quota refusal that names the number and the thing, and any other S-LIMIT text gets fixed words.
// Names carry "[E16]" (FN_TEST_FILTER='[E16]' runs only these).
import { refusal } from '../_shared/db.ts';
import { eq, t } from './util.ts';

t('refusal [E16]: S-LIMIT is a 409 quota refusal whose words name the limit; any other S-LIMIT text gets fixed words', () => {
  const want: [string, string][] = [
    ['S-LIMIT: this workspace has reached its limit of 25 sites', 'This workspace has reached its limit of 25 sites.'],
    ['S-LIMIT: this workspace has reached its limit of 200 MB of photos and files', 'This workspace has reached its limit of 200 MB of photos and files.'],
    ['S-LIMIT: this workspace has reached its limit of 100 publishes today', 'This workspace has reached its limit of 100 publishes today.'],
  ];
  for (const [message, words] of want) {
    const r = refusal(message);
    eq(r?.status, 409, message); eq(r?.code, 'S-LIMIT', message); eq(r?.kind, 'quota', message); eq(r?.msg, words, message);
  }
  const odd = 'S-LIMIT: this workspace has reached its limit of 5 <b>x</b>';
  const r = refusal(odd);
  eq(r?.status, 409, odd); eq(r?.code, 'S-LIMIT', odd); eq(r?.msg, 'This workspace has reached a limit of its plan.', 'any other S-LIMIT text gets fixed words');
});
