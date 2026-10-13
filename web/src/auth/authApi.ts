// The owner's sign-in. One owner per server, identified by a password; the session is an httpOnly cookie.
import { http } from '../lib/http';

export interface AuthStatus { setup_needed: boolean; signed_in: boolean }

export const authApi = {
  status: async () => (await http.get<AuthStatus>('/api/auth/status')).data,
  /** First run only: sets the owner password and signs in */
  setup: async (password: string) => { await http.post('/api/auth/setup', { password }); },
  login: async (password: string) => { await http.post('/api/auth/login', { password }); },
  logout: async () => { await http.post('/api/auth/logout', {}); },
  changePassword: async (current: string, next: string) => { await http.post('/api/auth/password', { current, new: next }); },
};
