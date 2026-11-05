export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireFound<T>(value: T | undefined): T {
  if (!value) throw new AppError(404, 'No se encontró el recurso.');
  return value;
}
