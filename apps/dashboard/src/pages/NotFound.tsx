import { Link } from '@tanstack/react-router';

/** "Not found" (DP-1.2s-06): a thing this login cannot read looks exactly like one that does not exist. The way out is DP-1.2s-11. */
export function NotFound() {
  return (
    <>
      <p data-plan="DP-1.2s-06">Not found</p>
      <p><Link to="/w" data-plan="DP-1.2s-11">Go to your businesses</Link></p>
    </>
  );
}
