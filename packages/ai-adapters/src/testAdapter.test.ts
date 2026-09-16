import { describe, expect, it } from 'vitest';
import { TestProviderAdapter } from './testAdapter';

describe('TestProviderAdapter', () => {
  it('returns queued responses in order, then a stable fallback', async () => {
    const adapter = new TestProviderAdapter(['first', 'second']);

    const a = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const b = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const c = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(a.text).toBe('first');
    expect(b.text).toBe('second');
    expect(c.text).toBe('[test response]');
  });

  it('records every call for a service test to assert against', async () => {
    const adapter = new TestProviderAdapter();
    await adapter.complete({ system: 'sys', messages: [{ role: 'user', content: 'prompt one' }] });
    await adapter.complete({ messages: [{ role: 'user', content: 'prompt two' }] });

    const calls = adapter.getCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].system).toBe('sys');
    expect(calls[1].messages[0].content).toBe('prompt two');
  });
});
