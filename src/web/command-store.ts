import { z } from 'zod';
import type { User } from '../shared/domain';

const commandPath = z
  .string()
  .regex(
    /^\/(cash\/(open|movement)|inventory\/adjust|products\/prices|(customers|purchases)\/[a-f0-9-]{36}\/payments)$/,
  );
const storedCommand = z.object({
  path: commandPath,
  body: z.record(z.string(), z.unknown()).and(z.object({ idempotency_key: z.uuid() })),
});
export type PendingCommand = z.infer<typeof storedCommand>;
let scope = '';
export function setCommandUser(user?: User) {
  scope = user ? `${user.tenant_id}:${user.user_id}` : '';
}
export const commandScope = () => scope;
export const commandStorageKey = (value: string) => `modulab-command:${value}`;
export const commandSnapshot = () =>
  scope ? localStorage.getItem(commandStorageKey(scope)) : null;
export function readCommand(value: string): PendingCommand | null {
  const raw = localStorage.getItem(commandStorageKey(value));
  if (!raw) return null;
  // Corruption must block a new financial command, never silently lose its key.
  return storedCommand.parse(JSON.parse(raw));
}
export function writeCommand(value: string, command: PendingCommand | null) {
  const key = commandStorageKey(value);
  if (command) localStorage.setItem(key, JSON.stringify(command));
  else localStorage.removeItem(key);
  window.dispatchEvent(new Event('modulab-command-changed'));
}
export function isDurableCommand(path: string, body: unknown): body is PendingCommand['body'] {
  return (
    commandPath.safeParse(path).success &&
    z.object({ idempotency_key: z.uuid() }).safeParse(body).success
  );
}
