// content_iframe.js — InfoJOB v1.7.37
// Roda dentro do iframe www3.cav.receita.fazenda.gov.br
// Comunica com o content.js principal via chrome.runtime

if (window.__infojobIframeAtivo) {
  throw new Error('InfoJOB iframe: já ativo');
}
window.__infojobIframeAtivo = true;

// Intercepta alerts do eCAC (ex: "CNPJ inválido") para não travar a extensão
window.alert = function(msg) {
  console.warn('InfoJOB iframe: alert interceptado:', msg);
  chrome.runtime.sendMessage({ acao: 'iframe_alert', texto: msg || '' });
};

console.log('InfoJOB iframe: ativo em', window.location.href);

// Notifica o content.js principal que o iframe carregou
chrome.runtime.sendMessage({ acao: 'iframe_carregou', url: window.location.href });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Ping ──────────────────────────────────────────────────────
  if (msg.acao === 'iframe_ping') {
    sendResponse({ ok: true, url: window.location.href });
    return false;
  }

  // ── Clicar no filtro "Não lidas" ──────────────────────────────
  if (msg.acao === 'iframe_clicar_nao_lidas') {
    (async () => {
      // Fecha tutorial "Bem vindo ao novo Caixa Postal" se presente
      const tutorial = document.querySelector('a.skip-tutorial-modal');
      if (tutorial) { tutorial.click(); await sleep(800); }

      // Espera ativa até o botão aparecer (até 10s)
      for (let t = 0; t < 25; t++) {
        const btn = document.querySelector('button[title="Filtrar apenas não lidas"]');
        if (btn) { btn.click(); sendResponse({ ok: true }); return; }
        await sleep(400);
      }
      sendResponse({ ok: false, erro: 'botão não encontrado após 10s' });
    })();
    return true;
  }

  // ── Contar não lidas pelo badge ───────────────────────────────
  if (msg.acao === 'iframe_contar_nao_lidas') {
    const btn   = document.querySelector('button[title="Filtrar apenas não lidas"]');
    const badge = btn?.querySelector('span.badge');
    const n     = badge ? parseInt(badge.textContent.trim(), 10) : 0;
    sendResponse({ ok: true, total: isNaN(n) ? 0 : n });
    return false;
  }

  // ── Mudar Exibir para 100 ─────────────────────────────────────
  if (msg.acao === 'iframe_exibir_100') {
    (async () => {
      // Espera ativa até ng-select aparecer (até 10s)
      let container = null;
      for (let t = 0; t < 25; t++) {
        const label = document.querySelector('span.ng-value-label');
        if (label && label.textContent.trim() === '100') {
          sendResponse({ ok: true, msg: 'já estava em 100' }); return;
        }
        container = document.querySelector('.ng-select-container');
        if (container) break;
        await sleep(400);
      }
      if (!container) { sendResponse({ ok: false, erro: 'ng-select não encontrado após 10s' }); return; }
      container.click();
      await sleep(800);
      for (let t = 0; t < 10; t++) {
        const opcoes = Array.from(document.querySelectorAll('ng-dropdown-panel .ng-option, [role="option"]'));
        const op100  = opcoes.find(o => o.textContent.trim() === '100');
        if (op100) { op100.click(); await sleep(800); sendResponse({ ok: true }); return; }
        await sleep(300);
      }
      document.body.click();
      sendResponse({ ok: false, erro: 'opção 100 não encontrada' });
    })();
    return true; // async
  }

  // ── Encontrar primeira mensagem não lida ──────────────────────
  if (msg.acao === 'iframe_primeira_nao_lida') {
    (async () => {
      // Espera ativa até datatable ter linhas (até 15s)
      for (let t = 0; t < 30; t++) {
        const r = document.querySelectorAll('datatable-body-row');
        if (r.length > 0) break;
        await sleep(500);
      }
      // Com filtro "Não lidas" ativo, todas as linhas visíveis são não lidas
      // Basta pegar a primeira com INFOJUD no assunto
      const rows = document.querySelectorAll('datatable-body-row');
      for (const row of rows) {
        const cels = row.querySelectorAll('datatable-body-cell');
        if (cels.length < 5) continue;
        const celAssunto = cels[4];
        const link = celAssunto?.querySelector('a.small-txt') || celAssunto?.querySelector('a');
        if (!link) continue;
        const titulo = (link.title || link.textContent || '').toUpperCase();
        if (!titulo.includes('INFOJUD')) continue;
        const href    = link.href || '';
        const titulo2 = link.title || link.textContent || '';
        link.click();
        sendResponse({ ok: true, href, titulo: titulo2 });
        return;
      }
      sendResponse({ ok: false });
    })();
    return true; // async
  }

  // ── Aguardar link de consulta e clicar ───────────────────────
  if (msg.acao === 'iframe_clicar_consulta') {
    (async () => {
      for (let t = 0; t < 20; t++) {
        const link = document.querySelector('a[href*="resultadoSolicitacao"]');
        if (link) { link.click(); sendResponse({ ok: true, href: link.href }); return; }
        await sleep(500);
      }
      sendResponse({ ok: false, erro: 'link consulta não encontrado' });
    })();
    return true;
  }

  // ── Voltar para lista ─────────────────────────────────────────
  if (msg.acao === 'iframe_voltar_lista') {
    // Navega diretamente para a caixa postal — mais confiável que history.back
    window.location.href = 'https://www3.cav.receita.fazenda.gov.br/caixapostal/';
    sendResponse({ ok: true, via: 'navigate' });
    return false;
  }

  // ── Clicar lupa de item do resultado ──────────────────────────
  if (msg.acao === 'iframe_clicar_lupa') {
    (async () => {
      // Aguarda tabela carregar
      for (let t = 0; t < 15; t++) {
        const linhas = document.querySelectorAll('tr.azulCentro, tr.brancoCentro');
        if (linhas.length > 0) break;
        await sleep(500);
      }
      const linhas = document.querySelectorAll('tr.azulCentro, tr.brancoCentro');
      const itens  = [];
      let nomeContrib = '';
      let niContrib   = '';
      for (const linha of linhas) {
        const cels = linha.querySelectorAll('td');
        if (cels.length < 5) continue;
        const tipo    = (cels[2]?.textContent || '').trim().toUpperCase();
        const anoData = (cels[3]?.textContent || '').trim();
        const link    = cels[4]?.querySelector('a');
        if (!tipo || !link) continue;
        const onclick = link.getAttribute('onclick') || '';
        const href    = link.getAttribute('href') || '';
        // Captura nome do contribuinte na 2ª coluna (cels[1] = Nome/Nome Empresarial)
        if (!nomeContrib) {
          nomeContrib = (cels[1]?.textContent || '').trim().replace(/\s+/g, ' ');
          niContrib   = (cels[0]?.textContent || '').trim();
        }
        itens.push({ tipo, anoData, onclick, href });
      }
      sendResponse({ ok: true, itens, nomeContrib, niContrib });
    })();
    return true;
  }

  // ── Submeter form com tipo/índice específico ──────────────────
  if (msg.acao === 'iframe_submeter_item') {
    (async () => {
      const { onclick, forceSelf } = msg;
      const m = (onclick || '').match(/obterInformacao\(([^)]+)\)/);
      if (!m) { sendResponse({ ok: false, erro: 'onclick inválido' }); return; }
      const params = m[1].split(',').map(p => p.trim().replace(/^'|'$/g, ''));
      const form   = document.getElementById('formResultado');
      if (!form) { sendResponse({ ok: false, erro: 'form não encontrado' }); return; }
      if (forceSelf) form.target = '_self';
      else form.target = params[5] || '_self';
      document.getElementById('acao').value           = params[0] || 'visualizar';
      document.getElementById('numSolicitacao').value = params[1] || '';
      document.getElementById('tipoInformacao').value = params[2] || '';
      document.getElementById('indicePedido').value   = params[3] || '';
      document.getElementById('nirf').value           = params[4] || '';
      form.submit();
      sendResponse({ ok: true, target: form.target });
    })();
    return true;
  }

  // ── Imprimir página atual do iframe ──────────────────────────
  if (msg.acao === 'iframe_print') {
    const texto = document.body?.textContent || '';
    if (/não\s+consta/i.test(texto)) {
      sendResponse({ ok: false, motivo: 'nao_consta' });
    } else {
      window.print();
      sendResponse({ ok: true });
    }
    return false;
  }

  // ── Imprimir forçado (mesmo com "Não consta") ─────────────────
  if (msg.acao === 'iframe_print_forcar') {
    window.print();
    sendResponse({ ok: true });
    return false;
  }

  // ── Gerar PDF informativo para DITR ──────────────────────────
  if (msg.acao === 'iframe_gerar_pdf_ditr') {
    console.log('InfoJOB iframe: iframe_gerar_pdf_ditr recebido em', window.location.href);
    (async () => {
      await sleep(1500);
      const texto     = document.body?.textContent || '';
      const negativo  = /não\s+consta/i.test(texto);
      const exercicio = (msg.anoData || '').trim();
      const ni        = (msg.niFormatado || msg.ni || '').trim();
      const tipoLabel = msg.tituloOverride || 'DITR';
      const data      = new Date().toLocaleDateString('pt-BR');
      // tipoNi: 1 = CPF, 2 = CNPJ
      const rotuloni  = (msg.tipoNi === '2' || msg.tipoNi === 2) ? 'CNPJ' : 'CPF';

      let linhas, titulo, filename;

      // Info.Cadastrais — mensagem única, sem positivo/negativo
      if (tipoLabel === 'Informacoes Cadastrais') {
        titulo = 'Informacoes Cadastrais';
        linhas = [
          'Data de consulta: ' + data,
          rotuloni + ': ' + ni,
          '',
          'Informacoes Cadastrais coletadas.',
          'Consulte a Caixa Postal para obter documento.'
        ];
        filename = msg.filename || ('INFO_CADASTRAIS_' + ni.replace(/\D/g,'') + '.pdf');

      } else if (negativo) {
        if (tipoLabel === 'DITR') {
          titulo = 'DITR - Nao consta';
          linhas = [
            'Data de consulta: ' + data,
            rotuloni + ': ' + ni,
            '',
            'Nao consta DITR ' + exercicio + ' para o ' + rotuloni + ' ' + ni + '.'
          ];
        } else {
          // DIPJ
          titulo = tipoLabel + ' - Nao consta';
          linhas = [
            'Data de consulta: ' + data,
            rotuloni + ': ' + ni,
            '',
            'Nao consta declaracao para os dados informados (' + exercicio + ').'
          ];
        }
        filename = msg.filename || (tipoLabel + '_negativo_' + (exercicio || '') + '.pdf');

      } else {
        if (tipoLabel === 'DITR') {
          titulo = 'DITR - Constam imoveis declarados';
          linhas = [
            'Data de consulta: ' + data,
            rotuloni + ': ' + ni,
            '',
            'Constam imoveis declarados na DITR ' + exercicio,
            'para o ' + rotuloni + ' ' + ni + ' informado.',
            'Consulte a Caixa Postal para maiores detalhes.'
          ];
        } else {
          // DIPJ
          titulo = tipoLabel + ' - Consta declaracao';
          linhas = [
            'Data de consulta: ' + data,
            rotuloni + ': ' + ni,
            '',
            'Consta ' + tipoLabel + ' ' + exercicio,
            'para o ' + rotuloni + ' ' + ni + ' informado.',
            'Consulte a Caixa Postal para maiores detalhes.'
          ];
        }
        filename = msg.filename || (tipoLabel + '_positivo_' + (exercicio || '') + '.pdf');
      }

      chrome.runtime.sendMessage({
        acao: 'gerar_pdf_texto',
        titulo, linhas, filename
      }, (resp) => {
        if (!resp?.ok) { sendResponse({ ok: false, erro: resp?.erro || 'falhou' }); return; }
        // Cria blob e dispara download — onDeterminingFilename no background renomeia e aplica subpasta
        try {
          const binary  = atob(resp.base64);
          const bytes   = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob    = new Blob([bytes], { type: 'application/pdf' });
          const blobUrl = URL.createObjectURL(blob);
          const a       = document.createElement('a');
          a.href        = blobUrl;
          a.download    = resp.filename || filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 1000);
          sendResponse({ ok: true, negativo });
        } catch(e) {
          sendResponse({ ok: false, erro: e.message });
        }
      });
    })();
    return true;
  }

  // ── Clicar em link direto (ex: eFinanceira Download) ─────────
  if (msg.acao === 'iframe_clicar_href') {
    const link = document.querySelector('a[href="' + msg.href + '"]');
    if (link) {
      link.click();
      sendResponse({ ok: true });
    } else {
      // Fallback: navegar diretamente para o href
      window.location.href = msg.href;
      sendResponse({ ok: true });
    }
    return false;
  }

  // ── Voltar no histórico do iframe ─────────────────────────────
  if (msg.acao === 'iframe_history_back') {
    window.history.back();
    sendResponse({ ok: true });
    return false;
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function carregarScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + url + '"]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
