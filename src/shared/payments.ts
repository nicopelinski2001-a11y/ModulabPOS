export const paymentMethods = ['cash', 'transfer', 'debit', 'credit', 'wallet', 'account'] as const;
export const paymentNames: Record<(typeof paymentMethods)[number], string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  debit: 'Débito',
  credit: 'Crédito',
  wallet: 'QR / billetera virtual',
  account: 'Cuenta corriente',
};
