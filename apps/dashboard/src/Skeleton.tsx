import css from './Skeleton.module.css';

/** The loading state of every screen and list (DP-1.2s-10): grey rows where the content will be. The word "Loading" stays in the markup for screen readers, out of sight. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div data-plan="DP-1.2s-10" className={css.skeleton}>
      <span className={css.hidden}>Loading</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} data-skeleton-row="" aria-hidden="true" className={css.row} />)}
    </div>
  );
}
