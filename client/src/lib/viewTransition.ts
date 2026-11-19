import { flushSync } from 'react-dom';

/*
 * Short cross-fades when the content of the screen is swapped: going to another page, switching a tab.
 * Where the browser cannot do it, or the user has asked for less motion, the change simply happens.
 * What fades, and for how long, is set in styles/global.css.
 */

const canAnimate = () =>
  typeof document !== 'undefined' && 'startViewTransition' in document && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Cross-fade a change that React can draw straight away, such as switching a tab. */
export function withViewTransition(update: () => void): void {
  if (!canAnimate()) return update();
  document.startViewTransition(() => flushSync(update));
}

let pageDrawn: (() => void) | null = null;

/** The shell calls this once a navigation has been drawn (see AppShell). */
export function pageArrived(): void {
  pageDrawn?.();
  pageDrawn = null;
}

/**
 * Cross-fade to another page. The router draws a navigation in its own time, so the fade waits for the shell
 * to say the new page is there, and never longer than a moment.
 */
export function navigateWithTransition(go: () => void): void {
  if (!canAnimate()) return go();
  document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        pageDrawn = resolve;
        window.setTimeout(resolve, 150);
        go();
      }),
  );
}
