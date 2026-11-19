import { describe, expect, it, vi } from 'vitest';
import { SerialSaver } from '@/lib/serialSave';

/** A send whose requests the test answers by hand, in any order. */
function manualSend() {
  const calls: Array<{ value: number; resolve: (reply: string) => void; reject: (error: Error) => void }> = [];
  const send = (value: number) => new Promise<string>((resolve, reject) => calls.push({ value, resolve, reject }));
  return { calls, send };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const handlers = () => ({ onSaved: vi.fn(), onFailed: vi.fn() });

describe('SerialSaver', () => {
  it('sends one save at a time, and only the newest of the changes made meanwhile', async () => {
    const { calls, send } = manualSend();
    const saver = new SerialSaver(send);
    const last = handlers();
    saver.save(1, handlers());
    saver.save(2, handlers());
    saver.save(3, last);
    expect(saver.busy).toBe(true);
    expect(calls.map((c) => c.value)).toEqual([1]);

    calls[0].resolve('saved 1');
    await settle();
    expect(calls.map((c) => c.value)).toEqual([1, 3]);
    expect(last.onSaved).not.toHaveBeenCalled();

    calls[1].resolve('saved 3');
    await settle();
    expect(last.onSaved).toHaveBeenCalledWith('saved 3');
    expect(saver.busy).toBe(false);
  });

  it('does not undo a newer change when an older save fails', async () => {
    const { calls, send } = manualSend();
    const saver = new SerialSaver(send);
    const first = handlers();
    const second = handlers();
    saver.save(1, first);
    saver.save(2, second);
    calls[0].reject(new Error('offline'));
    await settle();
    expect(first.onFailed).not.toHaveBeenCalled();
    calls[1].resolve('saved 2');
    await settle();
    expect(second.onSaved).toHaveBeenCalledWith('saved 2');
    expect(second.onFailed).not.toHaveBeenCalled();
  });

  it('reports the newest reply the server confirmed when the last save fails', async () => {
    const { calls, send } = manualSend();
    const saver = new SerialSaver(send);
    const last = handlers();
    saver.save(1, handlers());
    saver.save(2, last);
    calls[0].resolve('saved 1');
    await settle();
    const error = new Error('offline');
    calls[1].reject(error);
    await settle();
    expect(last.onFailed).toHaveBeenCalledWith(error, 'saved 1');

    // A new burst starts with nothing confirmed.
    const alone = handlers();
    saver.save(4, alone);
    calls[2].reject(error);
    await settle();
    expect(alone.onFailed).toHaveBeenCalledWith(error, undefined);
  });
});
