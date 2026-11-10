/**
 * The error screen (DP-1.2s-12, -13): shown by the router root's errorComponent when a screen fails to draw. It says one plain
 * sentence and offers Reload. The error itself is never shown (SEC-007: no stack, no message, no file path): TanStack Router passes
 * `{ error, reset, info }` and every one of them is ignored on purpose. The sentence is the h1 so the screen has a heading and the
 * base size, and it inherits the base styles (styles.spec.ts: an h1, nothing under 14 px).
 */
export function ErrorScreen() {
  return (
    <main>
      <h1 data-plan="DP-1.2s-12">Something went wrong. Reload the page to try again.</h1>
      <p>
        <button type="button" data-plan="DP-1.2s-13" onClick={() => location.reload()}>Reload</button>
      </p>
    </main>
  );
}
