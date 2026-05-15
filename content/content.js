// content.js — InfoJOB v2.2.0
// Executa dentro do contexto da página eCAC

if (window.__infojobAtivo) {
  throw new Error('InfoJOB: script já ativo, ignorando reinjeção.');
}
window.__infojobAtivo = true;

(function() {
var INFOJUD_URL      = 'https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=5032&origem=menu';
var INFOJUD_REG_BASE = 'https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/solicitacao.asp';
var CAIXA_POSTAL_URL = 'https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=00006';

// Intercepta alerts para não travar
var alertOriginal = window.alert.bind(window);
window.alert = function(msg) {
  console.warn('InfoJOB: alert interceptado (eCAC):', msg);
  // Notifica o background para logar — não exibe o popup para o usuário
  chrome.runtime.sendMessage({ acao: 'iframe_alert', texto: msg || '' });
};

console.log('InfoJOB v2.2.0 | URL:', window.location.href);

// ── Listeners ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.acao === 'ping') { sendResponse({ ok: true }); return false; }

  if (msg.acao === 'parar') { sendResponse({ ok: true }); return false; }
  if (msg.acao === 'iniciar_automacao') {
    chrome.storage.local.set({
      infojob_fila:       msg.partes,
      infojob_config:     msg.config,
      infojob_idx:        0,
      infojob_etapa:      'registrar',
      infojob_executando: true
    }, () => {
      sendResponse({ ok: true, total: msg.partes.length });
      setTimeout(verificarEExecutar, 500);
    });
    return true;
  }
});

// ── Ponto de entrada ───────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(verificarEExecutar, 800));
} else {
  setTimeout(verificarEExecutar, 800);
}



async function verificarEExecutar() {
  const data = await storageGet([
    'infojob_executando','infojob_fila','infojob_config',
    'infojob_idx','infojob_etapa','infojob_url_registro',
    'infojob_sucesso','infojob_erros',
    'infojob_lote_pedidos','infojob_lote_offset'
  ]);
  if (!data.infojob_executando) return;

  const url   = window.location.href;
  const etapa = data.infojob_etapa || 'registrar';

  // ── ETAPA CAIXA POSTAL ────────────────────────────────────────
  if (etapa === 'caixa_postal_todas') {
    console.log('InfoJOB: etapa caixa_postal_todas — iniciando');
    try {
      await processarTodasNaoLidas(data.infojob_config || {});
    } catch(e) {
      console.error('InfoJOB: erro ao salvar respostas:', e.message);
      exibirModalCaixaPostal(0, e.message);
    }
    await storageSet({ infojob_executando: false });
    return;
  }

  // ── ETAPA REGISTRAR ───────────────────────────────────────────
  if (!data.infojob_fila) return;

  const idx   = data.infojob_idx || 0;
  const total = data.infojob_fila.length;

  // Página de confirmação — clica Voltar e aguarda navegação
  if (url.includes('msgsolicitacao.asp')) {
    console.log('InfoJOB: página de confirmação detectada, clicando Voltar...');
    await sleep(1500);
    const btnVoltar = document.querySelector('input[name="acao"][value="Voltar"]');
    if (btnVoltar) btnVoltar.click();
    else window.history.back();
    return;
  }

  if (idx >= total) {
    await storageSet({ infojob_executando: false, infojob_resultado_pendente: true });
    await salvarLogTxt('envio', data.infojob_sucesso || [], data.infojob_erros || [], data.infojob_config);
    await new Promise(r => chrome.storage.local.clear(r));
    exibirModalResultado(data.infojob_sucesso || [], data.infojob_erros || []);
    return;
  }

  const parte  = data.infojob_fila[idx];
  const config = data.infojob_config;

  console.log('InfoJOB: [' + (idx+1) + '/' + total + '] etapa=' + etapa + ' | ' + parte.nomeAbrev);

  if (etapa === 'registrar') {
    if (!url.includes('solicitacao.asp')) {
      const urlReg = data.infojob_url_registro || INFOJUD_REG_BASE;
      window.location.href = urlReg;
      return;
    }

    try {
      // Valida CPF (11 dígitos) ou CNPJ (14 dígitos) antes de enviar
      const niLen = (parte.ni || '').replace(/\D/g, '').length;
      if ((parte.tipo === 'CPF' && niLen !== 11) || (parte.tipo === 'CNPJ' && niLen !== 14)) {
        console.warn('InfoJOB: NI inválido, pulando:', parte.ni, '(' + parte.tipo + ' com ' + niLen + ' dígitos)');
        const erros = data.infojob_erros || [];
        erros.push({ processo: parte.processo, nome: parte.nomeAbrev, erro: parte.tipo + ' inválido: ' + parte.ni });
        await storageSet({ infojob_erros: erros, infojob_idx: idx + 1, infojob_etapa: 'registrar', infojob_lote_pedidos: null, infojob_lote_offset: 0 });
        window.location.reload();
        return;
      }

      // ── Lógica de lotes de 10 ──────────────────────────────────
      // Na primeira passagem pela parte, gera a lista completa de pedidos
      // e salva no storage. Nas passagens seguintes (lotes 2, 3...), retoma
      // do offset salvo sem regerar a lista.

      const LOTE_MAX = 10;
      let pedidosFila = data.infojob_lote_pedidos || null;
      let loteOffset  = data.infojob_lote_offset  || 0;

      if (!pedidosFila) {
        // Primeira vez nessa parte — gera lista completa de pedidos
        console.log('InfoJOB Xtreme: gerando lista de pedidos para', parte.nomeAbrev);
        pedidosFila = await gerarListaPedidos(parte, config);
        loteOffset  = 0;
        console.log('InfoJOB Xtreme: total de pedidos:', pedidosFila.length);
      }

      const loteAtual = pedidosFila.slice(loteOffset, loteOffset + LOTE_MAX);
      const proximoOffset = loteOffset + loteAtual.length;
      const temMaisLotes  = proximoOffset < pedidosFila.length;

      console.log('InfoJOB Xtreme: lote ' + (Math.floor(loteOffset/LOTE_MAX)+1) +
        ' — pedidos ' + (loteOffset+1) + ' a ' + proximoOffset + ' de ' + pedidosFila.length);

      await preencherCabecalho(parte, config);
      await incluirPedidosDaFila(loteAtual);

      // Captura nome oficial do eCAC após primeiro pedido incluído
      // (só no lote 1 — nos seguintes o nome já está salvo)
      if (loteOffset === 0) {
        const nomeEcac = extrairNomeEcac();
        if (nomeEcac) {
          parte.nomeAbrev = nomeEcac;
          console.log('InfoJOB: nome capturado do eCAC:', nomeEcac);
        }
      }

      if (temMaisLotes) {
        // Ainda há mais lotes para essa parte — salva offset e envia
        // Ao voltar (msgsolicitacao.asp → solicitacao.asp) vai retomar aqui
        await storageSet({
          infojob_lote_pedidos: pedidosFila,
          infojob_lote_offset:  proximoOffset
          // NÃO avança infojob_idx — ainda é a mesma parte
        });
        console.log('InfoJOB Xtreme: enviando lote, próximo offset:', proximoOffset);
      } else {
        // Último (ou único) lote dessa parte — avança para a próxima
        const sucesso = data.infojob_sucesso || [];
        sucesso.push({ processo: parte.processo, nome: parte.nomeAbrev });
        await storageSet({
          infojob_sucesso:      sucesso,
          infojob_idx:          idx + 1,
          infojob_etapa:        'registrar',
          infojob_lote_pedidos: null,
          infojob_lote_offset:  0
        });
        console.log('InfoJOB Xtreme: último lote da parte, avançando índice');
      }

      await clicarEnviar();

    } catch(e) {
      console.error('InfoJOB: erro no registro:', e.message);
      const erros = data.infojob_erros || [];
      erros.push({ processo: parte.processo, nome: parte.nomeAbrev, erro: e.message });
      await storageSet({ infojob_erros: erros, infojob_idx: idx + 1, infojob_etapa: 'registrar', infojob_lote_pedidos: null, infojob_lote_offset: 0 });
      await sleep(1000);
      await verificarEExecutar();
    }
  }
}

