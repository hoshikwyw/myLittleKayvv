/**
 * What Android's back button closes.
 *
 * In a browser, back means "the previous page". In the app there is only one
 * page, so left alone the back button would leave the app — from a panel you
 * had merely made full screen, which is the opposite of what anybody pressing
 * back expects.
 *
 * So anything that opens on top of the workspace registers how to close
 * itself, and back closes the most recent one. Only when nothing is open does
 * back leave.
 *
 * Kept free of React and of Capacitor so the ordering rule — the part that has
 * to be right — can be tested on its own.
 */

type Close = () => void;

const stack: Close[] = [];

/**
 * Registers something that back should close, while it is open.
 *
 * Returns the function that removes it again, for the component to call when
 * it closes by any other route — an Escape key, a click outside, its own close
 * button. Without that, a stale entry would swallow a later press of back and
 * do nothing visible.
 */
export function registerBack(close: Close): () => void {
  // Each registration gets its own entry, so two registrations of the same
  // function are still two things, and removing one cannot remove the other.
  const entry: Close = () => close();
  stack.push(entry);

  return () => {
    const index = stack.indexOf(entry);
    if (index !== -1) stack.splice(index, 1);
  };
}

/**
 * Closes whatever was opened most recently.
 *
 * Returns false when nothing was open, which is the caller's cue to do what
 * back does at the top level of an app.
 */
export function handleBack(): boolean {
  const close = stack.pop();
  if (!close) return false;

  close();
  return true;
}

/** How many things back would currently close. For tests. */
export function backDepth(): number {
  return stack.length;
}

/** Empties the stack. For tests, which share one module between them. */
export function resetBackStack(): void {
  stack.length = 0;
}
