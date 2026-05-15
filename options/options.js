
  function toggleCard(id) {
    const opts = document.getElementById('opts-' + id);
    const checkbox = document.getElementById(id.replace('-', '_'));
    if (opts && checkbox && checkbox.checked) {
      opts.classList.toggle('hidden');
    }
  }

  function onCheck(id, cb) {
    const card = document.getElementById('card-' + id);
    const opts = document.getElementById('opts-' + id);
    if (cb.checked) {
      card.classList.add('active');
      if (opts) opts.classList.remove('hidden');
    } else {
      card.classList.remove('active');
      if (opts) opts.classList.add('hidden');
    }
  }

  function getConfig() {
    return {
      processo: {
        tipo: document.getElementById('tipoProcesso').value,
        justificativa: document.getElementById('justificativa').value,
        vara: document.getElementById('vara').value,
      },
      pastaSaida: document.getElementById('pastaSaida').value,
      cpf: {
        dirpf:   { ativo: document.getElementById('cpf_dirpf').checked,   anos: document.getElementById('cpf_dirpf_anos').value },
        ditr:    { ativo: document.getElementById('cpf_ditr').checked,    anos: document.getElementById('cpf_ditr_anos').value },
        doi:     { ativo: document.getElementById('cpf_doi').checked,     dataIni: document.getElementById('cpf_doi_ini').value },
        decred:  { ativo: document.getElementById('cpf_decred').checked,  anos: document.getElementById('cpf_decred_anos').value },
        dimob:   { ativo: document.getElementById('cpf_dimob').checked,   anos: document.getElementById('cpf_dimob_anos').value },
        infocad: { ativo: document.getElementById('cpf_infocad').checked },
        efin:    { ativo: document.getElementById('cpf_efin').checked,
                   conta: document.getElementById('cpf_efin_conta').value,
                   relacao: document.getElementById('cpf_efin_relacao').value,
                   extrato: document.getElementById('cpf_efin_extrato').value,
                   cambio: document.getElementById('cpf_efin_cambio').value,
                   anos: parseInt(document.getElementById('cpf_efin_anos').value) || 1 },
      },
      cnpj: {
        dipj:    { ativo: document.getElementById('cnpj_dipj').checked,   anos: document.getElementById('cnpj_dipj_anos').value },
        ecf:     { ativo: document.getElementById('cnpj_ecf').checked,    anos: document.getElementById('cnpj_ecf_anos').value },
        ditr:    { ativo: document.getElementById('cnpj_ditr').checked,   anos: document.getElementById('cnpj_ditr_anos').value },
        doi:     { ativo: document.getElementById('cnpj_doi').checked,    dataIni: document.getElementById('cnpj_doi_ini').value },
        decred:  { ativo: document.getElementById('cnpj_decred').checked, anos: document.getElementById('cnpj_decred_anos').value },
        dimob:   { ativo: document.getElementById('cnpj_dimob').checked,  anos: document.getElementById('cnpj_dimob_anos').value },
        cpmf:    { ativo: document.getElementById('cnpj_cpmf').checked,
                   dataIni: document.getElementById('cnpj_cpmf_ini').value,
                   dataFim: document.getElementById('cnpj_cpmf_fim').value },
        infocad: { ativo: document.getElementById('cnpj_infocad').checked },
        efin:    { ativo: document.getElementById('cnpj_efin').checked,
                   conta: document.getElementById('cnpj_efin_conta').value,
                   relacao: document.getElementById('cnpj_efin_relacao').value,
                   extrato: document.getElementById('cnpj_efin_extrato').value,
                   cambio: document.getElementById('cnpj_efin_cambio').value,
                   anos: parseInt(document.getElementById('cnpj_efin_anos').value) || 1 },
      }
    };
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.processo) {
      document.getElementById('tipoProcesso').value = cfg.processo.tipo || 'Ação Trabalhista';
      document.getElementById('justificativa').value = cfg.processo.justificativa || 'execução';
      document.getElementById('vara').value = cfg.processo.vara || '';
    }
    if (cfg.pastaSaida) document.getElementById('pastaSaida').value = cfg.pastaSaida;

    const apply = (prefix, tipo, dados) => {
      if (!dados) return;
      const cb = document.getElementById(prefix + '_' + tipo);
      if (!cb) return;
      cb.checked = dados.ativo;
      onCheck(prefix + '-' + tipo, cb);
      if (dados.anos) { const s = document.getElementById(prefix + '_' + tipo + '_anos'); if (s) s.value = dados.anos; }
      if (dados.dataIni) {
        const i = document.getElementById(prefix + '_' + tipo + '_ini');
        if (i) i.value = dados.dataIni;
        const i2 = document.getElementById(prefix + '_' + tipo + '_dataIni');
        if (i2) i2.value = dados.dataIni;
      }
      if (dados.dataFim) {
        const i = document.getElementById(prefix + '_' + tipo + '_fim');
        if (i) i.value = dados.dataFim;
        const i2 = document.getElementById(prefix + '_' + tipo + '_dataFim');
        if (i2) i2.value = dados.dataFim;
      }
      ['conta','relacao','extrato','cambio'].forEach(f => {
        if (dados[f]) { const s = document.getElementById(prefix + '_' + tipo + '_' + f); if (s) s.value = dados[f]; }
      });
    };

    if (cfg.cpf) Object.keys(cfg.cpf).forEach(t => apply('cpf', t, cfg.cpf[t]));
    if (cfg.cnpj) Object.keys(cfg.cnpj).forEach(t => apply('cnpj', t, cfg.cnpj[t]));
  }

  function salvar() {
    const cfg = getConfig();
    const salvarDados = () => {
      const msg = document.getElementById('saveMsg');
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 3000);
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ infojob_config: cfg }, salvarDados);
    } else {
      localStorage.setItem('infojob_config', JSON.stringify(cfg));
      salvarDados();
    }
  }

  function restaurar() {
    if (!confirm('Restaurar todas as configurações para os valores padrão?')) return;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove('infojob_config', () => location.reload());
    } else {
      localStorage.removeItem('infojob_config');
      location.reload();
    }
  }

  // Inicialização — sem inline handlers (CSP extensão Chrome)
  document.addEventListener('DOMContentLoaded', () => {
    // Versão dinâmica do manifest
    const v = chrome.runtime.getManifest().version;
    const el = document.querySelector('.about-val.mono');
    if (el) el.textContent = v;

    // Carrega configurações salvas
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get('infojob_config', (result) => {
        if (result.infojob_config) applyConfig(result.infojob_config);
      });
    } else {
      const saved = localStorage.getItem('infojob_config');
      if (saved) applyConfig(JSON.parse(saved));
    }

    // Botões da barra de ações
    document.getElementById('btnFechar').addEventListener('click', () => window.close());
    document.getElementById('btnSalvar').addEventListener('click', salvar);
    document.getElementById('btnRestaurar').addEventListener('click', restaurar);

    // Toggle dos cards de consulta (via data-toggle)
    document.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        toggleCard(el.dataset.toggle);
      });
    });

    // Checkboxes (via data-check)
    document.querySelectorAll('[data-check]').forEach(cb => {
      cb.addEventListener('change', function() {
        onCheck(this.dataset.check, this);
      });
    });
  });
