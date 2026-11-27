// Watched-red mutant of the Undo cases (book row A4, status-undo.spec.ts), kept out of tests/mutants.ts (its Mutant union is the flows
// slice's line). FLOWS_MUTANT=<name> breaks one write from the test side; with no FLOWS_MUTANT nothing here runs.
//   undo-dropped   the page's second change through lead-update (each case makes one change, then its Undo) is answered 204 and never
//                  reaches the function: the screen believes it, the database keeps the changed value, all four cases go red
import type { Page } from '@playwright/test';

export type StatusUndoMutant = 'undo-dropped';

/** A POST that changes the status or the owner; opening a lead also posts to lead-update (read), which is not counted. */
function isChange(body: string | null): boolean {
  const data = JSON.parse(body ?? '{}') as Record<string, unknown>;
  return 'status' in data || 'owner' in data || 'unassign' in data;
}

export async function installStatusUndoMutant(page: Page) {
  const name: StatusUndoMutant = 'undo-dropped';
  if (process.env.FLOWS_MUTANT !== name) return;
  let changes = 0;
  await page.route(/\/functions\/v1\/lead-update$/, route => {
    const request = route.request();
    if (request.method() !== 'POST' || !isChange(request.postData())) return route.fallback();
    changes += 1;
    if (changes !== 2) return route.fallback();
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  });
}
