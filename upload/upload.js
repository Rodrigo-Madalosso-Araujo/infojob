// upload.js — InfoJOB v1.0.6

let dadosCarregados = null;

// Limpa estado de execução anterior ao abrir a página de upload
// Evita que o content script dispare automaticamente ao navegar para solicitacao.asp
// Fila limpa ao abrir — executando só é setado ao iniciar automação
chrome.storage.local.set({ infojob_fila: null, infojob_executando: false });

// Converte letra de coluna (A, B, C...) para índice numérico (0, 1, 2...)
function colToIndex(col) {
  col = col.toUpperCase().trim();
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n - 1;
}

function log(msg, tipo) {
  const el = document.getElementById('log');
  el.classList.add('show');
  const div = document.createElement('div');
  div.className = tipo || '';
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function clearLog() {
  const el = document.getElementById('log');
  el.innerHTML = '';
  el.classList.remove('show');
}

function carregarConfigLeitura() {
  chrome.storage.local.get('infojob_leitura', (r) => {
    const cfg = r.infojob_leitura;
    if (!cfg) return;
    if (cfg.linhaInicial) document.getElementById('linhaInicial').value = cfg.linhaInicial;
    if (cfg.colProcesso)  document.getElementById('colProcesso').value  = cfg.colProcesso;
    if (cfg.colNome)      document.getElementById('colNome').value      = cfg.colNome;
    if (cfg.colNI)        document.getElementById('colNI').value        = cfg.colNI;
  });
}

function salvarConfigLeitura() {
  const cfg = {
    linhaInicial: parseInt(document.getElementById('linhaInicial').value) || 8,
    colProcesso:  document.getElementById('colProcesso').value.toUpperCase().trim() || 'C',
    colNome:      document.getElementById('colNome').value.toUpperCase().trim()     || 'D',
    colNI:        document.getElementById('colNI').value.toUpperCase().trim()       || 'E',
  };
  chrome.storage.local.set({ infojob_leitura: cfg });
  return cfg;
}

document.addEventListener('DOMContentLoaded', () => {
  carregarConfigLeitura();

  document.getElementById('uploadArea').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', function() {
    if (this.files[0]) processarArquivo(this.files[0]);
  });

  document.getElementById('btnExecutar').addEventListener('click', executar);

  ['linhaInicial','colProcesso','colNome','colNI'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      salvarConfigLeitura();
      const fileInput = document.getElementById('fileInput');
      if (fileInput.files[0]) processarArquivo(fileInput.files[0]);
    });
  });
});

async function processarArquivo(file) {
  clearLog();
  dadosCarregados = null;
  document.getElementById('resumo').classList.remove('show');
  document.getElementById('btnExecutar').classList.remove('show');
  document.getElementById('uploadArea').classList.add('has-file');
  document.getElementById('fileName').textContent = file.name;

  log('Lendo: ' + file.name, 'info');

  const cfg = salvarConfigLeitura();
  const idxProcesso = colToIndex(cfg.colProcesso);
  const idxNome     = colToIndex(cfg.colNome);
  const idxNI       = colToIndex(cfg.colNI);
  const startRow    = cfg.linhaInicial - 1;

  log('Config: linha ' + cfg.linhaInicial + ' | colunas ' + cfg.colProcesso + '=' + idxProcesso + ' ' + cfg.colNome + '=' + idxNome + ' ' + cfg.colNI + '=' + idxNI, 'info');

  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch(e) { log('Erro ao ler arquivo: ' + e.message, 'err'); return; }

  let rows;
  try {
    const isODS = file.name.toLowerCase().endsWith('.ods');
    rows = isODS ? await ODSReader.read(buffer) : await XLSXReader.read(buffer);
    log('Total de linhas no arquivo: ' + rows.length, 'info');
    if (rows.length === 0) {
      log('AVISO: nenhuma linha lida. Verifique o console do navegador para detalhes (F12 > Console).', 'warn');
      return;
    }
  } catch(e) {
    log('Erro ao interpretar Excel: ' + e.message, 'err');
    log('Abra o Console (F12) para mais detalhes.', 'warn');
    console.error('XLSXReader erro:', e);
    return;
  }

  // Diagnóstico — mostra amostra ao redor da linha inicial
  const ini = Math.max(0, startRow - 1);
  const fim = Math.min(rows.length, startRow + 4);
  log('Amostra linhas ' + (ini+1) + ' a ' + fim + ':', 'info');
  for (let i = ini; i < fim; i++) {
    const r = rows[i] || [];
    log('  L' + (i+1) + ': proc="' + (r[idxProcesso]||'—') + '" | nome="' + (r[idxNome]||'—') + '" | NI="' + (r[idxNI]||'—') + '"', 'info');
  }

  const partes = [];
  const vistas = new Set();

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] || [];
    const processo = String(row[idxProcesso] || '').trim();
    const nome     = String(row[idxNome]     || '').trim();
    const ni       = String(row[idxNI]       || '').trim().replace(/\D/g, '');
    if (!processo || !nome || !ni) continue;
    const chave = processo + '_' + ni;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const tipo      = ni.length <= 11 ? 'CPF' : 'CNPJ';
    const nomeAbrev = nome.split(' ').slice(0, 2).join(' ');
    partes.push({ processo, nome, nomeAbrev, ni, tipo });
  }

  dadosCarregados = partes;

  if (partes.length === 0) {
    log('Nenhuma parte encontrada. Ajuste a linha inicial e as colunas — o arquivo será relido automaticamente.', 'warn');
    return;
  }

  const cpfs  = partes.filter(p => p.tipo === 'CPF').length;
  const cnpjs = partes.filter(p => p.tipo === 'CNPJ').length;

  document.getElementById('r-total').textContent = partes.length;
  document.getElementById('r-cpf').textContent   = cpfs;
  document.getElementById('r-cnpj').textContent  = cnpjs;
  document.getElementById('resumo').classList.add('show');
  document.getElementById('btnExecutar').classList.add('show');
  log('✓ ' + partes.length + ' partes únicas (' + cpfs + ' CPFs · ' + cnpjs + ' CNPJs)', 'ok');
  chrome.storage.local.set({ infojob_dados: partes });
}

