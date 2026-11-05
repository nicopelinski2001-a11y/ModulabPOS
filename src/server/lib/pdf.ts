import PDFDocument from 'pdfkit';

const clean = (value: string) =>
  value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ').replaceAll('−', '-');
type PdfOptions = { paperWidth?: 58 | 80 };
const points = (millimeters: number) => (millimeters * 72) / 25.4;

/** Bounded exports are completed before responding. Roll receipts use their
 * actual paper width and measured height; long tickets paginate at one metre. */
export async function createPdf(title: string, rows: readonly string[], options: PdfOptions = {}) {
  const thermal = options.paperWidth !== undefined;
  const width = thermal ? points(options.paperWidth!) : 595.28;
  const margin = thermal ? points(3) : 40;
  const bodySize = thermal ? 8 : 10;
  const titleSize = thermal ? 12 : 17;
  const lineWidth = width - margin * 2;
  let height = 841.89;
  if (thermal) {
    const measure = new PDFDocument({ size: [width, points(1000)], margin });
    try {
      measure.fontSize(titleSize);
      height = margin * 2 + measure.heightOfString(clean(title), { width: lineWidth }) + titleSize;
      measure.fontSize(bodySize);
      for (const row of rows)
        height += measure.heightOfString(clean(row), { width: lineWidth }) + bodySize * 0.35;
      height = Math.min(points(1000), Math.max(points(40), Math.ceil(height + bodySize * 2)));
    } finally {
      measure.destroy();
    }
  }
  const doc = new PDFDocument({
    size: [width, height],
    margin,
    info: { Title: clean(title), Author: 'Modulab POS' },
  });
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      doc
        .fontSize(titleSize)
        .text(clean(title), { width: lineWidth, align: thermal ? 'center' : 'left' })
        .moveDown();
      doc.fontSize(bodySize);
      for (const row of rows) doc.text(clean(row), { width: lineWidth }).moveDown(0.35);
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