// ══════════════════════════════════════════════════════════════
// CAIXA POSTAL v2.1.7 — tabela HTML convencional
// Estrutura real observada:
//   Colunas: Ações | Remetente | Assunto | Enviada em |
//            Exibição até | Data de 1ª leitura | ID Mensagem | Tipo
//   Filtro "Não lidas N" é um botão com texto iniciando em "Não lidas"
//   Link do assunto: <a> dentro da 3ª coluna (índice 2)
//   Número do processo: últimos 20 dígitos no texto do assunto
// ══════════════════════════════════════════════════════════════
async function processarTodasNaoLidas(config) {
  const url = window.location.href;

  // 1. Navega para caixa postal se necessário
  if (!url.includes('id=00006')) {
    console.log('InfoJOB: navegando para Caixa Postal...');
    window.location.href = CAIXA_POSTAL_URL;
    return;
  }

  // 2. Aguarda iframe carregar e content_iframe.js estar pronto (até 20s)
  console.log('InfoJOB: aguardando iframe da Caixa Postal...');
  let iframeOk = false;
  for (let t = 0; t < 40; t++) {
    const resp = await msgIframe({ acao: 'iframe_ping' });
    if (resp && resp.ok) { iframeOk = true; break; }
    await sleep(500);
  }
  if (!iframeOk) {
    console.warn('InfoJOB: iframe não respondeu em 20s');
    exibirModalCaixaPostal(0, 'Página não carregou corretamente. Tente novamente.');
    return;
  }
  console.log('InfoJOB: iframe pronto');

  // 3. Filtro "Não lidas" + Exibir 100 — fire and forget com sleep generoso
  msgIframe({ acao: 'iframe_clicar_nao_lidas' });
  await sleep(4000);

  msgIframe({ acao: 'iframe_exibir_100' });
  await sleep(4000);

  msgIframe({ acao: 'iframe_clicar_nao_lidas' });
  await sleep(5000);

  // 6. Conta não lidas pelo badge
  const respTotal = await msgIframe({ acao: 'iframe_contar_nao_lidas' });
  const totalNaoLidas = respTotal?.total || 0;
  console.log('InfoJOB: total de não lidas:', totalNaoLidas);

  if (totalNaoLidas === 0) {
    exibirModalCaixaPostal(0, null);
    return;
  }

  criarModalProgresso();
  atualizarModalProgresso(0, 'Carregando lista de mensagens...');

  let processadas = 0;
  let erros       = 0;
  const sucessosColeta = [];
  const errosColeta    = [];

  for (let tentativa = 0; tentativa < totalNaoLidas + 2; tentativa++) {
    // Clica na primeira mensagem não lida (retorna titulo e href)
    const respMsg = await msgIframe({ acao: 'iframe_primeira_nao_lida' });

    if (!respMsg || !respMsg.ok) {
      console.log('InfoJOB: nenhuma mensagem não lida restante. Total:', processadas);
      break;
    }

    const textoAssunto = respMsg.titulo || '';
    const numProcesso  = extrairNumProcesso(textoAssunto);

    console.log('InfoJOB: [' + (processadas+1) + '/' + totalNaoLidas + '] abrindo:', textoAssunto.substring(0, 70));
    atualizarModalProgresso(processadas, textoAssunto);

    await sleep(3500);

    try {
      // Clica no link de consulta dentro da mensagem
      const respConsulta = await msgIframe({ acao: 'iframe_clicar_consulta' });

      if (respConsulta && respConsulta.ok) {
        console.log('InfoJOB: link consulta clicado:', respConsulta.href);
        await sleep(4000);

        const parteMin = { processo: numProcesso, nomeAbrev: 'RESP', ni: '' };
        await baixarPDFsResultado(parteMin, config);
        processadas++;
        sucessosColeta.push({ processo: numProcesso, nome: textoAssunto.substring(0, 60) });
      } else {
        console.warn('InfoJOB: link de consulta não encontrado na mensagem');
        erros++;
        errosColeta.push({ processo: numProcesso, nome: textoAssunto.substring(0, 60), erro: 'Link de consulta não encontrado' });
      }
    } catch(e) {
      console.error('InfoJOB: erro ao processar mensagem:', e.message);
      erros++;
      errosColeta.push({ processo: numProcesso, nome: textoAssunto.substring(0, 60), erro: e.message });
    }

    // Volta para a lista — força src do iframe diretamente do documento principal
    const iframePrincipal = document.querySelector('iframe#frmApp');
    if (iframePrincipal) {
      iframePrincipal.src = 'https://www3.cav.receita.fazenda.gov.br/caixapostal/';
      console.log('InfoJOB: iframe redirecionado para caixapostal');
    }
    await sleep(5000);
    // Reaplica filtro não lidas
    msgIframe({ acao: 'iframe_clicar_nao_lidas' });
    await sleep(4000);
  }

  // Resultado final
  await salvarLogTxt('coleta', sucessosColeta, errosColeta, config);
  await new Promise(r => chrome.storage.local.clear(r));
  exibirModalCaixaPostal(
    processadas,
    erros > 0 ? erros + ' mensagem(ns) não puderam ser processadas' : null
  );
}

