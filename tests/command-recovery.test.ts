import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/web/api';
import { readCommand, setCommandUser, commandStorageKey } from '../src/web/command-store';
import type { User } from '../src/shared/domain';
const id = '12345678-1234-4123-8123-123456789012';
const scope = `${id}:${id}`;
const body = {
  shift_id: id,
  kind: 'in',
  amount_cents: 1000,
  reason: 'Fondo adicional',
  idempotency_key: id,
};
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {});
  setCommandUser({ tenant_id: id, user_id: id } as User);
});
afterEach(() => {
  setCommandUser();
  vi.unstubAllGlobals();
});
describe('Intenciones durables de caja e inventario', () => {
  it('persiste antes de enviar y recupera con la misma clave tras perder la respuesta', async () => {
    const transport = vi
      .fn()
      .mockImplementationOnce(() => {
        expect(readCommand(scope)?.body).toEqual(body);
        throw new TypeError('Respuesta perdida');
      })
      .mockResolvedValueOnce(Response.json({ ok: true, operation_key: id }));
    vi.stubGlobal('fetch', transport);
    await expect(api('/cash/movement', body)).rejects.toMatchObject({ status: 0 });
    expect(readCommand(scope)?.body).toEqual(body);
    await api('/cash/movement', body);
    expect(readCommand(scope)).toBeNull();
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual(body);
  });
  it('un éxito incompleto bloquea otra operación y conserva la intención original', async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', transport);
    await expect(api('/cash/movement', body)).rejects.toMatchObject({ status: 502 });
    await expect(api('/cash/movement', { ...body, amount_cents: 2000 })).rejects.toThrow(
      'pendiente',
    );
    await expect(api('/sales', {})).rejects.toThrow('pendiente');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(readCommand(scope)?.body).toEqual(body);
  });
  it('un rechazo explícito libera la intención y un archivo corrupto detiene el envío', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(Response.json({ message: 'Caja cerrada' }, { status: 409 }));
    vi.stubGlobal('fetch', transport);
    await expect(api('/cash/movement', body)).rejects.toMatchObject({ status: 409 });
    expect(readCommand(scope)).toBeNull();
    values.set(commandStorageKey(scope), '{corrupt');
    await expect(api('/cash/movement', body)).rejects.toThrow('no se pudo leer');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('si no puede persistir en disco no envía el movimiento', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('Disco lleno');
      },
    });
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    await expect(api('/cash/movement', body)).rejects.toThrow('Disco lleno');
    expect(transport).not.toHaveBeenCalled();
  });
});
