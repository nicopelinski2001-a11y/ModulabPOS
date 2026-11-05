import { useSyncExternalStore } from 'react';
import { commandScope, commandSnapshot, readCommand, writeCommand } from '../command-store';
import { api, useAction } from '../api';
import { Button } from './ui';

function subscribe(fn: () => void) {
  window.addEventListener('storage', fn);
  window.addEventListener('modulab-command-changed', fn);
  return () => {
    window.removeEventListener('storage', fn);
    window.removeEventListener('modulab-command-changed', fn);
  };
}
function snapshot() {
  try {
    return commandSnapshot();
  } catch {
    return 'unavailable';
  }
}
export function CommandRecovery() {
  const pending = useSyncExternalStore(subscribe, snapshot);
  const action = useAction();
  if (!pending) return null;
  return (
    <div className="info-banner" role="status">
      <div>
        <strong>Hay una operación pendiente de recuperar.</strong>
        <p>
          Se guardaron sus datos antes del envío. Recuperala para comprobar el resultado sin
          duplicarla.
        </p>
      </div>
      <Button
        busy={action.busy}
        onClick={() =>
          void action.run(async () => {
            const scope = commandScope();
            const command = readCommand(scope);
            if (!command) return;
            const key = command.body.idempotency_key;
            const found = await api<{ operation_key: string } | null>(`/commands/${key}`);
            if (found?.operation_key === key) writeCommand(scope, null);
            else if (found === null) await api(command.path, command.body);
            else
              throw new Error(
                'No se pudo validar la confirmación. Conservamos la operación guardada.',
              );
          }, 'Operación recuperada. Los saldos fueron actualizados.')
        }
      >
        Recuperar operación
      </Button>
    </div>
  );
}
