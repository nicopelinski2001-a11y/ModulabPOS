import { afterEach, describe, it, expect, vi } from 'vitest';
import { api, ApiError, setCsrf } from '../src/web/api';
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrf('');
});
describe('Recuperación de errores de transporte', () => {
  it('una respuesta HTML 200 no puede confirmar una operación financiera', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Error del proxy</html>', { status: 200 })),
    );
    await expect(api('/sales', { idempotency_key: 'same-intent' })).rejects.toMatchObject({
      status: 502,
    });
  });
  it('una desconexión conserva un resultado ambiguo recuperable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
    await expect(api('/sales', { idempotency_key: 'same-intent' })).rejects.toMatchObject({
      status: 0,
    });
  });
  it('un rechazo explícito del servidor conserva su estado y explicación', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message: 'Stock insuficiente.' }, { status: 409 })),
    );
    await expect(api('/sales', {})).rejects.toMatchObject({
      status: 409,
      message: 'Stock insuficiente.',
    });
  });
});
