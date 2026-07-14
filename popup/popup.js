// popup.js — InfoJOB

let dadosCarregados = null;
let executando = false;
let pararFlag = false;
let config = null;

// ── Inicialização ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  config = await carregarConfig();
  verificarEcac();
  atualizarResumoVara();

  // Event listeners — sem inline handlers (CSP extensão Chrome)
  document.getElementById('btnConfig').addEventListener('click', abrirConfig);
  document.getElementById('btnParar').addEventListener('click', pararAutomacao);

  // Auto-save dos campos de leitura
  ['linhaInicial','colProcesso','colNome','colNI'].forEach(id => {
    document.getElementById(id).addEventListener('change', salvarLeitura);
  });

  // Botão de ajuda — abre o guia do usuário em PDF numa nova aba
  document.getElementById('btnAjuda').addEventListener('click', () => {
    // Abre página de ajuda com links para os documentos
    const ajudaUrl = chrome.runtime.getURL('ajuda/ajuda.html');
    chrome.tabs.create({ url: ajudaUrl });
  });

  // Verifica se há resultado pendente (automação recém concluída)
  chrome.storage.local.get(['infojob_executando','infojob_resultado_pendente','infojob_sucesso','infojob_erros'], (data) => {
    if (data.infojob_resultado_pendente) {
      exibirResultado(data.infojob_sucesso || [], data.infojob_erros || []);
      chrome.storage.local.remove(['infojob_resultado_pendente','infojob_sucesso','infojob_erros']);
    } else if (data.infojob_executando) {
      document.getElementById('btnParar').style.display = 'flex';
    }
  });

  document.getElementById('uploadArea').addEventListener('click', triggerFileInput);
  document.getElementById('fileInput').addEventListener('change', function() { onFile(this); });
  document.getElementById('btnExecutar').addEventListener('click', executar);
  document.getElementById('btnParar').addEventListener('click', parar);
  document.getElementById('btnSalvarRespostas').addEventListener('click', salvarRespostas);
  document.getElementById('btnLimpar').addEventListener('click', limpar);
});

function doisPrimeirosNomesPopup(nomeCompleto) {
  const tokens = (nomeCompleto || '').trim().split(/\s+/);
  const validos = tokens.filter(t => !t.includes('.'));
  return validos.slice(0, 2).join(' ');
}

function colToIndex(col) {
  col = (col || 'A').toUpperCase().trim();
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n - 1;
}

async function carregarConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['infojob_config', 'infojob_leitura'], r => {
      // Carrega configuração de leitura da planilha
      const leitura = r.infojob_leitura || { temColNome: true };
      document.getElementById('linhaInicial').value  = leitura.linhaInicial || '';
      document.getElementById('colProcesso').value   = leitura.colProcesso  || '';
      document.getElementById('colNome').value       = leitura.colNome      || '';
      document.getElementById('colNI').value         = leitura.colNI        || '';
      document.getElementById('temColNome').checked  = leitura.temColNome !== false;
      // Habilita/desabilita campo colNome conforme checkbox
      document.getElementById('colNome').disabled    = !document.getElementById('temColNome').checked;
      document.getElementById('temColNome').addEventListener('change', function() {
        document.getElementById('colNome').disabled = !this.checked;
      });
      resolve(r.infojob_config || configPadrao());
    });
  });
}

function salvarLeitura() {
  chrome.storage.local.set({ infojob_leitura: {
    linhaInicial: parseInt(document.getElementById('linhaInicial').value) || 8,
    colProcesso:  document.getElementById('colProcesso').value.toUpperCase() || 'C',
    colNome:      document.getElementById('colNome').value.toUpperCase()     || 'D',
    colNI:        document.getElementById('colNI').value.toUpperCase()       || 'E',
    temColNome:   document.getElementById('temColNome').checked,
  }});
}

function configPadrao() {
  return {
    processo: { tipo: 'Ação Trabalhista', justificativa: 'execução', vara: '' },
    pastaSaida: '',
    cpf: {
      dirpf:   { ativo: true,  anos: '2' },
      ditr:    { ativo: true,  anos: '1' },
      doi:     { ativo: true,  dataIni: '01/1980' },
      decred:  { ativo: true,  anos: '1' },
      dimob:   { ativo: true,  anos: '1' },
      infocad: { ativo: false },
      efin:    { ativo: false, conta: 'Todas', relacao: 'Todas', extrato: 'Contas e movimentações', cambio: 'Não' }
    },
    cnpj: {
      dipj:    { ativo: false, anos: '1' },
      ecf:     { ativo: false, anos: '1' },
      ditr:    { ativo: true,  anos: '1' },
      doi:     { ativo: true,  dataIni: '01/1980' },
      decred:  { ativo: true,  anos: '1' },
      dimob:   { ativo: true,  anos: '1' },
      cpmf:    { ativo: false, dataIni: '', dataFim: '' },
      infocad: { ativo: false },
      efin:    { ativo: false, conta: 'Todas', relacao: 'Todas', extrato: 'Contas e movimentações', cambio: 'Não' }
    }
  };
}

