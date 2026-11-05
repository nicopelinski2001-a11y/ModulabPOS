import { api, ApiError } from './api';
import { parseSaleConfirmation } from '../shared/receipt';
import type { SaleInput } from '../shared/domain';

export async function confirmSale(intent: SaleInput, userId: string) {
  const result = await api<unknown>('/sales', intent);
  try {
    return parseSaleConfirmation(result, intent, userId);
  } catch {
    throw new ApiError(
      'No pudimos validar la confirmación del servidor. Conservamos la operación: reintentá para recuperarla sin duplicar el cobro.',
      502,
    );
  }
}
