/*
 * The numbers behind a sheet that is dragged with a finger and let go (components/ui/useSheetSwipe.ts):
 * where a spring is at each frame on its way back to rest, and whether a release should close the sheet.
 * Kept free of the DOM so they can be tested.
 */

/** Frames per second the spring is worked out at; the browser smooths between them. */
export const SPRING_FPS = 60;

interface SpringOptions {
  /** How quickly it pulls back, in 1/s. Higher is snappier. */
  stiffness?: number;
  /** The longest it may run, in seconds. */
  maxSeconds?: number;
}

/**
 * The offsets, one per frame, of a spring returning to 0 from `from` px while moving at `velocity` px/s
 * (positive: away from rest). It is critically damped, so it never overshoots to the far side and bounces, and
 * it starts at the speed it is given, so a sheet let go mid-movement carries on smoothly instead of stopping dead.
 * Always ends on 0.
 */
export function springFrames(from: number, velocity: number, { stiffness = 22, maxSeconds = 0.7 }: SpringOptions = {}): number[] {
  const frames: number[] = [];
  const steps = Math.ceil(maxSeconds * SPRING_FPS);
  for (let step = 0; step <= steps; step++) {
    const t = step / SPRING_FPS;
    const decay = Math.exp(-stiffness * t);
    const offset = (from + (velocity + stiffness * from) * t) * decay;
    const speed = (velocity - stiffness * (velocity + stiffness * from) * t) * decay;
    if (step > 0 && Math.abs(offset) < 0.5 && Math.abs(speed) < 10) break;
    frames.push(offset);
  }
  frames.push(0);
  return frames;
}

/** Past this much of the sheet's height, letting go closes it. */
export const DISMISS_FRACTION = 0.3;
/** A downward flick at least this fast (px/ms) closes it from anywhere. */
export const FLICK_SPEED = 0.5;

/**
 * Whether letting go at `offset` px down, moving at `velocity` px/ms (positive: downwards), should close a sheet
 * `height` px tall: dragged far enough, or flicked down. Moving back up at the moment of release always keeps it.
 */
export function shouldDismiss(offset: number, velocity: number, height: number): boolean {
  if (velocity < -0.05) return false;
  if (velocity >= FLICK_SPEED && offset > 4) return true;
  return offset > Math.min(height * DISMISS_FRACTION, 180);
}

/** Speed in px/ms over the last 100 ms of [time, position] samples, so a pause before letting go counts as a stop. */
export function releaseVelocity(samples: Array<[time: number, position: number]>, now: number): number {
  const recent = samples.filter(([time]) => now - time <= 100);
  if (recent.length < 2) return 0;
  const [firstTime, firstPosition] = recent[0];
  const [lastTime, lastPosition] = recent[recent.length - 1];
  return lastTime > firstTime ? (lastPosition - firstPosition) / (lastTime - firstTime) : 0;
}
