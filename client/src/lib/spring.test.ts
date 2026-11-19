import { describe, expect, it } from 'vitest';
import { releaseVelocity, shouldDismiss, springFrames } from '@/lib/spring';

describe('springFrames', () => {
  it('starts where it is let go and ends at rest', () => {
    const frames = springFrames(120, 0);
    expect(frames[0]).toBe(120);
    expect(frames.at(-1)).toBe(0);
    expect(frames.length).toBeLessThanOrEqual(0.7 * 60 + 2);
  });

  it('returns without swinging past rest when let go standing still', () => {
    expect(Math.min(...springFrames(200, 0))).toBeGreaterThanOrEqual(0);
  });

  it('carries on in the direction it was moving before turning back', () => {
    const frames = springFrames(100, 600);
    expect(frames[1]).toBeGreaterThan(100);
    expect(frames.at(-1)).toBe(0);
  });

  it('heads back faster when it was already moving that way', () => {
    expect(springFrames(100, -600)[3]).toBeLessThan(springFrames(100, 0)[3]);
  });
});

describe('shouldDismiss', () => {
  it('closes once dragged past a third of the sheet, however slowly', () => {
    expect(shouldDismiss(200, 0, 600)).toBe(true);
    expect(shouldDismiss(100, 0, 600)).toBe(false);
  });

  it('closes on a quick flick down from anywhere', () => {
    expect(shouldDismiss(30, 0.9, 600)).toBe(true);
    expect(shouldDismiss(30, 0.2, 600)).toBe(false);
  });

  it('stays open when the finger was moving back up, however far down it is', () => {
    expect(shouldDismiss(400, -0.4, 600)).toBe(false);
  });

  it('does not ask for more than 180 px on a very tall sheet', () => {
    expect(shouldDismiss(190, 0, 900)).toBe(true);
  });
});

describe('releaseVelocity', () => {
  it('measures the last 100 ms', () => {
    expect(releaseVelocity([[0, 0], [950, 100], [1000, 150]], 1000)).toBe(1);
  });

  it('is zero after a pause, or with too little to go on', () => {
    expect(releaseVelocity([[0, 0], [50, 100]], 400)).toBe(0);
    expect(releaseVelocity([[990, 100]], 1000)).toBe(0);
  });
});
