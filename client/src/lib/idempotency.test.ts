import { describe, expect, it } from 'vitest';
import { createKeyRing, newKey } from '@/lib/idempotency';

function ring() {
  let time = 0;
  let made = 0;
  return { keys: createKeyRing(() => time, () => `key-${++made}`), wait: (ms: number) => (time += ms) };
}

describe('newKey', () => {
  it('makes a different UUID each time', () => {
    const key = newKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newKey()).not.toBe(key);
  });
});

describe('createKeyRing', () => {
  it('gives every request a new key', () => {
    const { keys } = ring();
    expect(keys.keyFor('/items', '{"name":"PLA"}')).toBe('key-1');
    expect(keys.keyFor('/items', '{"name":"PLA"}')).toBe('key-2');
  });

  it('gives the same key again to a request that got no answer', () => {
    const { keys } = ring();
    const key = keys.keyFor('/items', '{"name":"PLA"}');
    keys.unanswered('/items', '{"name":"PLA"}', key);
    expect(keys.keyFor('/items', '{"name":"PLA"}')).toBe(key);
    expect(keys.keyFor('/items', '{"name":"PLA"}')).toBe(key);
  });

  it('does not share that key with a different request', () => {
    const { keys } = ring();
    keys.unanswered('/items', '{"name":"PLA"}', keys.keyFor('/items', '{"name":"PLA"}'));
    expect(keys.keyFor('/items', '{"name":"PETG"}')).toBe('key-2');
    expect(keys.keyFor('/jobs', '{"name":"PLA"}')).toBe('key-3');
  });

  it('starts afresh once an answer has arrived', () => {
    const { keys } = ring();
    const key = keys.keyFor('/items', '{}');
    keys.unanswered('/items', '{}', key);
    keys.answered('/items', '{}');
    expect(keys.keyFor('/items', '{}')).not.toBe(key);
  });

  it('forgets an unanswered request after two minutes', () => {
    const { keys, wait } = ring();
    const key = keys.keyFor('/items', '{}');
    keys.unanswered('/items', '{}', key);
    wait(110 * 1000);
    expect(keys.keyFor('/items', '{}')).toBe(key);
    wait(20 * 1000);
    expect(keys.keyFor('/items', '{}')).not.toBe(key);
  });
});