// ── Encontra a 1ª mensagem INFOJUD não lida na lista ──────────
// Estrutura real confirmada:
//   datatable-body-row
//     datatable-body-cell[0] ações      width:60px
//     datatable-body-cell[1] remetente  width:200px
//     datatable-body-cell[2] assunto    width:323px — contém <a class="small-txt" href="/caixapostal/mensagens/ID">
//     datatable-body-cell[3] enviada em
//     datatable-body-cell[4] exibição até
//     datatable-body-cell[5] data 1ª leitura  → "-" = não lida
//     datatable-body-cell[6] ID mensagem
//     datatable-body-cell[7] tipo
async function encontrarPrimeiraMensagemNaoLida() {
  // Aguarda linhas aparecerem
  for (let t = 0; t < 15; t++) {
    const rows = document.querySelectorAll('datatable-body-row');
    if (rows.length > 0) break;
    await sleep(600);
  }

  const rows = qsAll('datatable-body-row');
  for (const row of rows) {
    const cels = row.querySelectorAll('datatable-body-cell');
    if (cels.length < 6) continue;

    // Índice 5 = "Data de 1ª leitura" — "-" ou vazio = não lida
    const dataLeitura = (cels[5]?.textContent || '').trim();
    const naoLida     = dataLeitura === '-' || dataLeitura === '';
    if (!naoLida) continue;

    // Índice 2 = assunto — link <a class="small-txt">
    const link = cels[2]?.querySelector('a.small-txt') || cels[2]?.querySelector('a');
    if (!link) continue;

    // Confirma que é INFOJUD
    const titulo = (link.title || link.textContent || '').toUpperCase();
    if (!titulo.includes('INFOJUD')) continue;

    return link;
  }

  return null;
}

// ── Conta não lidas pelo badge do botão "Não lidas N" ─────────
// Estrutura real:
//   <button title="Filtrar apenas não lidas" class="btn-prefilter">
//     " Não lidas "
//     <span class="badge badge-light">3</span>
//     <span class="sr-only">apenas não lidas</span>
//   </button>
function contarNaoLidasDoBadge() {
  const btn = qs('button[title="Filtrar apenas não lidas"]');
  if (!btn) return 0;
  const badge = btn.querySelector('span.badge');
  if (badge) {
    const n = parseInt(badge.textContent.trim(), 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

// ── Extrai número de processo do assunto ──────────────────────
// Formato: "disponível: 20260506005291/00000905020265180008"
// ou número formatado: 0000000-00.0000.0.00.0000
function extrairNumProcesso(texto) {
  // Tenta número de 20 dígitos (formato eCAC: AAAAMMDDNNNNN/NNNNNNNNNNNNNNNN)
  const m20 = texto.match(/(\d{20})/);
  if (m20) return m20[1];

  // Tenta número com separador "/"
  const mBarra = texto.match(/(\d{5,}\/\d{5,})/);
  if (mBarra) return mBarra[1].replace(/\D/g, '');

  // Tenta formato CNJ: 0000000-00.0000.0.00.0000
  const mCNJ = texto.match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
  if (mCNJ) return mCNJ[1].replace(/\D/g, '');

  // Tenta qualquer sequência de 15+ dígitos
  const mLong = texto.match(/(\d{15,})/);
  if (mLong) return mLong[1];

  return 'proc_' + Date.now();
}

// ── Clica no filtro "Não lidas" ────────────────────────────────
// Botão: <button title="Filtrar apenas não lidas" class="btn btn-prefilter ...">
async function clicarNaoLidas() {
  const btn = qs('button[title="Filtrar apenas não lidas"]');
  if (btn) {
    console.log('InfoJOB: clicando filtro Não lidas');
    btn.click();
    return true;
  }
  console.log('InfoJOB: filtro Não lidas não encontrado — exibindo todas');
  return false;
}

// ── Muda "Exibir" para 100 itens por página ────────────────────
// ng-select está no documento PRINCIPAL (não no iframe)
// Opções confirmadas: 10, 20, 50, 100
async function setExibir100() {
  // Verifica se já está em 100
  const labelAtual = document.querySelector('span.ng-value-label');
  if (labelAtual && labelAtual.textContent.trim() === '100') {
    console.log('InfoJOB: Exibir já está em 100');
    return;
  }

  // Abre o ng-select clicando no container
  const container = document.querySelector('.ng-select-container');
  if (!container) { console.warn('InfoJOB: ng-select não encontrado'); return; }
  container.click();
  await sleep(800);

  // Aguarda dropdown abrir e clica na opção "100"
  for (let t = 0; t < 10; t++) {
    const opcoes = Array.from(document.querySelectorAll('ng-dropdown-panel .ng-option, [role="option"]'));
    const op100  = opcoes.find(o => o.textContent.trim() === '100');
    if (op100) {
      op100.click();
      console.log('InfoJOB: Exibir alterado para 100');
      await sleep(1000);
      return;
    }
    await sleep(300);
  }

  // Fecha sem selecionar
  document.body.click();
  console.warn('InfoJOB: opção 100 não encontrada no ng-select');
}

// ── Aguarda link de consulta dentro da mensagem aberta ────────
// URL confirmada: resultadoSolicitacao.asp?numeroSolicitacao=XXXXX
async function aguardarLinkConsulta(timeout) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeout) {
    const link = document.querySelector('a[href*="resultadoSolicitacao"]');
    if (link) return link;
    await sleep(500);
  }
  return null;
}

// ── Volta para a lista da Caixa Postal ────────────────────────
async function voltarParaLista() {
  // 1. Breadcrumb "Lista de Mensagens"
  const breadcrumb = Array.from(document.querySelectorAll('a, span[role="link"]'))
    .find(e => /lista de mensagens/i.test(e.textContent));
  if (breadcrumb) { breadcrumb.click(); return; }

  // 2. Link direto para caixa postal
  const linkCP = document.querySelector('a[href*="id=00006"]');
  if (linkCP) { linkCP.click(); return; }

  // 3. Botão Voltar genérico
  const btnVoltar = document.querySelector('[aria-label="Voltar"], button[class*="voltar"]');
  if (btnVoltar) { btnVoltar.click(); return; }

  // 4. Fallback: navega diretamente
  window.location.href = CAIXA_POSTAL_URL;
}

// ── Envia mensagem ao iframe via background (cross-origin) ───────
function msgIframe(payload) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ acao: 'msg_para_iframe', payload }, resp => {
      if (chrome.runtime.lastError) resolve({ ok: false, erro: chrome.runtime.lastError.message });
      else resolve(resp || { ok: false });
    });
  });
}

// ── Aguarda botão "Filtrar apenas não lidas" aparecer (doc ou iframe) ──
async function aguardarBotaoNaoLidas(timeout) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeout) {
    const btn = qs('button[title="Filtrar apenas não lidas"]');
    if (btn) return btn;
    await sleep(400);
  }
  return null;
}

// ── Fecha modal/overlay se presente ───────────────────────────
async function fecharModalSeExistir() {
  const seletores = [
    'button[aria-label="Fechar modal"]',
    'button[aria-label="Fechar"]',
    'button.br-button.circle.small',
    '[class*="modal"] button[class*="close"]'
  ];
  for (const sel of seletores) {
    const btn = document.querySelector(sel);
    if (btn) { btn.click(); await sleep(600); return; }
  }
}