// ── Verificar sessão eCAC ──────────────────────────────────────
async function verificarEcac() {
  const status = document.getElementById('ecacStatus');
  const msg = document.getElementById('ecacMsg');

  try {
    const tabs = await chrome.tabs.query({ url: 'https://cav.receita.fazenda.gov.br/*' });
    if (tabs.length > 0) {
      status.className = 'ecac-status ok';
      msg.textContent = 'Sessão eCAC ativa — pronto para executar';
    } else {
      status.className = 'ecac-status warn';
      msg.textContent = 'Abra o eCAC no navegador e faça login';
    }
  } catch (e) {
    status.className = 'ecac-status error';
    msg.textContent = 'Não foi possível verificar a sessão';
  }
}

function atualizarResumoVara() {
  if (config && config.processo && config.processo.vara) {
    document.getElementById('r-vara').textContent = config.processo.vara.substring(0, 30) + (config.processo.vara.length > 30 ? '…' : '');
  }
}

// ── Trigger file input ────────────────────────────────────────
// No Chrome, o popup fecha ao abrir file dialog — abrimos em nova aba
function triggerFileInput() {
  document.getElementById('fileInput').click();
}

// ── Carregar arquivo Excel ─────────────────────────────────────
function onFile(input) {
  const file = input.files[0];
  if (!file) return;

  const area = document.getElementById('uploadArea');
  area.classList.add('has-file');
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('log').classList.add('show');
  log('Lendo arquivo: ' + file.name, 'info');

  const reader = new FileReader();
  reader.onload = (e) => processarExcel(e.target.result, file.name);
  reader.onerror = () => log('Erro ao ler o arquivo', 'err');
  reader.readAsArrayBuffer(file);
}

async function processarExcel(buffer, nomeArquivo) {
  try {
    const isOds = nomeArquivo.toLowerCase().endsWith('.ods');
    const rows = isOds ? await ODSReader.read(buffer) : await XLSXReader.read(buffer);
    const partes = [];
    const vistas = new Set();

    // Usa configuração de leitura do popup
    const linhaInicial  = parseInt(document.getElementById('linhaInicial').value) || 8;
    const idxProcesso   = colToIndex(document.getElementById('colProcesso').value || 'A');
    const idxNome       = colToIndex(document.getElementById('colNome').value     || 'I');
    const idxNI         = colToIndex(document.getElementById('colNI').value       || 'H');
    const temColNome    = document.getElementById('temColNome').checked;

    salvarLeitura();

    let parteIdx = 0;
    for (let i = linhaInicial - 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const processo = String(row[idxProcesso] || '').trim().replace(/[.\-/]/g, '');
      const nome     = temColNome ? String(row[idxNome] || '').trim() : 'PARTE';
      const niRaw    = String(row[idxNI]       || '').trim().replace(/\D/g, '');
      // Remove zero decimal extra que o Excel adiciona (ex: 14 dígitos + .0 → 15 dígitos)
      const ni = niRaw.length === 11 ? niRaw :
                 niRaw.substring(0, 14); // força máximo 14 dígitos (CPF=11, CNPJ=14)

      if (!processo || !ni) continue;
      if (temColNome && !nome) continue;

      parteIdx++;
      const nomeEfetivo = temColNome ? nome : `Parte ${parteIdx}`;
      const chave = processo + '_' + ni;
      if (vistas.has(chave)) continue;
      vistas.add(chave);

      const tipo = ni.length === 11 ? 'CPF' : 'CNPJ';
      const primeirosNomes = doisPrimeirosNomesPopup(nomeEfetivo);

      partes.push({ processo, nome: nomeEfetivo, nomeAbrev: primeirosNomes, ni, tipo });
    }

    dadosCarregados = partes;
    mostrarResumo(nomeArquivo, partes);
    document.getElementById('btnExecutar').disabled = false;
    log('Arquivo carregado: ' + partes.length + ' parte(s) únicas', 'ok');
  } catch(e) {
    log('Erro ao processar Excel: ' + e.message, 'err');
  }
}

function mostrarResumo(arquivo, partes) {
  const cpfs = partes.filter(p => p.tipo === 'CPF').length;
  const cnpjs = partes.filter(p => p.tipo === 'CNPJ').length;

  document.getElementById('r-arquivo').textContent = arquivo.substring(0, 25) + (arquivo.length > 25 ? '…' : '');
  document.getElementById('r-total').textContent = partes.length;
  document.getElementById('r-cpf').textContent = cpfs;
  document.getElementById('r-cnpj').textContent = cnpjs;
  document.getElementById('resumo').classList.add('show');
}

