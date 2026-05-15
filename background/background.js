// background.js — InfoJOB Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('InfoJOB instalado com sucesso.');
});

// Abre a página de configurações no primeiro uso
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// Abre o popup quando o content script solicita (ex: ao fim da automação)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.acao === 'abrir_popup') {
    chrome.action.openPopup().catch(() => {
      // openPopup pode falhar se não houver janela ativa — ignora silenciosamente
    });
    sendResponse({ ok: true });
  }

  // Download genérico (usado para salvar log .txt)
  if (msg.acao === 'download' && msg.url && msg.filename) {
    chrome.downloads.download({
      url:      msg.url,
      filename: msg.filename,
      conflictAction: msg.conflictAction || 'overwrite',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('InfoJOB bg: erro no download do log:', chrome.runtime.lastError.message);
        sendResponse({ ok: false, erro: chrome.runtime.lastError.message });
      } else {
        console.log('InfoJOB bg: log salvo, id:', downloadId);
        sendResponse({ ok: true, downloadId });
      }
    });
    return true; // resposta assíncrona
  }

  return false;
});

// Captura frameId do iframe www3 quando ele carrega
// e salva no storage para o content.js usar
// Também intercepta solicitadorPDFMidas.asp para baixar automaticamente
chrome.webNavigation.onCommitted.addListener((details) => {
  // Captura frameId da caixa postal
  if (details.url.includes('www3.cav.receita.fazenda.gov.br') && details.frameId !== 0) {
    chrome.storage.local.set({
      infojob_iframe_tabId:   details.tabId,
      infojob_iframe_frameId: details.frameId
    });
    console.log('InfoJOB bg: iframe frameId capturado:', details.frameId, 'tabId:', details.tabId);
  }

  // Intercepta PDF gerado pelo solicitadorPDFMidas.asp
  if (details.url.includes('solicitadorPDFMidas.asp') && details.frameId !== 0) {
    console.log('InfoJOB bg: PDF detectado em:', details.url);

    // Baixa o PDF via chrome.downloads
    chrome.downloads.download({
      url: details.url,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('InfoJOB bg: erro ao baixar PDF:', chrome.runtime.lastError.message);
        return;
      }
      console.log('InfoJOB bg: download iniciado, id:', downloadId);

      // Notifica o content.js — sem frameId para broadcast a todos os frames
      chrome.tabs.sendMessage(details.tabId, {
        acao: 'download_iniciado',
        downloadId: downloadId,
        url: details.url
      }).catch(() => {});
    });
  }

  // Intercepta listarDITR.asp para baixar via html2canvas
  if (details.url.includes('listarDITR.asp') && details.frameId !== 0) {
    console.log('InfoJOB bg: DITR detectado, notificando content.js');
    // Sem frameId para broadcast a todos os frames
    chrome.tabs.sendMessage(details.tabId, {
      acao: 'ditr_carregado',
      url: details.url
    }).catch(() => {});
  }

  // Intercepta visualizardeclaracao.asp (DIRPF, DECRED, DIMOB) — notifica download iniciado
  // Só dispara se o content.js sinalizou que está aguardando esse tipo de download
  if (details.url.includes('visualizardeclaracao.asp') && details.frameId !== 0) {
    if (_aguardandoVisualizarDeclaracao) {
      _aguardandoVisualizarDeclaracao = false;
      console.log('InfoJOB bg: visualizardeclaracao detectado, notificando content.js');
      chrome.tabs.sendMessage(details.tabId, {
        acao: 'download_iniciado',
        downloadId: null,
        url: details.url
      }).catch(() => {});
    }
  }
});

// Proxy: content.js principal envia mensagem para o iframe via background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.acao === 'msg_para_iframe') {
    chrome.storage.local.get(['infojob_iframe_tabId', 'infojob_iframe_frameId'], (data) => {
      if (!data.infojob_iframe_frameId) {
        sendResponse({ ok: false, erro: 'frameId não disponível' });
        return;
      }
      chrome.tabs.sendMessage(
        data.infojob_iframe_tabId,
        msg.payload,
        { frameId: data.infojob_iframe_frameId },
        (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, erro: chrome.runtime.lastError.message });
          } else {
            sendResponse(resp);
          }
        }
      );
    });
    return true; // async
  }
});

