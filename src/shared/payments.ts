export const paymentMethods = ['cash', 'transfer', 'debit', 'credit', 'wallet', 'account'] as const;
export const paymentNames: Record<(typeof paymentMethods)[number], string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  debit: 'Débito',
  credit: 'Crédito',
  wallet: 'Billetera virtual',
  account: 'Cuenta corriente',
};