// ── Execução ───────────────────────────────────────────────────
async function executar() {
  if (!dadosCarregados || dadosCarregados.length === 0) return;
  if (executando) return;

  executando = true;
  pararFlag = false;

  document.getElementById('btnExecutar').disabled = true;
  document.getElementById('btnExecutar').style.display = 'none';
  document.getElementById('btnParar').style.display = 'block';
  document.getElementById('progressWrap').classList.add('show');
  document.getElementById('log').classList.add('show');

  log('Iniciando automação — ' + dadosCarregados.length + ' parte(s)', 'info');

  // Busca aba do eCAC
  let tabs = await chrome.tabs.query({ url: 'https://cav.receita.fazenda.gov.br/*' });
  if (tabs.length === 0) {
    const allTabs = await chrome.tabs.query({});
    tabs = allTabs.filter(t => t.url && t.url.includes('cav.receita.fazenda.gov.br'));
  }
  if (tabs.length === 0) {
    log('Sessão eCAC não encontrada — abra o eCAC e tente novamente', 'err');
    executando = false;
    return;
  }

  const tabId = tabs[0].id;
  const SOLICITACAO_URL = 'https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/solicitacao.asp';

  // Salva fila no storage e navega para solicitacao.asp
  // O content.js detecta e executa automaticamente
  await chrome.storage.local.set({
    infojob_fila:       dadosCarregados,
    infojob_config:     config,
    infojob_idx:        0,
    infojob_etapa:      'registrar',
    infojob_executando: true,
    infojob_sucesso:    [],
    infojob_erros:      []
  });

  chrome.tabs.update(tabId, { url: SOLICITACAO_URL, active: true });

  log('✓ Navegando para o eCAC... Aguardando conclusão...', 'ok');
  document.getElementById('progressLabel').textContent = 'Executando no eCAC...';

  // Monitora storage até a automação concluir e exibe relatório no popup também
  await monitorarConclusao();
}

async function monitorarConclusao() {
  // Aguarda até infojob_executando virar false (máx 30 min)
  const MAX = 1800;
  for (let i = 0; i < MAX; i++) {
    await sleep(1000);
    const data = await new Promise(r => chrome.storage.local.get(
      ['infojob_executando','infojob_sucesso','infojob_erros','infojob_resultado_pendente'], r));

    if (!data.infojob_executando) {
      const sucesso = data.infojob_sucesso || [];
      const erros   = data.infojob_erros   || [];

      // Atualiza progresso
      document.getElementById('progressFill').style.width = '100%';
      document.getElementById('progressPct').textContent = '100%';
      document.getElementById('progressLabel').textContent = 'Concluído';

      // Exibe relatório no popup
      log('─── Relatório de execução ───', 'info');
      if (sucesso.length > 0) {
        log(`✓ ${sucesso.length} parte(s) processada(s) com sucesso:`, 'ok');
        sucesso.forEach(p => log(`  · ${p.nome} — ${p.processo}`, 'ok'));
      }
      if (erros.length > 0) {
        log(`⚠ ${erros.length} parte(s) com erro:`, 'warn');
        erros.forEach(p => log(`  · ${p.nome} — ${p.processo}: ${p.erro}`, 'err'));
      }
      log('Automação concluída. Verifique a Caixa Postal do eCAC.', 'ok');

      chrome.storage.local.remove(['infojob_resultado_pendente']);

      executando = false;
      document.getElementById('btnParar').style.display = 'none';
      document.getElementById('btnLimpar').style.display = 'block';
      return;
    }

    // Atualiza progresso parcial
    const data2 = await new Promise(r => chrome.storage.local.get(['infojob_idx','infojob_fila'], r));
    const idx   = data2.infojob_idx || 0;
    const total = (data2.infojob_fila || []).length || 1;
    const pct   = Math.min(Math.round((idx / total) * 100), 99);
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPct').textContent = pct + '%';
    document.getElementById('progressLabel').textContent = `Executando no eCAC... (${idx}/${total})`;
  }

  log('Tempo limite atingido. Verifique o eCAC manualmente.', 'warn');
  executando = false;
  document.getElementById('btnParar').style.display = 'none';
  document.getElementById('btnLimpar').style.display = 'block';
}

function finalizarExecucao(efinPendentes) {
  executando = false;
  document.getElementById('btnParar').style.display = 'none';
  document.getElementById('btnLimpar').style.display = 'block';
  document.getElementById('progressLabel').textContent = 'Concluído';

  if (efinPendentes.length > 0) {
    document.getElementById('efinAvisoLista').textContent =
      'Consulte a Caixa Postal do eCAC quando disponível:\n' + efinPendentes.join('\n');
    document.getElementById('efinAviso').classList.add('show');
  }

  log('Automação concluída. Verifique a Caixa Postal do eCAC.', 'ok');
}

