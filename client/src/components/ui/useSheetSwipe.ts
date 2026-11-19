import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { releaseVelocity, shouldDismiss, SPRING_FPS, springFrames } from '@/lib/spring';

/** Where dialogs are bottom sheets. Keep in step with the phone rules in Modal.module.css. */
const SHEET = '(max-width: 40rem)';
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface Gesture {
  pointerId: number;
  startY: number;
  /** How far down the sheet already was when the finger landed (it may have been caught on its way back). */
  base: number;
  offset: number;
  height: number;
  samples: Array<[number, number]>;
  sheet: Animation;
  shade: Animation | null;
}

/** The backdrop is a pseudo-element; not every browser can animate one from script. Without it, it just stays. */
function animateShade(dialog: HTMLDialogElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  try {
    return dialog.animate(keyframes, { ...options, pseudoElement: '::backdrop' });
  } catch {
    return null;
  }
}

const down = (px: number): Keyframe => ({ transform: `translateY(${px}px)` });

/**
 * Lets a bottom sheet be dragged down by its top bar: it follows the finger, closes when dragged far enough or
 * flicked, and otherwise springs back from wherever it is, at the speed it was let go. Nothing here waits for an
 * animation: a sheet on its way back (or out) can be caught again, and carries on from where it was caught.
 *
 * Positions come from the Web Animations API, not from style attributes: one paused animation runs from "in
 * place" to "off the bottom", one millisecond per pixel, and dragging moves its clock.
 *
 * Spread the returned handlers on the bar. The Close button stays the way out for anyone not using touch.
 */
export function useSheetSwipe(dialogRef: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const gesture = useRef<Gesture | null>(null);
  const settling = useRef<Animation[]>([]);
  const close = useRef(onClose);
  close.current = onClose;

  const stopSettling = () => {
    for (const animation of settling.current) {
      animation.onfinish = null;
      animation.cancel();
    }
    settling.current = [];
  };
  useEffect(() => stopSettling, []);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const dialog = dialogRef.current;
    if (!dialog?.animate || !window.matchMedia(SHEET).matches) return;
    if (gesture.current || event.button !== 0 || (event.target as Element).closest('button, a, input, select, textarea')) return;
    // Caught mid-flight: carry on from where it is on screen right now.
    const base = Math.max(0, new DOMMatrixReadOnly(getComputedStyle(dialog).transform).m42);
    stopSettling();
    const height = dialog.offsetHeight;
    const scrub: KeyframeAnimationOptions = { duration: height, fill: 'both', easing: 'linear' };
    const sheet = dialog.animate([down(0), down(height)], scrub);
    const shade = animateShade(dialog, [{ opacity: 1 }, { opacity: 0 }], scrub);
    for (const animation of [sheet, shade]) {
      animation?.pause();
      if (animation) animation.currentTime = base;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, startY: event.clientY, base, offset: base, height, samples: [[event.timeStamp, event.clientY]], sheet, shade };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    // Upwards there is nowhere to go: the sheet stops where it rests.
    drag.offset = Math.min(drag.height, Math.max(0, drag.base + event.clientY - drag.startY));
    drag.sheet.currentTime = drag.offset;
    if (drag.shade) drag.shade.currentTime = drag.offset;
    drag.samples.push([event.timeStamp, event.clientY]);
    if (drag.samples.length > 8) drag.samples.shift();
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    const dialog = dialogRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    gesture.current = null;
    const { offset, height } = drag;
    const velocity = event.type === 'pointercancel' ? 0 : releaseVelocity(drag.samples, event.timeStamp);
    // The scrubbed animations go and the settling ones start in the same breath, so no frame shows the gap.
    drag.sheet.cancel();
    drag.shade?.cancel();
    if (!dialog) return;
    const closing = event.type !== 'pointercancel' && shouldDismiss(offset, velocity, height);
    const finish = () => {
      // Tells Modal the sheet has already left, so it does not fade a copy out from where the sheet used to be.
      dialog.dataset.swiped = 'true';
      close.current();
    };

    if (prefersReducedMotion()) {
      if (closing) finish();
      return;
    }

    if (closing) {
      // Carries on down at about the speed of the flick, within sensible limits.
      const duration = Math.min(260, Math.max(110, (height - offset) / Math.max(velocity, 1.2)));
      const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'forwards' };
      const sheet = dialog.animate([down(offset), down(height)], options);
      const shade = animateShade(dialog, [{ opacity: 1 - offset / height }, { opacity: 0 }], options);
      settling.current = shade ? [sheet, shade] : [sheet];
      sheet.onfinish = finish;
      return;
    }

    if (offset <= 0) return;
    const frames = springFrames(offset, velocity * 1000);
    const options: KeyframeAnimationOptions = { duration: (frames.length - 1) * (1000 / SPRING_FPS), easing: 'linear' };
    const sheet = dialog.animate(frames.map((at) => down(Math.min(height, Math.max(0, at)))), options);
    const shade = animateShade(dialog, [{ opacity: 1 - offset / height }, { opacity: 1 }], options);
    settling.current = shade ? [sheet, shade] : [sheet];
    sheet.onfinish = () => {
      settling.current = [];
    };
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}
