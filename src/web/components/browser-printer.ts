import type { PrintAdapter } from '../../shared/printing';
export const browserPrinter: PrintAdapter = {
  id: 'browser',
  silent: false,
  async print({ paperWidth }) {
    document.documentElement.dataset.paper = String(paperWidth);
    try {
      window.print();
    } finally {
      delete document.documentElement.dataset.paper;
    }
  },
};
