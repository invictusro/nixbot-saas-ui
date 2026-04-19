import { describe, it, expect, beforeEach } from 'vitest';
import {
  accountsStore,
  applyRealtimeEvent,
  resetStoresForTest,
} from './stores';

describe('applyRealtimeEvent - account_state_changed', () => {
  beforeEach(() => {
    resetStoresForTest();
  });

  it('creates a new account entry with status', () => {
    applyRealtimeEvent(
      'account_state_changed',
      JSON.stringify({ customer_id: 'c1', account_id: 'a1', status: 'active' }),
    );
    expect(accountsStore.get()).toEqual({ a1: { id: 'a1', status: 'active' } });
  });

  it('merges status updates with existing username/last_action_at', () => {
    accountsStore.set({
      a1: {
        id: 'a1',
        username: 'acme',
        status: 'active',
        last_action_at: '2026-04-18T10:00:00Z',
      },
    });
    applyRealtimeEvent(
      'account_state_changed',
      JSON.stringify({ customer_id: 'c1', account_id: 'a1', status: 'paused' }),
    );
    expect(accountsStore.get()).toEqual({
      a1: {
        id: 'a1',
        username: 'acme',
        status: 'paused',
        last_action_at: '2026-04-18T10:00:00Z',
      },
    });
  });

  it('applies username and last_action_at from payload when provided', () => {
    applyRealtimeEvent(
      'account_state_changed',
      JSON.stringify({
        customer_id: 'c1',
        account_id: 'a1',
        status: 'warming',
        username: 'beta',
        last_action_at: '2026-04-19T12:00:00Z',
      }),
    );
    expect(accountsStore.get().a1).toEqual({
      id: 'a1',
      username: 'beta',
      status: 'warming',
      last_action_at: '2026-04-19T12:00:00Z',
    });
  });
});
