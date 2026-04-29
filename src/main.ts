import './app.css';
import { mount } from 'svelte';
import { navigate } from 'svelte-routing';
import App from './App.svelte';
import { setSessionExpiredHandler } from './lib/auth';
import { session } from './stores/session';

setSessionExpiredHandler(() => {
  session.set({ user: null });
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    navigate('/login');
  }
});

const target = document.getElementById('app');
if (!target) throw new Error('missing #app target');

export default mount(App, { target });
