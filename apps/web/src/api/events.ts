import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { ApiEvent } from '@aioption/shared';

/** Local UI events (e.g. trading stopped by the user in the Settings page). */
export type UiEvent =
  | ApiEvent
  | { type: 'trading-stopped'; payload: { reason: string } }
  | { type: 'request-withdraw'; payload: { reason: string } }
  | { type: 'request-tron-status'; payload: { reason: string } };

type UiEventListener = (event: UiEvent) => void;

const listeners = new Set<UiEventListener>();

/** Emits a local UI event (used for post-trade prompts). */
export function emitUiEvent(event: UiEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // a broken listener must not break others
    }
  }
}

/** Subscribes to local UI events; returns an unsubscribe function. */
export function subscribeUiEvents(listener: UiEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Connects to the backend SSE stream and invalidates the relevant query
 * caches on every event, so the dashboard updates in near real time.
 * TanStack Query polling remains as a fallback if SSE is unavailable.
 */
export function useApiEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/events');

    const handle = (event: MessageEvent<string>) => {
      let parsed: ApiEvent;
      try {
        parsed = JSON.parse(event.data) as ApiEvent;
      } catch {
        return;
      }
      emitUiEvent(parsed);
      switch (parsed.type) {
        case 'account':
        case 'trade':
        case 'deposit':
        case 'withdrawal':
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          void queryClient.invalidateQueries({ queryKey: ['account'] });
          break;
        case 'trade':
          void queryClient.invalidateQueries({ queryKey: ['positions'] });
          break;
        case 'decision':
          void queryClient.invalidateQueries({ queryKey: ['decisions'] });
          break;
        case 'risk':
          void queryClient.invalidateQueries({ queryKey: ['risk-events'] });
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          break;
        case 'deposit':
          void queryClient.invalidateQueries({ queryKey: ['deposits'] });
          break;
        case 'withdrawal':
          void queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
          break;
        case 'binary':
          void queryClient.invalidateQueries({ queryKey: ['binary-open'] });
          void queryClient.invalidateQueries({ queryKey: ['binary-history'] });
          void queryClient.invalidateQueries({ queryKey: ['binary-summary'] });
          void queryClient.invalidateQueries({ queryKey: ['binary-session'] });
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          break;
        case 'ai-binary':
          void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
          void queryClient.invalidateQueries({ queryKey: ['ai-decisions'] });
          void queryClient.invalidateQueries({ queryKey: ['binary-open'] });
          void queryClient.invalidateQueries({ queryKey: ['binary-history'] });
          void queryClient.invalidateQueries({ queryKey: ['binary-summary'] });
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          break;
        case 'tron':
          void queryClient.invalidateQueries({ queryKey: ['tron-status'] });
          break;
        case 'wallet':
          void queryClient.invalidateQueries({ queryKey: ['wallet-records'] });
          break;
        case 'options':
          void queryClient.invalidateQueries({ queryKey: ['positions'] });
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          void queryClient.invalidateQueries({ queryKey: ['classic-status'] });
          void queryClient.invalidateQueries({ queryKey: ['classic-history'] });
          void queryClient.invalidateQueries({ queryKey: ['classic-settings'] });
          break;
        case 'classic':
          void queryClient.invalidateQueries({ queryKey: ['classic-status'] });
          void queryClient.invalidateQueries({ queryKey: ['classic-settings'] });
          void queryClient.invalidateQueries({ queryKey: ['options-config'] });
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          break;
        case 'settings':
          void queryClient.invalidateQueries({ queryKey: ['wallet-addresses'] });
          void queryClient.invalidateQueries({ queryKey: ['deposits-info'] });
          void queryClient.invalidateQueries({ queryKey: ['tron-status'] });
          void queryClient.invalidateQueries({ queryKey: ['tron-fee-deposit-info'] });
          void queryClient.invalidateQueries({ queryKey: ['tron-fee-status'] });
          break;
      }
    };

    source.onmessage = handle;
    return () => {
      source.close();
    };
  }, [queryClient]);
}