// Captura screenshot da aba e converte para PDF (para DITR)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.acao === 'capturar_screenshot_pdf') {
    (async () => {
      try {
        // Captura screenshot da aba visível
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 85 });

        // Converte imagem JPEG para PDF mínimo válido
        const pdfBytes = await imagemParaPDF(dataUrl);
        const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
        const blobUrl  = URL.createObjectURL(blob);

        chrome.downloads.download({
          url: blobUrl,
          filename: msg.filename || 'DITR.pdf',
          conflictAction: 'uniquify'
        }, (downloadId) => {
          URL.revokeObjectURL(blobUrl);
          if (chrome.runtime.lastError) {
            console.error('InfoJOB bg: erro ao baixar DITR PDF:', chrome.runtime.lastError.message);
            sendResponse({ ok: false });
            return;
          }
          console.log('InfoJOB bg: DITR PDF baixado, id:', downloadId);
          // Sem frameId para broadcast a todos os frames
          chrome.tabs.sendMessage(sender.tab.id, {
            acao: 'download_iniciado', downloadId, url: 'ditr_pdf'
          }).catch(() => {});
          sendResponse({ ok: true, downloadId });
        });
      } catch(e) {
        console.error('InfoJOB bg: erro screenshot:', e.message);
        sendResponse({ ok: false, erro: e.message });
      }
    })();
    return true;
  }
});

// Converte dataURL de imagem JPEG para bytes de PDF válido
async function imagemParaPDF(dataUrl) {
  // Remove prefixo data:image/jpeg;base64,
  const base64 = dataUrl.split(',')[1];
  const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  // Dimensões A4 em pontos (72dpi): 595 x 842
  const W = 595, H = 842;

  // Monta PDF mínimo com uma imagem JPEG
  const enc = new TextEncoder();

  const imgObj   = `1 0 obj
<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>
stream
`;
  const imgEnd   = `
endstream
endobj
`;
  const pageObj  = `2 0 obj
<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /XObject << /Im1 1 0 R >> >> >>
endobj
`;
  const pagesObj = `3 0 obj
<< /Type /Pages /Kids [2 0 R] /Count 1 >>
endobj
`;
  const contStr  = `q ${W} 0 0 ${H} 0 0 cm /Im1 Do Q`;
  const contObj  = `4 0 obj
<< /Length ${contStr.length} >>
stream
${contStr}
endstream
endobj
`;
  const catObj   = `5 0 obj
<< /Type /Catalog /Pages 3 0 R >>
endobj
`;
  const header   = `%PDF-1.4
`;

  // Calcula offsets para xref
  let offset = header.length;
  const offsets = [];

  const parts = [
    enc.encode(imgObj), imgBytes, enc.encode(imgEnd),
    enc.encode(pageObj), enc.encode(pagesObj),
    enc.encode(contObj), enc.encode(catObj)
  ];

  // Monta buffer
  const totalLen = parts.reduce((s, p) => s + p.length, header.length);
  const buf = new Uint8Array(totalLen + 500); // +500 para xref/trailer
  let pos = 0;
  const write = (bytes) => { buf.set(bytes, pos); pos += bytes.length; };

  write(enc.encode(header));

  offsets[1] = pos;
  write(enc.encode(imgObj)); write(imgBytes); write(enc.encode(imgEnd));
  offsets[2] = pos; write(enc.encode(pageObj));
  offsets[3] = pos; write(enc.encode(pagesObj));
  offsets[4] = pos; write(enc.encode(contObj));
  offsets[5] = pos; write(enc.encode(catObj));

  const xrefOffset = pos;
  const xref = `xref
0 6
0000000000 65535 f 
${String(offsets[1]).padStart(10,'0')} 00000 n 
${String(offsets[2]).padStart(10,'0')} 00000 n 
${String(offsets[3]).padStart(10,'0')} 00000 n 
${String(offsets[4]).padStart(10,'0')} 00000 n 
${String(offsets[5]).padStart(10,'0')} 00000 n 
trailer
<< /Size 6 /Root 5 0 R >>
startxref
${xrefOffset}
%%EOF
`;
  write(enc.encode(xref));

  return buf.slice(0, pos);
}

// Content-Disposition forçado via declarativeNetRequest (rules/rules.json)

// Renomear próximo download com nome definido pelo content.js
let _proximoFilename = null;
let _aguardandoVisualizarDeclaracao = false;
let _pastaDownload = 'INFOJUD'; // subpasta padrão, atualizada ao carregar config

// Carrega pasta configurada ao iniciar e ao receber atualizações
function carregarPasta() {
  chrome.storage.local.get(['infojob_config'], (data) => {
    const pasta = (data.infojob_config?.pastaSaida || 'INFOJUD').trim()
      .replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
    _pastaDownload = pasta || 'INFOJUD';
    console.log('InfoJOB bg: pasta de download:', _pastaDownload);
  });
}
carregarPasta();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.infojob_config) carregarPasta();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.acao !== 'definir_proximo_filename') return false;
  _proximoFilename = msg.filename || null;
  _aguardandoVisualizarDeclaracao = !!msg.aguardaVisualizarDeclaracao;
  console.log('InfoJOB bg: próximo download será renomeado para:', _proximoFilename,
    '| aguardaVisualizarDeclaracao:', _aguardandoVisualizarDeclaracao);
  sendResponse({ ok: true });
  return false;
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const url = downloadItem.url || '';

  if (_proximoFilename) {
    const filename = _proximoFilename;
    _proximoFilename = null;
    _aguardandoVisualizarDeclaracao = false;
    const safe = filename
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[<>:"/\\|?*]/g, '_');
    console.log('InfoJOB bg: renomeando download para:', safe);
    // Usa subpasta já carregada em memória (síncrono — evita timeout do suggest)
    const fullPath = _pastaDownload ? _pastaDownload + '/' + safe : safe;
    suggest({ filename: fullPath, conflictAction: 'uniquify' });
  } else {
    suggest();
  }

  // Notifica content.js sobre qualquer download de fazenda.gov.br
  // (fallback para DECRED/DIMOB que não disparam onCommitted)
  const isFazenda = url.includes('receita.fazenda.gov.br') || url.includes('fazenda.gov.br');
  if (isFazenda) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        acao: 'download_iniciado',
        downloadId: downloadItem.id,
        url
      }).catch(() => {});
    });
  }
});


