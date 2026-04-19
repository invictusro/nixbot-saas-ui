import { writable } from 'svelte/store';
import type { User } from '../lib/auth';

export interface SessionState {
  user: User | null;
}

export const session = writable<SessionState>({ user: null });
