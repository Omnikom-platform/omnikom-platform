import { createContext, useContext } from 'react';
import type { Contract } from './lib/site';
import type { ContentRow, Role, Site, Team } from './data';
import type { Draft } from './api';

/** What the Site screen has loaded once: the editor and the sheet read it instead of asking again. */
export type SiteValue = {
  site: Site | undefined;
  role: Role;
  teamRow: string | null;
  contract: Contract;
  rows: ContentRow[];
  drafts: Draft[];
  /** The list of waiting drafts is being asked for again: what it shows may be one save behind, so nothing is published from it yet. */
  draftsBusy: boolean;
  team: Team;
  me: { id: string; email: string | null };
  /** The name of the login that did something: the team member's name, else this login's own email, else nothing. */
  who: (userId: string | null | undefined) => string;
};
export const SiteContext = createContext<SiteValue | null>(null);

export function useSiteValue(): SiteValue {
  const v = useContext(SiteContext);
  if (!v) throw new Error('useSiteValue outside the Site screen');
  return v;
}