// Gera PDF com texto simples para DITR — devolve base64 ao content_iframe que faz o download
// O onDeterminingFilename captura e renomeia com subpasta correta
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.acao === 'gerar_pdf_texto') {
    try {
      const pdfBytes = gerarPDFTexto(msg.linhas || [], msg.titulo || 'InfoJOB');
      let binary = '';
      for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
      const base64 = btoa(binary);
      // Seta _proximoFilename para que onDeterminingFilename renomeie corretamente
      const rawName = (msg.filename || 'InfoJOB.pdf')
        .replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/[<>:"/\\|?*]/g, '_');
      _proximoFilename = rawName;
      console.log('InfoJOB bg: PDF gerado, aguardando download do iframe:', rawName);
      sendResponse({ ok: true, base64, filename: rawName });
    } catch(e) {
      console.error('InfoJOB bg: erro gerar_pdf_texto:', e.message);
      sendResponse({ ok: false, erro: e.message });
    }
    return false;
  }
});

function gerarPDFTexto(linhas, titulo) {
  const enc = new TextEncoder();
  const marginX = 50, lineH = 20;
  let y = 780, stream = '';
  // Tm = posição absoluta (não relativa como Td)
  stream += 'BT\n/F1 16 Tf\n1 0 0 1 ' + marginX + ' ' + y + ' Tm\n(' + sanitizePDF(titulo) + ') Tj\n';
  y -= 30;
  stream += '/F1 12 Tf\n';
  for (const linha of linhas) {
    if (y < 50) break;
    stream += '1 0 0 1 ' + marginX + ' ' + y + ' Tm\n(' + sanitizePDF(linha) + ') Tj\n';
    y -= lineH;
  }
  stream += 'ET\n';
  const contLen = enc.encode(stream).length;
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
  const obj4 = '4 0 obj\n<< /Length ' + contLen + ' >>\nstream\n' + stream + '\nendstream\nendobj\n';
  const obj5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const header = '%PDF-1.4\n';
  const parts = [obj1, obj2, obj3, obj4, obj5];
  let pos = header.length;
  const offsets = [0], buf = [enc.encode(header)];
  for (let i = 0; i < parts.length; i++) {
    offsets.push(pos);
    const b = enc.encode(parts[i]);
    buf.push(b); pos += b.length;
  }
  const xrefPos = pos;
  const xref = 'xref\n0 6\n0000000000 65535 f \n' +
    offsets.slice(1).map(o => String(o).padStart(10,'0') + ' 00000 n ').join('\n') +
    '\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
  buf.push(enc.encode(xref));
  const total = buf.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buf) { out.set(b, offset); offset += b.length; }
  return out;
}

function sanitizePDF(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[()\\]/g, '\\$&')
    .substring(0, 200);
}

// Detecta novo download e notifica o content.js principal
chrome.downloads.onCreated.addListener((downloadItem) => {
  const url = downloadItem.url || downloadItem.finalUrl || '';
  // Log todos os downloads para debug
  console.log('InfoJOB bg: onCreated:', url.substring(0, 80), '| filename:', downloadItem.filename);
  const isFazenda      = url.includes('receita.fazenda.gov.br') || url.includes('fazenda.gov.br');
  const isBlobExtensao = url.startsWith('blob:chrome-extension://');
  const isInfoJobPdf   = (downloadItem.filename || '').includes('DITR') ||
                         (downloadItem.filename || '').includes('InfoJOB');

  // FIX v1.7.38: também aceita blob URLs gerados pela própria extensão (ex: DITR PDF)
  if (!isFazenda && !(isBlobExtensao && isInfoJobPdf)) return;

  console.log('InfoJOB bg: download iniciado:', downloadItem.filename || url);

  // Envia para o content.js da aba ativa
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, {
      acao: 'download_iniciado',
      downloadId: downloadItem.id,
      url: url
    }).catch(() => {}); // ignora se content script não estiver presente
  });
});