// ── Aguarda elemento aparecer no DOM ──────────────────────────
function aguardarElemento(seletor, timeout) {
  return new Promise(resolve => {
    const el = document.querySelector(seletor);
    if (el) { resolve(el); return; }
    const obs = new MutationObserver(() => {
      const found = document.querySelector(seletor);
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, timeout || 5000);
  });
}

// ── Baixar/imprimir todos os itens do resultado da solicitação ─
// Comunicação com iframe via msgIframe (cross-origin)
async function baixarPDFsResultado(parte, config) {
  await sleep(1500);

  // Busca lista de itens do resultado via iframe
  const respItens = await msgIframe({ acao: 'iframe_clicar_lupa' });
  if (!respItens || !respItens.ok || !respItens.itens?.length) {
    console.warn('InfoJOB: nenhum item encontrado no resultado');
    return;
  }

  // Nome do contribuinte capturado pelo iframe (fallback: parte.nomeAbrev)
  const nomeContrib = doisPrimeirosNomes(respItens.nomeContrib || parte.nomeAbrev || 'RESP');
  const niContrib   = (respItens.niContrib || '').trim();
  const numProcesso = (parte.processo || '').replace(/\D/g, '');

  // Move DOI para o final — evita que a navegação do DOI quebre os itens seguintes
  const itensOrdenados = [
    ...respItens.itens.filter(i => i.tipo !== 'DOI'),
    ...respItens.itens.filter(i => i.tipo === 'DOI')
  ];

  console.log('InfoJOB: itens encontrados:', itensOrdenados.length, '| nome:', nomeContrib);

  for (const item of itensOrdenados) {
    const { tipo, anoData, onclick } = item;
    console.log('InfoJOB: processando', tipo, anoData);

    // Monta filename padrão: NUMERODOPROCESSO_NOME SOBRENOME TIPOCONSULTA.pdf
    const tipoLabel = (tipo === 'DOI') ? 'DOI' : tipo + (anoData ? ' ' + anoData.trim() : '');
    const filename  = numProcesso + '_' + nomeContrib + ' ' + tipoLabel + '.pdf';

    if (tipo === 'DOI') {
      // DOI é processado por último — navega no iframe mas não precisa voltar
      chrome.runtime.sendMessage({ acao: 'definir_proximo_filename', filename });
      await msgIframe({ acao: 'iframe_submeter_item', onclick, forceSelf: true });
      await Promise.race([
        aguardarDownloadIniciado(15000),
        sleep(15000)
      ]);
      await sleep(5000); // aguarda download estabilizar antes de encerrar

    } else if (tipo === 'DITR' || tipo.startsWith('DIPJ')) {
      // DITR e DIPJ/PJ Simples — carrega página e gera PDF informativo
      await msgIframe({ acao: 'iframe_submeter_item', onclick, forceSelf: false });
      await sleep(4000);
      console.log('InfoJOB: enviando iframe_gerar_pdf_ditr para', tipo, '...');
      await msgIframe({
        acao: 'iframe_gerar_pdf_ditr',
        anoData,
        ni: onclick.match(/ni=([^&]+)/)?.[1] || niContrib,
        niFormatado: niContrib,
        tipoNi: onclick.match(/tipoNi=([^&]+)/)?.[1] || '1',
        filename: numProcesso + '_' + nomeContrib + ' ' + tipoLabel + '.pdf',
        tituloOverride: tipo === 'DITR' ? 'DITR' : 'DIPJ / PJ Simples'
      });
      await aguardarDownloadIniciado(10000);
      msgIframe({ acao: 'iframe_history_back' }); // fire-and-forget
      await sleep(3000);

    } else if (tipo === 'INFO. CADASTRAIS') {
      // Mesmo comportamento do DITR — carrega página e gera PDF informativo
      await msgIframe({ acao: 'iframe_submeter_item', onclick, forceSelf: false });
      await sleep(4000);
      console.log('InfoJOB: enviando iframe_gerar_pdf_ditr para Info.Cadastrais...');
      await msgIframe({
        acao: 'iframe_gerar_pdf_ditr',
        anoData: anoData || '',
        ni: onclick.match(/ni=([^&]+)/)?.[1] || niContrib,
        niFormatado: niContrib,
        tipoNi: onclick.match(/tipoNi=([^&]+)/)?.[1] || '1',
        filename: numProcesso + '_' + nomeContrib + ' INFO CADASTRAIS.pdf',
        tituloOverride: 'Informacoes Cadastrais'
      });
      await aguardarDownloadIniciado(10000);
      msgIframe({ acao: 'iframe_history_back' }); // fire-and-forget
      await sleep(3000);

    } else if (tipo === 'EFINANCEIRA' || (!onclick && item.href)) {
      // Download via href direto (eFinanceira, ECF, DIPJ/PJ Simples, etc.)
      const filenameExt = tipo === 'EFINANCEIRA' ? '.zip' : '.pdf';
      const filenameCompleto = numProcesso + '_' + nomeContrib + ' ' + tipoLabel + filenameExt;
      chrome.runtime.sendMessage({ acao: 'definir_proximo_filename', filename: filenameCompleto, aguardaVisualizarDeclaracao: false });
      await msgIframe({ acao: 'iframe_clicar_href', href: item.href });
      await Promise.race([
        aguardarDownloadIniciado(15000),
        sleep(15000)
      ]);
      await sleep(1000);

    } else {
      // DIRPF, DECRED, DIMOB — submit normal via form
      const filenameCompleto = numProcesso + '_' + nomeContrib + ' ' + tipoLabel + '.pdf';
      chrome.runtime.sendMessage({ acao: 'definir_proximo_filename', filename: filenameCompleto, aguardaVisualizarDeclaracao: true });
      await msgIframe({ acao: 'iframe_submeter_item', onclick, forceSelf: false });
      await Promise.race([
        aguardarDownloadIniciado(12000),
        sleep(12000)
      ]);
      await sleep(1000);
    }
  }

  console.log('InfoJOB: todos os itens processados');
}

// ══════════════════════════════════════════════════════════════
// MODAL DE PROGRESSO — Caixa Postal
// ══════════════════════════════════════════════════════════════
function criarModalProgresso() {
  const anterior = document.getElementById('infojob-cp-modal');
  if (anterior) return; // já existe

  const overlay = document.createElement('div');
  overlay.id = 'infojob-cp-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    font-family: Arial, sans-serif;
  `;
  overlay.innerHTML = `
    <div style="
      background: #fff; border-radius: 10px; padding: 24px 28px;
      max-width: 460px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      font-size: 13px; color: #1e293b;
    ">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:20px">📬</span>
        <span style="font-size:15px;font-weight:bold">InfoJOB — Caixa Postal</span>
        <span id="infojob-cp-spinner" style="margin-left:auto;font-size:18px">⏳</span>
      </div>
      <p id="infojob-cp-status" style="margin:0 0 8px;color:#334155">Iniciando...</p>
      <p id="infojob-cp-detalhe" style="margin:0;color:#64748b;font-size:11px;min-height:16px"></p>
      <div style="margin-top:14px;height:4px;background:#e2e8f0;border-radius:4px;overflow:hidden">
        <div id="infojob-cp-barra" style="height:100%;background:#1a56db;width:0%;transition:width 0.4s"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function atualizarModalProgresso(qtd, assunto) {
  criarModalProgresso();
  const status  = document.getElementById('infojob-cp-status');
  const detalhe = document.getElementById('infojob-cp-detalhe');
  if (status)  status.textContent  = qtd === 0
    ? 'Buscando mensagens não lidas...'
    : qtd + ' mensagem(ns) processada(s)';
  if (detalhe) detalhe.textContent = assunto ? assunto.substring(0, 70) : '';
}

function exibirModalCaixaPostal(processadas, erroMsg) {
  // Remove modal de progresso
  const prog = document.getElementById('infojob-cp-modal');
  if (prog) prog.remove();

  // Remove modal anterior se existir
  const ant = document.getElementById('infojob-modal');
  if (ant) ant.remove();

  const overlay = document.createElement('div');
  overlay.id = 'infojob-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
  `;

  const corStatus = processadas > 0 ? '#15803d' : '#b45309';
  const icone     = processadas > 0 ? '✅' : '⚠️';

  overlay.innerHTML = `
    <div style="
      background: #fff; border-radius: 10px; padding: 28px 32px;
      max-width: 480px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      font-family: Arial, sans-serif; font-size: 13px; color: #1e293b;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <span style="font-size:16px;font-weight:bold">InfoJOB — Caixa Postal</span>
        <button id="infojob-modal-fechar" style="
          border:none;background:none;font-size:20px;cursor:pointer;color:#64748b;line-height:1
        ">✕</button>
      </div>

      <p style="margin:0 0 12px;font-size:15px">
        ${icone} <strong style="color:${corStatus}">${processadas} resposta(s)</strong> salva(s) com sucesso.
      </p>

      ${erroMsg ? `
        <p style="margin:0 0 12px;padding:8px 12px;background:#fef3c7;border-radius:6px;color:#92400e;font-size:12px">
          ⚠ ${erroMsg}
        </p>
      ` : ''}

      ${processadas === 0 && !erroMsg ? `
        <p style="margin:0 0 12px;padding:8px 12px;background:#eff6ff;border-radius:6px;color:#1d4ed8;font-size:12px">
          ℹ Nenhuma mensagem INFOJUD não lida encontrada na Caixa Postal.
        </p>
      ` : ''}

      <p style="margin:0;color:#64748b;font-size:12px">
        Os PDFs foram enviados para a pasta configurada em <strong>Configurações → Pasta de saída</strong>.
      </p>
      <p style="margin:8px 0 0;padding:8px 12px;background:#f0fdf4;border-radius:6px;color:#166534;font-size:11px">
        🔒 Dados temporários de processamento removidos automaticamente.
      </p>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('infojob-modal-fechar').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ══════════════════════════════════════════════════════════════
// REGISTRO — funções originais mantidas
// ══════════════════════════════════════════════════════════════

async function preencherCabecalho(parte, config) {
  console.log('InfoJOB: preenchendo cabeçalho para', parte.nomeAbrev);
  await sleep(800);

  const inputProcesso = document.querySelector('input[name="processo"]');
  const selectTipo    = document.querySelector('select[name="tipos de processo"]');
  const selectVara    = document.querySelector('select[name="nomevara"], select[name="siglavara"]');
  const textarea      = document.querySelector('textarea');

  if (inputProcesso) { digitarTexto(inputProcesso, parte.processo.replace(/\D/g, '')); await sleep(300); }
  if (selectTipo)    { selecionarOpcaoTexto(selectTipo, config.processo.tipo); await sleep(300); }
  if (selectVara)    { selecionarOpcaoTexto(selectVara, config.processo.vara); await sleep(300); }
  if (textarea)      { textarea.value = config.processo.justificativa; textarea.dispatchEvent(new Event('change', { bubbles: true })); }

  console.log('InfoJOB: cabeçalho preenchido');
}

// ══════════════════════════════════════════════════════════════
// LOTES v1.0.0 — gera lista plana de pedidos e executa em lotes de 10
// ══════════════════════════════════════════════════════════════

async function lerAnosDoDropdown(tipo, qtd) {
  const selectTipo = document.querySelector('select[name="novotipo"]');
  if (!selectTipo) { console.warn('InfoJOB: select tipo não encontrado para', tipo); return []; }
  selecionarOpcaoTexto(selectTipo, tipo);
  await sleep(800); // aguarda o eCAC iniciar o carregamento dos anos
  for (let t = 0; t < 20; t++) {
    await sleep(500);
    const s = document.querySelector('select[name="novoano"]');
    if (!s) continue;
    const opts = Array.from(s.options);
    // Ainda carregando — aguarda
    if (opts.some(o => /carregando|loading/i.test(o.text))) continue;
    // Anos disponíveis — retorna
    const anos = opts.filter(o => /^\d{4}$/.test(o.text.trim())).map(o => o.text.trim());
    if (anos.length > 0) return anos.slice(0, qtd);
    // Select presente mas sem anos (- Ano - ou vazio) — tipo não disponível
    if (opts.length <= 1) {
      console.warn('InfoJOB: tipo sem anos disponíveis no eCAC:', tipo);
      return [];
    }
  }
  console.warn('InfoJOB: timeout ao carregar anos para', tipo);
  return [];
}

async function gerarListaPedidos(parte, config) {
  const c = parte.tipo === 'CPF' ? config.cpf : config.cnpj;
  const anoAtual = new Date().getFullYear();
  const lista = [];

  async function addAnos(tipo, qtd) {
    const anos = await lerAnosDoDropdown(tipo, qtd);
    if (anos.length === 0) console.warn('InfoJOB: nenhum ano disponível para', tipo);
    for (const ano of anos)
      lista.push({ tipo, opcoes: { ano }, ni: parte.ni });
  }

  if (parte.tipo === 'CPF') {
    if (c.dirpf?.ativo)   await addAnos('DIRPF', parseInt(c.dirpf.anos)||2);
    if (c.ditr?.ativo)    await addAnos('DITR', parseInt(c.ditr.anos)||1);
    if (c.doi?.ativo)     lista.push({ tipo: 'DOI', opcoes: { dataIni: c.doi.dataIni||'01/1980', dataFim: mesAnoCorrente() }, fonte: 'direto', ni: parte.ni });
    if (c.decred?.ativo)  await addAnos('DECRED', parseInt(c.decred.anos)||1);
    if (c.dimob?.ativo)   await addAnos('DIMOB', parseInt(c.dimob.anos)||1);
    if (c.infocad?.ativo) lista.push({ tipo: 'Info. Cadastrais', opcoes: {}, fonte: 'direto', ni: parte.ni });
    if (c.efin?.ativo) {
      const anos = parseInt(c.efin.anos)||1;
      for (let i = 1; i <= anos; i++) {
        const ano = anoAtual - i;
        lista.push({ tipo: 'eFinanceira', opcoes: Object.assign({}, c.efin, { dataIni: '01/'+ano, dataFim: '12/'+ano }), fonte: 'direto', ni: parte.ni });
      }
    }
  } else {
    if (c.dipj?.ativo)    await addAnos('DIPJ/PJ SIMPL', parseInt(c.dipj.anos)||1);
    if (c.ecf?.ativo)     await addAnos('ECF (Substitui IRPJ)', parseInt(c.ecf.anos)||1);
    if (c.ditr?.ativo)    await addAnos('DITR', parseInt(c.ditr.anos)||1);
    if (c.doi?.ativo)     lista.push({ tipo: 'DOI', opcoes: { dataIni: c.doi.dataIni||'01/1980', dataFim: mesAnoCorrente() }, fonte: 'direto', ni: parte.ni });
    if (c.decred?.ativo)  await addAnos('DECRED', parseInt(c.decred.anos)||1);
    if (c.dimob?.ativo)   await addAnos('DIMOB', parseInt(c.dimob.anos)||1);
    if (c.cpmf?.ativo && c.cpmf.dataIni && c.cpmf.dataFim)
      lista.push({ tipo: 'CPMF', opcoes: { dataIni: c.cpmf.dataIni, dataFim: c.cpmf.dataFim }, fonte: 'direto', ni: parte.ni });
    if (c.infocad?.ativo) lista.push({ tipo: 'Info. Cadastrais', opcoes: {}, fonte: 'direto', ni: parte.ni });
    if (c.efin?.ativo) {
      const anos = parseInt(c.efin.anos)||1;
      for (let i = 1; i <= anos; i++) {
        const ano = anoAtual - i;
        lista.push({ tipo: 'eFinanceira', opcoes: Object.assign({}, c.efin, { dataIni: '01/'+ano, dataFim: '12/'+ano }), fonte: 'direto', ni: parte.ni });
      }
    }
  }

  return lista;
}

async function incluirPedidosDaFila(lote) {
  for (const pedido of lote) {
    // Todos os pedidos têm ano concreto — chama direto
    await incluirPedido(pedido.ni, pedido.tipo, pedido.opcoes, false);
  }
}

async function incluirPedidosCPF(parte, config) {
  const ni = parte.ni;
  const c  = config.cpf;
  const anoAtual = new Date().getFullYear();

  if (c.dirpf?.ativo)   await incluirComAnos(ni, 'DIRPF',   parseInt(c.dirpf.anos)||2,   'dropdown');
  if (c.ditr?.ativo)    await incluirComAnos(ni, 'DITR',    parseInt(c.ditr.anos)||1,    'calculado', anoAtual);
  if (c.doi?.ativo)     await incluirPedido(ni, 'DOI',     { dataIni: c.doi.dataIni||'01/1980', dataFim: mesAnoCorrente() });
  if (c.decred?.ativo)  await incluirComAnos(ni, 'DECRED',  parseInt(c.decred.anos)||1,  'dropdown');
  if (c.dimob?.ativo)   await incluirComAnos(ni, 'DIMOB',   parseInt(c.dimob.anos)||1,   'dropdown');
  if (c.infocad?.ativo) await incluirPedido(ni, 'Info. Cadastrais', {});
  if (c.efin?.ativo)    await incluirEFinanceira(ni, c.efin, parseInt(c.efin.anos)||1);
}

async function incluirPedidosCNPJ(parte, config) {
  const ni = parte.ni;
  const c  = config.cnpj;
  const anoAtual = new Date().getFullYear();

  if (c.dipj?.ativo)    await incluirComAnos(ni, 'DIPJ/PJ SIMPL',        parseInt(c.dipj.anos)||1,   'dropdown');
  if (c.ecf?.ativo)     await incluirComAnos(ni, 'ECF (Substitui IRPJ)', parseInt(c.ecf.anos)||1,    'dropdown');
  if (c.ditr?.ativo)    await incluirComAnos(ni, 'DITR',                 parseInt(c.ditr.anos)||1,   'calculado', anoAtual);
  if (c.doi?.ativo)     await incluirPedido(ni, 'DOI',     { dataIni: c.doi.dataIni||'01/1980', dataFim: mesAnoCorrente() });
  if (c.decred?.ativo)  await incluirComAnos(ni, 'DECRED',  parseInt(c.decred.anos)||1,  'dropdown');
  if (c.dimob?.ativo)   await incluirComAnos(ni, 'DIMOB',   parseInt(c.dimob.anos)||1,   'dropdown');
  if (c.cpmf?.ativo && c.cpmf.dataIni && c.cpmf.dataFim)
    await incluirPedido(ni, 'CPMF', { dataIni: c.cpmf.dataIni, dataFim: c.cpmf.dataFim });
  if (c.infocad?.ativo) await incluirPedido(ni, 'Info. Cadastrais', {});
  if (c.efin?.ativo)    await incluirEFinanceira(ni, c.efin, parseInt(c.efin.anos)||1);
}

async function incluirEFinanceira(ni, efin, anos) {
  // Gera um pedido por ano, do mais recente para o mais antigo
  // Sempre usa anos completos anteriores ao atual (01/AAAA a 12/AAAA)
  const anoAtual = new Date().getFullYear();
  for (let i = 1; i <= anos; i++) {
    const ano = anoAtual - i;
    const opcoes = Object.assign({}, efin, {
      dataIni: '01/' + ano,
      dataFim: '12/' + ano
    });
    console.log('InfoJOB: eFinanceira ano', ano, '(' + i + '/' + anos + ')');
    await incluirPedido(ni, 'eFinanceira', opcoes);
  }
}

async function incluirComAnos(ni, tipo, qtd, fonte, anoBase) {
  if (fonte === 'calculado') {
    for (let i = 1; i <= qtd; i++) {
      await incluirPedido(ni, tipo, { ano: String(anoBase - i) });
    }
    return;
  }

  const selectTipo = document.querySelector('select[name="novotipo"]');
  const selectAno  = document.querySelector('select[name="novoano"]');
  if (!selectTipo || !selectAno) { console.warn('InfoJOB: selects não encontrados para', tipo); return; }

  selecionarOpcaoTexto(selectTipo, tipo);

  let anos = [];
  for (let t = 0; t < 25; t++) {
    await sleep(400);
    const s = document.querySelector('select[name="novoano"]');
    if (!s) continue;
    if (s.disabled) continue;
    const opts = Array.from(s.options);
    const carregando = opts.some(o => /carregando|loading/i.test(o.text));
    anos = opts.filter(o => /^\d{4}$/.test(o.text.trim())).map(o => o.text.trim());
    if (!carregando && anos.length > 0) break;
  }

  if (anos.length === 0) { console.warn('InfoJOB: nenhum ano para', tipo, '— pulando'); return; }

  for (const ano of anos.slice(0, qtd)) {
    await incluirPedido(ni, tipo, { ano }, true);
  }
}

async function incluirPedido(ni, tipo, opcoes, tipoJaSelecionado) {
  console.log('InfoJOB: incluindo', tipo, opcoes.ano || opcoes.dataIni || '');

  const inputNI    = document.querySelector('input[name="novocpfcnpj"]');
  const selectTipo = document.querySelector('select[name="novotipo"]');
  const inputIni   = document.querySelector('input[name="novaDataInicio"]');
  const inputFim   = document.querySelector('input[name="novaDataFim"]');

  if (!inputNI || !selectTipo) { console.error('InfoJOB: campos não encontrados!'); return; }

  inputNI.value = '';
  digitarTexto(inputNI, ni);
  await sleep(300);

  if (!tipoJaSelecionado) {
    selecionarOpcaoTexto(selectTipo, tipo);
    await sleep(800);
  } else {
    await sleep(200);
  }

  if (opcoes.ano) {
    let selecionou = false;
    for (let t = 0; t < 20; t++) {
      await sleep(400);
      const s = document.querySelector('select[name="novoano"]');
      if (!s || s.disabled) continue;
      const temAno = Array.from(s.options).some(o => o.text.trim() === String(opcoes.ano));
      if (!temAno) continue;
      if (selecionarOpcaoTexto(s, String(opcoes.ano))) { selecionou = true; break; }
    }
    if (!selecionou) console.warn('InfoJOB: não conseguiu selecionar ano', opcoes.ano);
    await sleep(200);
  }

  if (opcoes.dataIni && inputIni) {
    inputIni.focus(); inputIni.value = opcoes.dataIni;
    inputIni.dispatchEvent(new Event('input', { bubbles: true }));
    inputIni.dispatchEvent(new Event('change', { bubbles: true }));
    inputIni.blur(); await sleep(200);
  }
  if (opcoes.dataFim && inputFim) {
    inputFim.focus(); inputFim.value = opcoes.dataFim;
    inputFim.dispatchEvent(new Event('input', { bubbles: true }));
    inputFim.dispatchEvent(new Event('change', { bubbles: true }));
    inputFim.blur(); await sleep(200);
  }

  if (tipo === 'eFinanceira') {
    await sleep(400);
    const sConta   = document.querySelector('select[name="novoTipoConta"]');
    const sRelacao = document.querySelector('select[name="novoTipoRelacao"]');
    const sCambio  = document.querySelector('select[name="novoInfoCambio"]');
    const sExtrato = document.querySelector('select[name="novoTipoExtrato"]');
    const iDataIni = document.querySelector('input[name="novaDataInicio"]');
    const iDataFim = document.querySelector('input[name="novaDataFim"]');
    if (sConta   && opcoes.conta)   selecionarOpcaoTexto(sConta,   opcoes.conta);
    if (sRelacao && opcoes.relacao) selecionarOpcaoTexto(sRelacao, opcoes.relacao);
    if (sCambio  && opcoes.cambio)  selecionarOpcaoTexto(sCambio,  opcoes.cambio);
    if (sExtrato && opcoes.extrato) selecionarOpcaoTexto(sExtrato, opcoes.extrato);
    if (iDataIni && opcoes.dataIni) {
      iDataIni.focus(); iDataIni.value = opcoes.dataIni;
      iDataIni.dispatchEvent(new Event('input',  { bubbles: true }));
      iDataIni.dispatchEvent(new Event('change', { bubbles: true }));
      iDataIni.blur();
    }
    if (iDataFim && opcoes.dataFim) {
      iDataFim.focus(); iDataFim.value = opcoes.dataFim;
      iDataFim.dispatchEvent(new Event('input',  { bubbles: true }));
      iDataFim.dispatchEvent(new Event('change', { bubbles: true }));
      iDataFim.blur();
    }
    await sleep(300);
  }

  if (pedidoJaIncluso(tipo, opcoes.ano, opcoes.dataIni)) {
    console.log('InfoJOB: pedido já existe na tabela:', tipo, opcoes.dataIni || opcoes.ano || '');
    return;
  }

  const linhasAntes = contarPedidosNaTabela();

  const btns = Array.from(document.querySelectorAll('input,button'))
    .filter(b => (b.value || b.textContent || '').trim().includes('Incluir Pedido'));
  if (btns.length === 0) { console.error('InfoJOB: botão Incluir Pedido não encontrado!'); return; }

  btns[btns.length - 1].click();

  let incluido = false;
  for (let t = 0; t < 15; t++) {
    await sleep(500);
    if (contarPedidosNaTabela() > linhasAntes) { incluido = true; break; }
  }
  if (!incluido) console.warn('InfoJOB: pedido não confirmado na tabela:', tipo);
}

function contarPedidosNaTabela() {
  return document.querySelectorAll('td.azulDireita, td.brancoDireita').length;
}

function pedidoJaIncluso(tipo, ano, dataIni) {
  const normalizar = s => s.toLowerCase().replace(/[\s\/\.\-]/g, '');
  const tipoNorm = normalizar(tipo).substring(0, 4);

  for (const tr of document.querySelectorAll('table tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 4) continue;
    const tipoNaTabela = normalizar(tds[2]?.textContent || '');
    const anoNaTabela  = (tds[3]?.textContent || '').trim();
    const bate = tipoNaTabela.startsWith(tipoNorm) || tipoNorm.startsWith(tipoNaTabela.substring(0, 4));
    if (bate) {
      // Para eFinanceira, compara também o período (dataIni) para permitir múltiplos anos
      if (dataIni) {
        if (anoNaTabela.includes(dataIni)) return true;
      } else if (!ano || anoNaTabela.includes(String(ano))) return true;
    }
  }
  return false;
}

async function clicarEnviar() {
  const btn = Array.from(document.querySelectorAll('input,button'))
    .find(b => (b.value || b.textContent || '').trim() === 'Enviar');
  if (!btn) { console.error('InfoJOB: botão Enviar não encontrado!'); return; }
  btn.click();
}

// ── Helpers ────────────────────────────────────────────────────
function digitarTexto(input, texto) {
  input.focus(); input.value = texto;
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
}

function selecionarOpcaoTexto(select, texto) {
  const t = texto.toLowerCase();
  for (const opt of select.options) {
    if (opt.text.toLowerCase().includes(t) || opt.value.toLowerCase().includes(t)) {
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  console.warn('InfoJOB: opção não encontrada em', select.name, ':', texto);
  return false;
}

// ── Log .txt ─────────────────────────────────────────────────
async function salvarLogTxt(tipo, sucesso, erros, config) {
  try {
    const agora = new Date();
    const dataStr = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR');
    const nomeArquivo = `InfoJOB_Log_${tipo}_${agora.toISOString().slice(0,10)}_${agora.toTimeString().slice(0,5).replace(':','h')}.txt`;

    let linhas = [];
    linhas.push(`InfoJOB v2.2.0 — Log de ${tipo === 'envio' ? 'Envio de Pedidos' : 'Coleta de Respostas'}`);
    linhas.push(`Data: ${dataStr}`);
    linhas.push('');

    if (sucesso.length > 0) {
      linhas.push(`SUCESSO (${sucesso.length}):`);
      sucesso.forEach(p => linhas.push(`  ${p.processo}`));
    } else {
      linhas.push('SUCESSO (0): nenhum registro.');
    }

    linhas.push('');

    if (erros.length > 0) {
      linhas.push(`ERRO (${erros.length}):`);
      erros.forEach(p => linhas.push(`  ${p.processo}${p.erro ? ' — ' + p.erro : ''}`));
    } else {
      linhas.push('ERRO (0): nenhum registro.');
    }

    const conteudo = linhas.join('\r\n');
    const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);

    const pastaBase = (config && config.pastaDestino) ? config.pastaDestino : 'INFOJUD';

    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        acao: 'download',
        url,
        filename: pastaBase + '/' + nomeArquivo,
        conflictAction: 'overwrite'
      }, resolve);
    });

    URL.revokeObjectURL(url);
    console.log('InfoJOB: log salvo —', nomeArquivo);
  } catch(e) {
    console.warn('InfoJOB: não foi possível salvar o log:', e.message);
  }
}

function doisPrimeirosNomes(nomeCompleto) {
  // Ignora tokens com ponto (ex: 19.202.038), pega os dois primeiros nomes restantes
  const tokens = (nomeCompleto || '').trim().split(/\s+/);
  const validos = tokens.filter(t => !t.includes('.'));
  return validos.slice(0, 2).join(' ');
}

function extrairNomeEcac() {
  try {
    // O eCAC inclui inputs hidden dentro de cada linha da tabela de pedidos
    // com name="nome" contendo o nome do contribuinte
    // Precisamos pegar o que está NA LINHA DA TABELA, não no cabeçalho
    const linhas = document.querySelectorAll('tr');
    for (const tr of linhas) {
      const inputNome = tr.querySelector('input[name="nome"]');
      if (inputNome && inputNome.value.trim().length > 2) {
        return inputNome.value.trim();
      }
    }

    // Fallback: células brancoEsquerda da tabela de pedidos
    // Ignora datas, horas, e textos com menos de 4 chars
    const tds = document.querySelectorAll('td.brancoEsquerda');
    for (const td of tds) {
      const txt = td.textContent.trim();
      if (!txt || txt.length < 4) continue;
      if (/[/:]/.test(txt)) continue;      // data/hora
      if (/^\d+$/.test(txt)) continue;     // só números
      if (/^[\d.\-/]+$/.test(txt)) continue; // CPF/CNPJ/data
      return txt;
    }
  } catch(e) {
    console.warn('InfoJOB: não foi possível extrair nome do eCAC:', e.message);
  }
  return null;
}

function mesAnoCorrente() {
  const now = new Date();
  return String(now.getMonth() + 1).padStart(2, '0') + '/' + now.getFullYear();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function storageGet(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function storageSet(obj)  { return new Promise(r => chrome.storage.local.set(obj, r)); }

// ── Aguarda confirmação de download iniciado (vinda do background) ─
let _downloadIniciado = null;
let _ditrCarregado    = null;
let _iframeAlerta     = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.acao === 'download_iniciado') {
    console.log('InfoJOB: download iniciado confirmado:', msg.url);
    if (_downloadIniciado) { _downloadIniciado(); _downloadIniciado = null; }
  }
  if (msg.acao === 'ditr_carregado') {
    console.log('InfoJOB: DITR carregado, capturando via iframe:', msg.url);
    if (_ditrCarregado) { _ditrCarregado(msg.url); _ditrCarregado = null; }
  }
  if (msg.acao === 'iframe_alert') {
    console.warn('InfoJOB: alert do eCAC interceptado:', msg.texto);
    if (_iframeAlerta) { _iframeAlerta(msg.texto); _iframeAlerta = null; }
  }
});