async function executar() {
  if (!dadosCarregados || dadosCarregados.length === 0) return;
  const btn = document.getElementById('btnExecutar');
  btn.disabled = true;
  btn.textContent = 'Verificando eCAC...';

  // Busca aba do eCAC com múltiplas variações de URL
  let tabs = await chrome.tabs.query({ url: 'https://cav.receita.fazenda.gov.br/*' });
  if (tabs.length === 0) {
    tabs = await chrome.tabs.query({ url: '*://cav.receita.fazenda.gov.br/*' });
  }
  if (tabs.length === 0) {
    // Busca por título como fallback
    const allTabs = await chrome.tabs.query({});
    tabs = allTabs.filter(t => 
      t.url && (
        t.url.includes('cav.receita.fazenda.gov.br') ||
        t.url.includes('receita.fazenda.gov.br')
      )
    );
  }
  
  log('Abas eCAC encontradas: ' + tabs.length + (tabs[0] ? ' | URL: ' + tabs[0].url : ''), 'info');
  
  if (tabs.length === 0) {
    log('⚠ Aba do eCAC não encontrada. Certifique-se de que o eCAC está aberto e logado.', 'err');
    btn.disabled = false; btn.textContent = '▶ Executar automação'; return;
  }

  const config = await new Promise(r =>
    chrome.storage.local.get('infojob_config', res => r(res.infojob_config))
  );

  if (!config) {
    log('⚠ Configure a extensão primeiro (vara, tipo de processo, etc).', 'err');
    btn.disabled = false; btn.textContent = '▶ Executar automação'; return;
  }

  chrome.storage.local.set({
    infojob_dados: dadosCarregados,
    infojob_executando: true,
    infojob_sucesso: [],
    infojob_erros: [],
    infojob_resultado_pendente: false,
    infojob_fila_pedidos: []
  });
  log('Iniciando automação — ' + dadosCarregados.length + ' parte(s)...', 'info');
  btn.textContent = '⏳ Executando...';

  const tabId = tabs[0].id;

  // Verifica se content script está ativo via ping (timeout 3s)
  const scriptAtivo = await new Promise(resolve => {
    let resolvido = false;
    chrome.tabs.sendMessage(tabId, { acao: 'ping' }, (resp) => {
      if (!resolvido) {
        resolvido = true;
        resolve(!chrome.runtime.lastError && resp && resp.ok);
      }
    });
    setTimeout(() => { if (!resolvido) { resolvido = true; resolve(false); } }, 3000);
  });

  log('Content script ativo: ' + scriptAtivo, 'info');

  if (!scriptAtivo) {
    log('Content script não respondeu. Recarregue a página do eCAC (F5) e tente novamente.', 'err');
    btn.disabled = false; btn.textContent = '▶ Executar automação'; return;
  }

  // Salva dados no storage e navega diretamente para solicitacao.asp
  // Evita dependência do ping em páginas onde o content script não injeta (ex: frames)
  const SOLICITACAO_URL = 'https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/solicitacao.asp';
  
  chrome.storage.local.set({
    infojob_fila:       dadosCarregados,
    infojob_config:     config,
    infojob_idx:        0,
    infojob_etapa:      'registrar',
    infojob_executando: true,
    infojob_sucesso:    [],
    infojob_erros:      []
  }, () => {
    // Navega a aba do eCAC para solicitacao.asp onde o content script está ativo
    chrome.tabs.update(tabId, { url: SOLICITACAO_URL, active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
    log('✓ Navegando para o eCAC... A automação iniciará automaticamente.', 'ok');
    btn.textContent = '✓ Executando no eCAC';
  });
}
