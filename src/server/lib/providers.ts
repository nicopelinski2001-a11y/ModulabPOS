import { config } from './config.js';
import type { SaleInput } from '../../shared/domain.js';

export interface PaymentRecorder {
  readonly id: string;
  /** Register a receipt supplied by the operator; this never charges a card. */
  record(payments: SaleInput['payments']): {
    payments: SaleInput['payments'];
    externallyVerified: false;
  };
}
export interface FiscalProvider {
  readonly id: string;
  issue(): { kind: 'commercial'; fiscal: false; authorizationCode: null };
}
export const paymentRecorder: PaymentRecorder = {
  id: config.PAYMENT_PROVIDER,
  record: (payments) => ({ payments, externallyVerified: false }),
};
export const fiscalProvider: FiscalProvider = {
  id: config.FISCAL_PROVIDER,
  issue: () => ({ kind: 'commercial', fiscal: false, authorizationCode: null }),
};