function aguardarDitrCarregado(timeout) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      _ditrCarregado = null;
      console.warn('InfoJOB: timeout aguardando DITR');
      resolve(null);
    }, timeout || 10000);
    _ditrCarregado = (url) => { clearTimeout(timer); resolve(url); };
  });
}

function aguardarDownloadIniciado(timeout) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      _downloadIniciado = null;
      console.warn('InfoJOB: timeout aguardando download — avançando');
      resolve(false);
    }, timeout || 10000);
    _downloadIniciado = () => { clearTimeout(timer); resolve(true); };
  });
}

// ── Modal de resultado (automação de envio) ───────────────────
function exibirModalResultado(sucesso, erros) {
  const anterior = document.getElementById('infojob-modal');
  if (anterior) anterior.remove();

  const total = sucesso.length + erros.length;
  let linhas = '';

  if (sucesso.length > 0) {
    linhas += `<p style="margin:8px 0 4px;color:#15803d;font-weight:bold">✔ ${sucesso.length} enviado(s) com sucesso:</p>`;
    sucesso.forEach(p => {
      linhas += `<p style="margin:2px 0 2px 12px;color:#166534">· ${p.nome} — ${p.processo}</p>`;
    });
  }

  if (erros.length > 0) {
    linhas += `<p style="margin:8px 0 4px;color:#b45309;font-weight:bold">⚠ ${erros.length} com erro:</p>`;
    erros.forEach(p => {
      linhas += `<p style="margin:2px 0 2px 12px;color:#92400e">· ${p.nome} — ${p.processo}</p>`;
      linhas += `<p style="margin:0 0 2px 24px;color:#b45309;font-size:11px">${p.erro}</p>`;
    });
  }

  const overlay = document.createElement('div');
  overlay.id = 'infojob-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
  `;

  overlay.innerHTML = `
    <div style="
      background: #fff; border-radius: 10px; padding: 28px 32px;
      max-width: 520px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      font-family: Arial, sans-serif; font-size: 13px; color: #1e293b;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <span style="font-size:16px;font-weight:bold">InfoJOB — Automação concluída</span>
        <button id="infojob-modal-fechar" style="
          border:none;background:none;font-size:20px;cursor:pointer;color:#64748b;line-height:1
        ">✕</button>
      </div>
      <p style="margin:0 0 12px;color:#334155">
        <strong>${total}</strong> parte(s) processada(s).
      </p>
      ${linhas}
      <div style="margin-top:16px;padding:10px 14px;background:#eff6ff;border-radius:6px;color:#1d4ed8;font-size:12px">
        📥 Quando as respostas chegarem na Caixa Postal, clique em <strong>Salvar respostas</strong> na extensão.
      </div>
      <div style="margin-top:8px;padding:8px 14px;background:#f0fdf4;border-radius:6px;color:#166534;font-size:11px">
        🔒 Dados temporários de processamento removidos automaticamente.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('infojob-modal-fechar').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

})();
