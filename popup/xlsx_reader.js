// xlsx_reader.js — InfoJOB v1.1.0

const XLSXReader = {

  async read(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer.slice(0));
    console.log('Buffer size:', bytes.length);

    // Lê o diretório central do ZIP (mais confiável que local headers)
    const entries = this._parseCentralDirectory(bytes);
    const names   = Object.keys(entries);
    console.log('Entradas ZIP (central dir):', names);

    const sheetKey = names.find(n => /xl\/worksheets\/sheet1\.xml$/i.test(n));
    const ssKey    = names.find(n => /xl\/sharedStrings\.xml$/i.test(n));

    if (!sheetKey) throw new Error('sheet1.xml não encontrado. Arquivos: ' + names.join(', '));

    const sheetXml = await this._extract(bytes, entries[sheetKey]);
    const ssXml    = ssKey ? await this._extract(bytes, entries[ssKey]) : '';

    console.log('Sheet XML length:', sheetXml.length);
    console.log('SS XML length:', ssXml.length);

    const sharedStrings = this._parseSharedStrings(ssXml);
    return this._parseSheet(sheetXml, sharedStrings);
  },

  // ── Lê o diretório central do ZIP (End of Central Directory) ─
  _parseCentralDirectory(bytes) {
    const entries = {};

    // Localiza End of Central Directory (EoCD): assinatura 0x06054B50
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (bytes[i]   === 0x50 && bytes[i+1] === 0x4B &&
          bytes[i+2] === 0x05 && bytes[i+3] === 0x06) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) throw new Error('EoCD não encontrado — não é um ZIP válido');

    const cdOffset = this._u32(bytes, eocdOffset + 16);
    const cdSize   = this._u32(bytes, eocdOffset + 12);
    console.log('Central Dir offset:', cdOffset, 'size:', cdSize);

    // Percorre entradas do diretório central
    let i = cdOffset;
    while (i < cdOffset + cdSize && i < bytes.length - 4) {
      if (bytes[i]   !== 0x50 || bytes[i+1] !== 0x4B ||
          bytes[i+2] !== 0x01 || bytes[i+3] !== 0x02) break;

      const method    = this._u16(bytes, i + 10);
      const cmpSize   = this._u32(bytes, i + 20);
      const ucmpSize  = this._u32(bytes, i + 24);
      const nameLen   = this._u16(bytes, i + 28);
      const extraLen  = this._u16(bytes, i + 30);
      const commentLen= this._u16(bytes, i + 32);
      const localOff  = this._u32(bytes, i + 42);

      const name = new TextDecoder('utf-8').decode(bytes.subarray(i + 46, i + 46 + nameLen));

      if (name.endsWith('.xml') || name.endsWith('.rels')) {
        entries[name] = { method, cmpSize, ucmpSize, localOff };
      }

      i += 46 + nameLen + extraLen + commentLen;
    }

    return entries;
  },

  // ── Extrai dados de uma entrada usando o local file header ────
  async _extract(bytes, entry) {
    const lo = entry.localOff;

    if (bytes[lo]   !== 0x50 || bytes[lo+1] !== 0x4B ||
        bytes[lo+2] !== 0x03 || bytes[lo+3] !== 0x04) {
      throw new Error('Local header inválido no offset ' + lo);
    }

    const nameLen  = this._u16(bytes, lo + 26);
    const extraLen = this._u16(bytes, lo + 28);
    const dataStart = lo + 30 + nameLen + extraLen;
    const dataEnd   = dataStart + entry.cmpSize;

    console.log('Extraindo:', dataStart, '-', dataEnd, 'method:', entry.method, 'cmpSize:', entry.cmpSize);

    if (dataEnd > bytes.length) throw new Error('Dados além do fim do arquivo');

    const data = bytes.slice(dataStart, dataEnd);

    if (entry.method === 0) {
      return new TextDecoder('utf-8').decode(data);
    }

    if (entry.method === 8) {
      const ds     = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(data);
      writer.close();

      const chunks = [];
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const total = chunks.reduce((a, c) => a + c.length, 0);
      const out   = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) { out.set(c, pos); pos += c.length; }
      return new TextDecoder('utf-8').decode(out);
    }

    throw new Error('Método de compressão não suportado: ' + entry.method);
  },

  // ── Helpers de leitura ───────────────────────────────────────
  _u16(b, o) { return b[o] | (b[o+1] << 8); },
  _u32(b, o) { return (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0; },

  // ── Parser shared strings ────────────────────────────────────
  _parseSharedStrings(xml) {
    const strings = [];
    if (!xml) return strings;
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const tRe = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g;
      let t, parts = [];
      while ((t = tRe.exec(m[1])) !== null) parts.push(t[1]);
      strings.push(this._unescape(parts.join('')));
    }
    return strings;
  },

  // ── Parser sheet ─────────────────────────────────────────────
  _parseSheet(xml, sharedStrings) {
    const rows = [];
    if (!xml) return rows;

    const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    let rowM;
    while ((rowM = rowRe.exec(xml)) !== null) {
      const rowIdx = parseInt(rowM[1]) - 1;
      const cells  = [];

      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cellM;
      while ((cellM = cellRe.exec(rowM[2])) !== null) {
        const attrs = cellM[1];
        const inner = cellM[2];
        const refM  = attrs.match(/\br="([A-Z]+)\d+"/);
        const typeM = attrs.match(/\bt="([^"]+)"/);
        if (!refM) continue;

        const colIdx = this._colIndex(refM[1]);
        const type   = typeM ? typeM[1] : '';

        let val = '';
        const vM = inner.match(/<v>([^<]*)<\/v>/);
        if (vM) {
          val = type === 's'
            ? (sharedStrings[parseInt(vM[1])] || '')
            : this._unescape(vM[1]);
        } else {
          const tM = inner.match(/<t>([^<]*)<\/t>/);
          if (tM) val = this._unescape(tM[1]);
        }

        while (cells.length <= colIdx) cells.push('');
        cells[colIdx] = val;
      }

      while (rows.length <= rowIdx) rows.push([]);
      rows[rowIdx] = cells;
    }

    return rows;
  },

  _colIndex(col) {
    let n = 0;
    for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n - 1;
  },

  _unescape(str) {
    return String(str)
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&#xD;/g, '').replace(/&#10;/g, ' ');
  }
};
