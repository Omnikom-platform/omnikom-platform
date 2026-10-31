import { createContext, useContext } from 'react';
import type { Workspace } from './data';

/** What the shell knows once it has found the workspace in the address: the pages below read it, they never look it up again. */
export type WorkspaceValue = { workspace: Workspace; userId: string };
export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspaceValue(): WorkspaceValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error('useWorkspaceValue outside the shell');
  return v;
}
