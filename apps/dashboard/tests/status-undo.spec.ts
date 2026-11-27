// Book row A4: Undo after a status change and after an owner change, pressed in the real dashboard (staging).
// Each case is exactly one change and then its Undo; the database is read back as the service role, and the status
// labels and the person's name are read at run time. Every lead is made here and removed in the one afterAll.
// FLOWS_MUTANT=undo-dropped answers the Undo's call without sending it (status-undo-mutants.ts): all four go red.
import { expect, test, type Page } from '@playwright/test';
import { installStatusUndoMutant } from './status-undo-mutants';
import { makeOwnLead, removeOwnLeads } from './support/own-lead';
import { callAs, PEOPLE, personAccessToken, serviceGet, WS } from './support/staging';

type Row = { id: string; status: string; status_date: string | null; owner_team_row: string | null };

async function readLead(name: string): Promise<Row> {
  const rows = await serviceGet<Row[]>(`/leads?workspace_id=eq.${WS.a.id}&name=eq.${encodeURIComponent(name)}&select=id,status,status_date,owner_team_row`);
  expect(rows.length, `one lead named ${name}`).toBe(1);
  return rows[0]!;
}

const statusEvents = async (leadId: string) => (await serviceGet<{ id: number }[]>(`/lead_events?lead_id=eq.${leadId}&kind=eq.status&select=id`)).length;

/** The business's status labels as lead-list answers them, by key. */
async function statusLabels() {
  const r = await callAs(await personAccessToken('owner-a'), 'lead-list', { workspace: WS.a.id, size: 1 });
  expect(r.status, `lead-list answered ${r.status}: ${r.text.slice(0, 120)}`).toBe(200);
  const list = (r.json as { statuses?: { key: string; label: string }[] }).statuses ?? [];
  return (key: string) => {
    const found = list.find(x => x.key === key);
    expect(found, `the test site's status list has ${key}`).toBeTruthy();
    return found!.label;
  };
}

/** The team row of the seeded member-a1 and the name the screen shows for it. */
async function agent() {
  const members = await serviceGet<{ user_id: string; team_row_id: string | null }[]>(`/members?workspace_id=eq.${WS.a.id}&select=user_id,team_row_id`);
  const row = members.find(m => m.user_id === PEOPLE['member-a1'].id)?.team_row_id ?? '';
  expect(row, 'the seeded member has a team row (omnikom seed test)').toBeTruthy();
  const [newest] = await serviceGet<{ data: { name?: string } }[]>(`/content_versions?row_id=eq.${row}&select=data&order=n.desc&limit=1`);
  const name = newest?.data.name ?? '';
  expect(name, 'the team row has a name').toBeTruthy();
  return { row, name };
}

/** Set-up as owner-a through lead-update, before the screen is opened. */
async function setUp(change: Record<string, unknown>) {
  const r = await callAs(await personAccessToken('owner-a'), 'lead-update', change);
  expect(r.status, `lead-update answered ${r.status}: ${r.text.slice(0, 160)}`).toBe(204);
}

/** The lead opened from the list; every control is then scoped to its panel. */
async function openLead(page: Page, name: string) {
  await page.goto(`/w/${WS.a.slug}/leads`);
  await expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
  await page.getByRole('radio', { name: /^All\b/ }).check();
  await page.getByRole('searchbox', { name: 'Search' }).fill(name);
  await page.getByRole('link', { name, exact: true }).click();
  const panel = page.getByRole('region', { name });
  await expect(panel).toBeVisible();
  return panel;
}

/** Undo in the toast that says `words`. Pressed at once: the toast lasts 4 s (src/toast.tsx). */
async function pressUndo(page: Page, words: string) {
  await page.getByRole('status').filter({ hasText: words }).getByRole('button', { name: 'Undo', exact: true }).click();
}

test.describe('A4 status and owner Undo as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json' });
  test.setTimeout(180_000);

  test('A4 Undo puts a status back', async ({ page }) => {
    await installStatusUndoMutant(page);
    const label = await statusLabels();
    const { name } = await makeOwnLead('a4', 'status');
    const before = await readLead(name);
    expect(before.status).toBe('not-contacted');
    const panel = await openLead(page, name);
    const pick = panel.getByLabel('Status', { exact: true });

    await pick.selectOption({ label: label('qualified') });
    await pressUndo(page, `Marked ${label('qualified')}.`);

    await expect.poll(async () => (await readLead(name)).status, { message: 'Undo put the old status back' }).toBe('not-contacted');
    await expect(pick).toHaveValue('not-contacted');
    expect(await statusEvents(before.id), 'the change happened and was reverted').toBe(2);
  });

  test('A4 Undo brings back the date', async ({ page }) => {
    await installStatusUndoMutant(page);
    const label = await statusLabels();
    const { name } = await makeOwnLead('a4', 'date');
    const { id } = await readLead(name);
    await setUp({ lead: id, status: 'call-back', status_date: '2026-12-04' });
    const panel = await openLead(page, name);
    const pick = panel.getByLabel('Status', { exact: true });
    await expect(pick).toHaveValue('call-back');

    await pick.selectOption({ label: label('qualified') });
    await pressUndo(page, `Marked ${label('qualified')}.`);

    await expect.poll(async () => { const l = await readLead(name); return `${l.status}|${l.status_date}`; }, { message: 'Undo put the old status and its date back' }).toBe('call-back|2026-12-04');
    await expect(pick).toHaveValue('call-back');
    expect(await statusEvents(id), 'set-up, the change and the Undo').toBe(3);
  });

  test('A4 Undo takes an owner off', async ({ page }) => {
    await installStatusUndoMutant(page);
    const person = await agent();
    const { name } = await makeOwnLead('a4', 'give');
    expect((await readLead(name)).owner_team_row).toBeNull();
    const panel = await openLead(page, name);
    const pick = panel.getByLabel('Owner', { exact: true });

    await pick.selectOption(person.row);
    await pressUndo(page, `Given to ${person.name}.`);

    await expect.poll(async () => (await readLead(name)).owner_team_row, { message: 'Undo left the lead with no owner again' }).toBeNull();
    await expect(pick).toHaveValue('');
  });

  test('A4 Undo gives the owner back', async ({ page }) => {
    await installStatusUndoMutant(page);
    const person = await agent();
    const { name } = await makeOwnLead('a4', 'remove');
    const { id } = await readLead(name);
    await setUp({ lead: id, owner: person.row });
    const panel = await openLead(page, name);
    const pick = panel.getByLabel('Owner', { exact: true });
    await expect(pick).toHaveValue(person.row);

    await pick.selectOption('');
    await pressUndo(page, 'Owner removed.');

    await expect.poll(async () => (await readLead(name)).owner_team_row, { message: 'Undo gave the owner back' }).toBe(person.row);
    await expect(pick).toHaveValue(person.row);
  });
});

test.afterAll(async () => { await removeOwnLeads('a4'); });
