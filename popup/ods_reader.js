// ods_reader.js — InfoJOB
// Lê arquivos .ods (OpenDocument Spreadsheet) — formato ZIP com XML interno

const ODSReader = {
  async read(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer.slice(0));
    
    // ODS é um ZIP — busca content.xml
    const entries = this._parseZip(bytes);
    const names   = Object.keys(entries);
    console.log('ODS entradas:', names);
    
    const contentKey = names.find(n => n === 'content.xml');
    if (!contentKey) throw new Error('content.xml não encontrado no ODS');
    
    const xml = await this._decompress(entries[contentKey]);
    return this._parseContent(xml);
  },

  _parseZip(bytes) {
    const entries = {};
    // Lê diretório central
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x05 && bytes[i+3]===0x06) {
        eocdOffset = i; break;
      }
    }
    if (eocdOffset === -1) throw new Error('ZIP inválido');
    const cdOffset = this._u32(bytes, eocdOffset + 16);
    let i = cdOffset;
    while (i < bytes.length - 4) {
      if (bytes[i]!==0x50||bytes[i+1]!==0x4B||bytes[i+2]!==0x01||bytes[i+3]!==0x02) break;
      const method   = this._u16(bytes, i+10);
      const cmpSize  = this._u32(bytes, i+20);
      const nameLen  = this._u16(bytes, i+28);
      const extraLen = this._u16(bytes, i+30);
      const cmtLen   = this._u16(bytes, i+32);
      const localOff = this._u32(bytes, i+42);
      const name     = new TextDecoder('utf-8').decode(bytes.subarray(i+46, i+46+nameLen));
      if (name.endsWith('.xml')) {
        entries[name] = { method, cmpSize, localOff, _bytes: bytes };
      }
      i += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  },

  async _decompress(entry) {
    const bytes = entry._bytes;
    const lo    = entry.localOff;
    const nameLen  = this._u16(bytes, lo+26);
    const extraLen = this._u16(bytes, lo+28);
    const data     = bytes.slice(lo + 30 + nameLen + extraLen, lo + 30 + nameLen + extraLen + entry.cmpSize);
    if (entry.method === 0) return new TextDecoder('utf-8').decode(data);
    const ds = new DecompressionStream('deflate-raw');
    const w  = ds.writable.getWriter();
    w.write(data); w.close();
    const chunks = []; const r = ds.readable.getReader();
    while (true) { const {done,value} = await r.read(); if (done) break; chunks.push(value); }
    const total = chunks.reduce((a,c)=>a+c.length,0);
    const out   = new Uint8Array(total); let pos=0;
    for (const c of chunks) { out.set(c,pos); pos+=c.length; }
    return new TextDecoder('utf-8').decode(out);
  },

  _parseContent(xml) {
    const rows = [];
    const rowRe = /<table:table-row([^>]*)>([\s\S]*?)<\/table:table-row>/g;
    let rowM;
    while ((rowM = rowRe.exec(xml)) !== null) {
      const rowAttrs = rowM[1];
      const rowRepeat = parseInt((rowAttrs.match(/table:number-rows-repeated="(\d+)"/) || [])[1] || '1');
      
      const cells = [];
      const cellRe = /<table:table-cell([^>]*)>([\s\S]*?)<\/table:table-cell>/g;
      let cellM;
      while ((cellM = cellRe.exec(rowM[2])) !== null) {
        const attrs = cellM[1];
        const inner = cellM[2];
        const repeat = parseInt((attrs.match(/table:number-columns-repeated="(\d+)"/) || [])[1] || '1');
        const tM = inner.match(/<text:p[^>]*>([\s\S]*?)<\/text:p>/);
        const val = tM ? this._unescape(tM[1].replace(/<[^>]+>/g, '')) : '';
        for (let r = 0; r < repeat; r++) cells.push(val);
      }
      
      // Só inclui linhas não completamente vazias (evita linhas repetidas em branco no fim)
      const temConteudo = cells.some(c => c !== '');
      if (temConteudo) {
        for (let r = 0; r < rowRepeat; r++) rows.push([...cells]);
      } else if (rowRepeat < 100) {
        // Linha vazia não repetida em massa — inclui para manter índices corretos
        for (let r = 0; r < rowRepeat; r++) rows.push([...cells]);
      }
    }
    return rows;
  },

  _u16(b,o) { return b[o]|(b[o+1]<<8); },
  _u32(b,o) { return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; },
  _unescape(s) {
    return String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
  }
};
