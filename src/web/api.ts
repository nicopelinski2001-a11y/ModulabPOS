import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { commandScope, isDurableCommand, readCommand, writeCommand } from './command-store';
let csrf = '';
export const setCsrf = (token: string) => {
  csrf = token;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const scope = commandScope();
  const mutate = !['GET', 'HEAD', 'OPTIONS'].includes(method) && !path.startsWith('/auth/');
  const durable = method === 'POST' && isDurableCommand(path, body);
  const send = async () => {
    if (scope && mutate) {
      let pending;
      try {
        pending = readCommand(scope);
      } catch {
        throw new Error(
          'Hay una operación guardada que no se pudo leer. Conservá este navegador y contactá al administrador para recuperar la clave.',
        );
      }
      if (
        pending &&
        (pending.path !== path || JSON.stringify(pending.body) !== JSON.stringify(body))
      )
        throw new Error('Recuperá la operación pendiente antes de registrar otra operación.');
      if (path !== '/sales' && localStorage.getItem(`modulab-pending:${scope}`))
        throw new Error('Recuperá la venta pendiente en Punto de venta antes de continuar.');
      if (durable) writeCommand(scope, { path, body });
    }
    try {
      const result = await request<T>(path, body, method);
      if (scope && durable) {
        if (
          !result ||
          typeof result !== 'object' ||
          !('operation_key' in result) ||
          result.operation_key !== body.idempotency_key
        )
          throw new ApiError(
            'La confirmación está incompleta. Recuperá la operación pendiente sin volver a cargarla.',
            502,
          );
        writeCommand(scope, null);
      }
      return result;
    } catch (error) {
      if (
        scope &&
        durable &&
        error instanceof ApiError &&
        [400, 404, 409, 422].includes(error.status)
      )
        writeCommand(scope, null);
      throw error;
    }
  };
  if (scope && mutate && navigator.locks)
    return navigator.locks.request(`modulab-command:${scope}`, send);
  return send();
}
async function request<T>(path: string, body: unknown, method: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'ModulabPOS',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(
      'No se pudo conectar con el servidor local. Conservamos la operación para que puedas reintentar.',
      0,
    );
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(
      'Respuesta inválida del servidor. Conservamos la operación para reintentar.',
      502,
    );
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('modulab-session-expired'));
    throw new ApiError(data.message ?? 'No se pudo completar la operación.', res.status);
  }
  return data as T;
}
export let notify: (message: string, kind?: 'success' | 'error') => void = () => {};
export function setNotify(fn: typeof notify) {
  notify = fn;
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const qc = useQueryClient();
  return {
    busy,
    run: async <T>(fn: () => Promise<T>, message?: string): Promise<T | undefined> => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      try {
        const data = await fn();
        await qc.invalidateQueries();
        if (message) notify(message);
        return data;
      } catch (e) {
        await qc.invalidateQueries();
        notify(e instanceof Error ? e.message : 'No se pudo completar la operación.', 'error');
        return undefined;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
  };
}

export async function downloadFile(path: string, filename: string) {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new ApiError(
      'No se pudo descargar. Revisá la conexión al servidor e intentá de nuevo.',
      0,
    );
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('modulab-session-expired'));
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.message ?? 'No se pudo descargar el archivo.', response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
