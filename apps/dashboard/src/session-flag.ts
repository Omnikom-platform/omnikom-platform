// Did the person press Sign out (DP-1.2-09), or did the session end by itself (DP-1.2-13: expired, or signed out elsewhere)?
let byPerson = false;
export const markSignOutByPerson = () => { byPerson = true; };
/** Read once: true if the last sign-out was the person's own; resets for the next one. */
export function takeSignOutByPerson(): boolean { const v = byPerson; byPerson = false; return v; }
