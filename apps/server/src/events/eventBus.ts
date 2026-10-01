import type { ApiEvent, ApiEventType } from '@aioption/shared';

type Listener = (event: ApiEvent) => void;

const listeners = new Set<Listener>();

/** Publishes an event to all subscribers (SSE clients, internal hooks). */
export function publishEvent(type: ApiEventType, payload: unknown): ApiEvent {
  const event: ApiEvent = { type, payload, timestamp: new Date().toISOString() };
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A broken subscriber must not break the publisher.
    }
  }
  return event;
}

/** Registers a listener; returns an unsubscribe function. */
export function subscribeToEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
