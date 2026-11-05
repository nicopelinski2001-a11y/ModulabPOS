import { describe, it, expect } from 'vitest';
import { createPdf } from '../src/server/lib/pdf';
const boxes = (pdf: Buffer) =>
  [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(
    (m) => ({ width: Number(m[1]), height: Number(m[2]) }),
  );
describe('PDF utilizable en la impresora configurada', () => {
  it.each([58, 80] as const)(
    'respeta %i mm y ajusta la longitud de un ticket corto',
    async (paperWidth) => {
      const pdf = await createPdf(
        'Mi Kiosco',
        ['TICKET COMERCIAL', 'NO VÁLIDO COMO FACTURA', 'Producto x 1', '$ 121,00', 'Gracias'],
        { paperWidth },
      );
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const pages = boxes(pdf);
      expect(pages).toHaveLength(1);
      expect(pages[0]!.width).toBeCloseTo((paperWidth * 72) / 25.4, 3);
      expect(pages[0]!.height).toBeLessThan(500);
    },
  );
  it('pagina tickets extensos sin cambiar el ancho térmico', async () => {
    const pdf = await createPdf(
      'Comercio',
      Array.from(
        { length: 600 },
        (_, i) =>
          `${i + 1}. Producto con descripción suficientemente larga para envolver el renglón de un ticket de 58 mm.`,
      ),
      { paperWidth: 58 },
    );
    const pages = boxes(pdf);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.width).toBeCloseTo((58 * 72) / 25.4, 3);
      expect(page.height).toBeLessThanOrEqual((1000 * 72) / 25.4 + 0.01);
    }
  });
  it('conserva A4 para reportes y arqueos', async () => {
    expect(boxes(await createPdf('Reporte', ['Ventas: $ 100']))[0]!.width).toBeCloseTo(595.28, 2);
  });
});
