import { authApi } from '../authApi';
import { useAuth } from '../authStore';

const reset = () => useAuth.setState({ screen: 'checking', notice: null });

describe('auth store', () => {
  beforeEach(reset);
  afterEach(() => jest.restoreAllMocks());

  it('goes to first run, then into the tracker once the password is set', async () => {
    jest.spyOn(authApi, 'status').mockResolvedValue({ setup_needed: true, signed_in: false });
    const setup = jest.spyOn(authApi, 'setup').mockResolvedValue();
    expect(await useAuth.getState().check()).toBe('setup');
    expect(await useAuth.getState().setup('a long password')).toBeNull();
    expect(setup).toHaveBeenCalledWith('a long password');
    expect(useAuth.getState().screen).toBe('app');
  });

  it('a wrong password stays on sign-in with a reason', async () => {
    useAuth.setState({ screen: 'signIn' });
    jest.spyOn(authApi, 'login').mockRejectedValue(Object.assign(new Error('no'), { isAxiosError: true, response: { status: 401, data: {} } }));
    expect(await useAuth.getState().signIn('nope')).toBe('That password isn’t right.');
    expect(useAuth.getState().screen).toBe('signIn');
  });

  it('a lost session returns to sign-in with a notice; a quiet check keeps the tracker while the server is down', async () => {
    useAuth.setState({ screen: 'app' });
    jest.spyOn(authApi, 'status').mockRejectedValue(new Error('offline'));
    expect(await useAuth.getState().check(true)).toBe('unreachable');
    expect(useAuth.getState().screen).toBe('app');
    useAuth.getState().lost();
    expect(useAuth.getState().screen).toBe('signIn');
    expect(useAuth.getState().notice).toMatch(/session ended/);
  });

  it('signing out leaves the tracker even when the server doesn’t answer', async () => {
    useAuth.setState({ screen: 'app' });
    jest.spyOn(authApi, 'logout').mockRejectedValue(new Error('offline'));
    await useAuth.getState().signOut();
    expect(useAuth.getState().screen).toBe('signIn');
  });
});
