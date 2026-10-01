import type { ApiEvent } from '@aioption/shared';
import { describe, expect, it, vi } from 'vitest';

import { publishEvent, subscribeToEvents } from '../src/events/eventBus.js';

describe('eventBus', () => {
  it('delivers published events to subscribers with type, payload and timestamp', () => {
    const received: ApiEvent[] = [];
    const unsubscribe = subscribeToEvents((event) => received.push(event));

    publishEvent('account', { cashBalance: 42 });

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('account');
    expect(received[0]?.payload).toEqual({ cashBalance: 42 });
    expect(received[0]?.timestamp).toBeTruthy();
    unsubscribe();
  });

  it('stops delivery after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToEvents(listener);
    unsubscribe();
    publishEvent('trade', { action: 'OPENED' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing subscriber does not break other subscribers', () => {
    const healthy = vi.fn();
    subscribeToEvents(() => {
      throw new Error('broken');
    });
    subscribeToEvents(healthy);

    publishEvent('risk', { id: 1 });
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});