function parar() {
  pararFlag = true;
  log('Solicitando parada...', 'warn');
}

function limpar() {
  dadosCarregados = null;
  executando = false;
  pararFlag = false;
  document.getElementById('uploadArea').classList.remove('has-file');
  document.getElementById('fileName').textContent = '';
  document.getElementById('fileInput').value = '';
  document.getElementById('resumo').classList.remove('show');
  document.getElementById('progressWrap').classList.remove('show');
  document.getElementById('log').classList.remove('show');
  document.getElementById('efinAviso').classList.remove('show');
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('log').innerHTML = '';
  document.getElementById('btnExecutar').disabled = true;
  document.getElementById('btnExecutar').style.display = 'block';
  document.getElementById('btnLimpar').style.display = 'none';
}

// ── Helpers ────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function log(msg, tipo) {
  const panel = document.getElementById('log');
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const linha = document.createElement('div');
  linha.className = 'log-line';
  linha.innerHTML = `<span class="log-ts">${escapeHtml(now)}</span><span class="log-msg ${tipo || ''}">${escapeHtml(msg)}</span>`;
  panel.appendChild(linha);
  panel.scrollTop = panel.scrollHeight;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function salvarRespostas() {
  const tabs = await chrome.tabs.query({ url: 'https://cav.receita.fazenda.gov.br/*' });
  if (tabs.length === 0) {
    alert('Abra o eCAC e faça login antes de salvar respostas.');
    return;
  }

  const config = await new Promise(r =>
    chrome.storage.local.get('infojob_config', res => r(res.infojob_config))
  );

  // Salva comando no storage e navega para caixa postal
  await chrome.storage.local.set({
    infojob_executando:      true,
    infojob_etapa:           'caixa_postal_todas',
    infojob_fila:            null,
    infojob_idx:             0,
    infojob_config:          config
  });

  // Navega para caixa postal
  chrome.tabs.update(tabs[0].id, {
    url: 'https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=00006',
    active: true
  });

  window.close();
}

function abrirConfig() {
  chrome.runtime.openOptionsPage();
}

function pararAutomacao() {
  if (!confirm('Deseja parar a automação em andamento?')) return;
  chrome.storage.local.set({ 
    infojob_executando: false,
    infojob_fila: null,
    infojob_idx: 0,
    infojob_etapa: 'registrar'
  }, () => {
    document.getElementById('btnParar').style.display = 'none';
    log('Automação interrompida pelo usuário.', 'warn');
    // Notifica o content script
    chrome.tabs.query({ url: 'https://cav.receita.fazenda.gov.br/*' }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { acao: 'parar' });
      }
    });
  });
}

// ── Exibe resultado da automação ───────────────────────────────
function exibirResultado(sucesso, erros) {
  const panel = document.getElementById('log');
  panel.innerHTML = '';
  panel.classList.add('show');

  const total = sucesso.length + erros.length;

  // Cabeçalho
  const titulo = document.createElement('div');
  titulo.className = 'log-line';
  titulo.innerHTML = `<span class="log-msg ok">✅ Automação concluída — ${escapeHtml(String(total))} parte(s) processada(s)</span>`;
  panel.appendChild(titulo);

  // Sucessos
  if (sucesso.length > 0) {
    const hdr = document.createElement('div');
    hdr.className = 'log-line';
    hdr.innerHTML = `<span class="log-msg ok">✔ ${escapeHtml(String(sucesso.length))} enviado(s) com sucesso:</span>`;
    panel.appendChild(hdr);
    sucesso.forEach(p => {
      const linha = document.createElement('div');
      linha.className = 'log-line';
      linha.innerHTML = `<span class="log-msg">  · ${escapeHtml(p.nome)} — ${escapeHtml(p.processo)}</span>`;
      panel.appendChild(linha);
    });
  }

  // Erros
  if (erros.length > 0) {
    const hdr = document.createElement('div');
    hdr.className = 'log-line';
    hdr.innerHTML = `<span class="log-msg warn">⚠ ${escapeHtml(String(erros.length))} com erro:</span>`;
    panel.appendChild(hdr);
    erros.forEach(p => {
      const linha = document.createElement('div');
      linha.className = 'log-line';
      linha.innerHTML = `<span class="log-msg err">  · ${escapeHtml(p.nome)} — ${escapeHtml(p.processo)}<br>&nbsp;&nbsp;&nbsp;${escapeHtml(p.erro || '')}</span>`;
      panel.appendChild(linha);
    });
  }

  // Lembrete caixa postal
  const aviso = document.createElement('div');
  aviso.className = 'log-line';
  aviso.innerHTML = `<span class="log-msg info">📥 Quando as respostas chegarem, clique em "Salvar respostas".</span>`;
  panel.appendChild(aviso);

  panel.scrollTop = panel.scrollHeight;
}