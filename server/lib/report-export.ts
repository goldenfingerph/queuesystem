import { Buffer } from 'node:buffer';

type Cell = string | number | null | undefined;

function xml(value: string): string {
  // XML 1.0 forbids these control characters; keep this targeted sanitization regex.
  // eslint-disable-next-line no-control-regex
  const validXmlText = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return validXmlText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; content: string }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.content, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + data.length;
  }
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralData, end]);
}

function columnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function createReportXlsx(headers: string[], rows: Cell[][], title: string, subtitle: string): Buffer {
  const allRows: Cell[][] = [[title], [subtitle], [], headers, ...rows];
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      if (value === null || value === undefined || value === '') return `<c r="${ref}"/>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="${headers.length}" width="22" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A4:${columnName(Math.max(headers.length - 1, 0))}${allRows.length}"/></worksheet>`;
  return zipStore([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Queue Report" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${sheet}` },
  ]);
}

function pdfText(value: string): string {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function createReportPdf(headers: string[], rows: Cell[][], title: string, subtitle: string): Buffer {
  const pageRows = 22;
  const columnsPerPage = 5;
  const rowChunks = rows.length
    ? Array.from({ length: Math.ceil(rows.length / pageRows) }, (_, index) => rows.slice(index * pageRows, (index + 1) * pageRows))
    : [[]];
  const panels = Math.max(1, Math.ceil(headers.length / columnsPerPage));
  const pages: string[] = [];
  for (const chunk of rowChunks) {
    for (let panel = 0; panel < panels; panel += 1) {
      const firstColumn = panel * columnsPerPage;
      const lastColumn = Math.min(firstColumn + columnsPerPage, headers.length);
      const visibleHeaders = headers.slice(firstColumn, lastColumn);
      const columnWidth = 770 / Math.max(visibleHeaders.length, 1);
      const commands: string[] = [
        '0.12 0.18 0.28 rg',
        'BT /F1 16 Tf 36 555 Td (' + pdfText(title) + ') Tj ET',
        '0.35 0.39 0.45 rg',
        'BT /F1 9 Tf 36 538 Td (' + pdfText(subtitle) + ') Tj ET',
        'BT /F1 8 Tf 36 522 Td (' + pdfText('Columns ' + (firstColumn + 1) + '-' + lastColumn + ' of ' + headers.length) + ') Tj ET',
        '0.91 0.93 0.96 rg 36 496 770 20 re f',
        '0.12 0.18 0.28 rg',
      ];
      visibleHeaders.forEach((header, index) => {
        const x = 40 + index * columnWidth;
        commands.push('BT /F1 8 Tf ' + x.toFixed(2) + ' 503 Td (' + pdfText(header.slice(0, 25)) + ') Tj ET');
      });
      chunk.forEach((row, rowIndex) => {
        const y = 480 - rowIndex * 20;
        if (rowIndex % 2 === 1) commands.push('0.97 0.98 0.99 rg 36 ' + (y - 5) + ' 770 18 re f 0.12 0.18 0.28 rg');
        visibleHeaders.forEach((_, columnIndex) => {
          const value = String(row[firstColumn + columnIndex] ?? '').replace(/[\r\n]+/g, ' ');
          const x = 40 + columnIndex * columnWidth;
          commands.push('BT /F1 7 Tf ' + x.toFixed(2) + ' ' + y + ' Td (' + pdfText(value.slice(0, 27)) + ') Tj ET');
        });
      });
      commands.push('0.55 0.59 0.65 RG 36 35 m 806 35 l S');
      commands.push('BT /F1 8 Tf 690 20 Td (' + pdfText('Page ' + (pages.length + 1) + ' of ' + (rowChunks.length * panels)) + ') Tj ET');
      pages.push(commands.join('\n'));
    }
  }
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [' + pageObjectIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((page, index) => {
    const contentId = 5 + index * 2;
    const stream = Buffer.from(page, 'ascii');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + contentId + ' 0 R >>');
    objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + page + '\nendstream');
  });
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, 'ascii'));
    output += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  });
  const xrefOffset = Buffer.byteLength(output, 'ascii');
  output += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) output += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
  output += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF';
  return Buffer.from(output, 'ascii');
}
