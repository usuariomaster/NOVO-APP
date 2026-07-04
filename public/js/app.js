import { api } from './api.js';

// ============================================================
// Estado + utilidades
// ============================================================
let usuario = null;
const appEl = () => document.getElementById('app');

const STATUS = {
  novo: 'Novo',
  em_controle: 'Em controle',
  distribuido: 'Distribuído',
  em_pericia: 'Em perícia',
  despachado: 'A conferir',
  devolvido: 'Devolvido',
  conferido: 'Conferido',
  enviado_sei: 'Enviado ao SEI',
  concluido: 'Concluído',
};
const PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function badge(status) {
  return `<span class="badge st-${status}">${STATUS[status] || status}</span>`;
}
function badgePr(p) {
  return `<span class="badge pr-${p}">${p}</span>`;
}
function dataHora(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z'));
  return isNaN(d) ? s : d.toLocaleString('pt-BR');
}

function toast(msg, erro = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (erro ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), 3200);
}

// Modal genérico. campos = html; retorna Promise com os valores ou null (cancelar).
function modal({ titulo, corpo, okLabel = 'Confirmar', okClasse = 'btn' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-back">
        <div class="modal">
          <h3>${esc(titulo)}</h3>
          <div class="modal-b">${corpo}</div>
          <div class="modal-f">
            <button class="btn secondary" data-cancel>Cancelar</button>
            <button class="${okClasse}" data-ok>${esc(okLabel)}</button>
          </div>
        </div>
      </div>`;
    const fechar = (v) => { root.innerHTML = ''; resolve(v); };
    root.querySelector('[data-cancel]').onclick = () => fechar(null);
    // Não fecha ao clicar fora, para não perder o que já foi digitado.
    root.querySelector('[data-ok]').onclick = () => {
      const dados = {};
      root.querySelectorAll('[name]').forEach((i) => (dados[i.name] = i.value));
      fechar(dados);
    };
    const first = root.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

// ============================================================
// Roteador (hash)
// ============================================================
const rotas = {
  '': renderPainel,
  '#painel': renderPainel,
  '#processos': renderProcessos,
  '#usuarios': renderUsuarios,
  '#sei': renderConfigSei,
};

async function navegar() {
  const hash = location.hash;
  const fn = hash.startsWith('#processo/')
    ? () => renderProcessoDetalhe(hash.split('/')[1])
    : (rotas[hash] || renderPainel);
  try {
    await fn();
  } catch (e) {
    // Nunca deixa a tela travada em "Carregando…".
    setMain(`
      <div class="page-head"><h2>Ops…</h2></div>
      <div class="card"><div class="card-b">
        <p>Não consegui carregar esta tela: <b>${esc(e.message || e)}</b></p>
        <p class="muted">O servidor pode ter sido fechado. Verifique se a janela preta continua aberta.</p>
        <button class="btn" onclick="location.reload()">Tentar de novo</button>
      </div></div>`);
  }
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === (hash || '#painel'));
  });
}
window.addEventListener('hashchange', navegar);

// ============================================================
// Shell (layout com menu)
// ============================================================
function shell(conteudo) {
  const isAdmin = usuario.papel === 'admin';
  const isOper = usuario.papel === 'operador' || isAdmin;
  const isPerito = usuario.papel === 'perito';
  const nav = [
    `<a href="#painel">📊 Painel</a>`,
    `<a href="#processos">📁 ${isPerito ? 'Meus processos' : 'Processos'}</a>`,
    isAdmin ? `<a href="#usuarios">👥 Usuários</a>` : '',
    isAdmin ? `<a href="#sei">🔗 Configuração SEI</a>` : '',
  ].join('');

  appEl().innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">SisPerícia<small>Despachos da Perícia</small></div>
        <nav class="nav">${nav}</nav>
        <div class="user">
          <div class="nome">${esc(usuario.nome)}</div>
          <div class="papel">${esc(usuario.papel)}</div>
          <button id="btn-sair">Sair</button>
        </div>
      </aside>
      <main class="main" id="main-content">${conteudo}</main>
    </div>`;
  document.getElementById('btn-sair').onclick = async () => {
    await api.post('/api/auth/logout');
    usuario = null;
    location.hash = '';
    renderLogin();
  };
  navegar._marcarNav?.();
}

function setMain(html) {
  const m = document.getElementById('main-content');
  if (m) m.innerHTML = html; else shell(html);
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === (location.hash || '#painel'));
  });
}

// ============================================================
// Login
// ============================================================
function renderLogin() {
  appEl().innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="form-login">
        <h1>SisPerícia</h1>
        <p class="sub">Sistema de Despachos da Perícia</p>
        <div class="field">
          <label>E-mail</label>
          <input type="email" name="email" autocomplete="username" required />
        </div>
        <div class="field">
          <label>Senha</label>
          <input type="password" name="senha" autocomplete="current-password" required />
        </div>
        <button class="btn" style="width:100%" type="submit">Entrar</button>
        <div class="error-msg" id="login-err"></div>
      </form>
    </div>`;
  document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      usuario = await api.post('/api/auth/login', { email: f.email.value, senha: f.senha.value });
      location.hash = '#painel';
      shell('<div class="empty">Carregando…</div>');
      navegar();
    } catch (err) {
      document.getElementById('login-err').textContent = err.message;
    }
  };
}

// ============================================================
// Painel
// ============================================================
async function renderPainel() {
  shell('<div class="empty">Carregando…</div>');
  const resumo = await api.get('/api/processos/resumo');
  const ordem = ['em_controle', 'distribuido', 'em_pericia', 'despachado', 'devolvido', 'conferido', 'enviado_sei', 'concluido'];
  const kpis = ordem
    .map((s) => `<div class="kpi"><div class="n">${resumo[s] || 0}</div><div class="l">${STATUS[s]}</div></div>`)
    .join('');

  const isPerito = usuario.papel === 'perito';
  const dica = isPerito
    ? 'Abra “Meus processos” para despachar os processos distribuídos a você.'
    : usuario.papel === 'operador' || usuario.papel === 'admin'
    ? 'Use “Processos” para extrair do SEI, distribuir aos peritos e conferir os despachos.'
    : '';

  setMain(`
    <div class="page-head"><div><h2>Painel</h2><div class="desc">Olá, ${esc(usuario.nome)}. ${dica}</div></div></div>
    <div class="kpis">${kpis}</div>
    <div class="card"><div class="card-b">
      <strong>Fluxo do processo:</strong>
      <p class="muted" style="margin:8px 0 0">
        Extraído do SEI → <b>Em controle</b> → operador <b>distribui</b> ao perito →
        perito <b>despacha</b> → operador <b>confere</b> (aprova ou devolve) →
        operador <b>envia ao SEI</b> → <b>concluído</b>.
      </p>
    </div></div>
  `);
}

// ============================================================
// Lista de processos
// ============================================================
async function renderProcessos() {
  shell('<div class="empty">Carregando…</div>');
  const isOper = usuario.papel === 'operador' || usuario.papel === 'admin';
  const botaoExtrair = isOper ? `<button class="btn" id="btn-extrair">⬇️ Extrair do SEI</button>` : '';

  setMain(`
    <div class="page-head">
      <div><h2>${isOper ? 'Controle de Processos' : 'Meus Processos'} <span id="contador-proc" class="badge pr-normal" style="font-size:14px">…</span></h2>
      <div class="desc">${isOper ? 'Processos extraídos do SEI e sua distribuição.' : 'Processos distribuídos a você para despacho.'}</div></div>
      ${botaoExtrair}
    </div>
    <div class="toolbar">
      <input type="search" id="busca" placeholder="Buscar nº, interessado, assunto…" />
      <select id="filtro-status">
        <option value="">Todos os status</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
    </div>
    <div class="card"><div id="lista-proc"><div class="empty">Carregando…</div></div></div>
  `);

  if (isOper) document.getElementById('btn-extrair').onclick = extrairDoSei;
  const busca = document.getElementById('busca');
  const filtro = document.getElementById('filtro-status');
  const recarregar = () => carregarLista(busca.value, filtro.value);
  let deb;
  busca.oninput = () => { clearTimeout(deb); deb = setTimeout(recarregar, 300); };
  filtro.onchange = recarregar;
  carregarLista('', '');
}

async function carregarLista(q, status) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const procs = await api.get('/api/processos?' + params.toString());
  const cont = document.getElementById('lista-proc');
  if (!cont) return;
  const contador = document.getElementById('contador-proc');
  if (contador) contador.textContent = `${procs.length} processo(s)`;
  if (!procs.length) {
    cont.innerHTML = `<div class="empty">Nenhum processo encontrado.</div>`;
    return;
  }
  const podeExcluir = usuario.papel === 'operador' || usuario.papel === 'admin';
  cont.innerHTML = `
    <table>
      <thead><tr>
        <th>Nº do processo</th><th>Assunto / Interessado</th><th>Unidade</th><th>Perito</th>
        <th>Prioridade</th><th>Status</th><th>Atualizado</th>${podeExcluir ? '<th></th>' : ''}
      </tr></thead>
      <tbody>
        ${procs.map((p) => `
          <tr data-id="${p.id}">
            <td class="num-proc">${esc(p.numero_sei)}</td>
            <td>${esc(p.especificacao || p.tipo || '—')}<br><span class="muted">${esc(p.interessado || '')}</span></td>
            <td class="muted">${esc(p.unidade_origem || '—')}</td>
            <td>${esc(p.perito_nome || '—')}</td>
            <td>${badgePr(p.prioridade)}</td>
            <td>${badge(p.status)}</td>
            <td class="muted">${dataHora(p.atualizado_em)}</td>
            ${podeExcluir ? `<td><button class="btn danger sm" data-del="${p.id}" title="Excluir">🗑</button></td>` : ''}
          </tr>`).join('')}
      </tbody>
    </table>`;
  cont.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = (e) => { if (e.target.closest('[data-del]')) return; location.hash = `#processo/${tr.dataset.id}`; };
  });
  cont.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const ok = await modal({ titulo: 'Excluir processo', okLabel: 'Excluir', okClasse: 'btn danger',
        corpo: `<p>Excluir este processo do controle? (não afeta o SEI)</p>` });
      if (!ok) return;
      try { await api.del('/api/processos/' + b.dataset.del); toast('Processo excluído'); carregarLista(q, status); }
      catch (err) { toast(err.message, true); }
    };
  });
}

async function extrairDoSei() {
  const btn = document.getElementById('btn-extrair');
  btn.disabled = true;
  btn.textContent = '⏳ Extraindo…';
  try {
    const r = await api.post('/api/sei/extrair');
    const aviso = r.modo === 'simulacao' ? ' (modo simulação)' : '';
    // No SEI real: se entrou mas não achou nenhum processo, mostra o que o robô viu.
    if (r.modo === 'sei' && r.total === 0) {
      const amostra = r.amostra
        ? `<p class="muted" style="margin-top:14px"><b>Copie este texto e mande para o suporte</b> (ajuda a calibrar):</p>
           <textarea readonly style="height:160px;font-family:ui-monospace,monospace;font-size:12px">${esc(r.amostra)}</textarea>`
        : '';
      const img = r.debug
        ? `<img src="/api/sei/debug/${encodeURIComponent(r.debug)}" style="width:100%;border:1px solid var(--border);border-radius:8px;margin-top:10px" />`
        : '';
      await modal({
        titulo: 'O robô entrou, mas não encontrou a lista de processos',
        okLabel: 'Fechar',
        corpo: `<p>O login funcionou, mas o robô não reconheceu a lista de processos nesta tela do SEI.
          Isso costuma acontecer quando a tela é diferente do padrão — dá para ajustar.</p>
          ${amostra}${img}`,
      });
    }
    // Resumo por unidade (de onde vieram os processos).
    if (r.porUnidade && Object.keys(r.porUnidade).length) {
      const linhas = Object.entries(r.porUnidade)
        .map(([u, n]) => `<li><b>${esc(u)}</b>: ${n} processo(s)</li>`).join('');
      await modal({
        titulo: 'Extração concluída',
        okLabel: 'Ver processos',
        corpo: `<p><b>${r.novos}</b> novo(s) e <b>${r.ignorados}</b> já existente(s).</p>
          <p class="muted">De onde vieram:</p><ul style="margin:0;padding-left:18px">${linhas}</ul>`,
      });
    } else {
      toast(`Extração concluída${aviso}: ${r.novos} novo(s), ${r.ignorados} já existente(s).`);
    }
    carregarLista(document.getElementById('busca').value, document.getElementById('filtro-status').value);
  } catch (err) {
    // Se o robô devolveu um print do que viu (falha no SEI real), mostra.
    const debug = err.dados?.debug;
    if (debug) {
      await modal({
        titulo: 'O robô não conseguiu concluir',
        okLabel: 'Fechar',
        corpo: `<p>${esc(err.message)}</p>
          <p class="muted">Abaixo está exatamente o que o robô viu na tela do SEI. Se precisar de ajuste, mande este print para o suporte.</p>
          <img src="/api/sei/debug/${encodeURIComponent(debug)}" style="width:100%;border:1px solid var(--border);border-radius:8px" />`,
      });
    } else {
      toast(err.message, true);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇️ Extrair do SEI';
  }
}

// ============================================================
// Detalhe do processo
// ============================================================
async function renderProcessoDetalhe(id) {
  shell('<div class="empty">Carregando…</div>');
  let p;
  try {
    p = await api.get('/api/processos/' + id);
  } catch (err) {
    setMain(`<div class="page-head"><h2>Processo</h2></div><div class="card"><div class="empty">${esc(err.message)}</div></div>`);
    return;
  }
  const isOper = usuario.papel === 'operador' || usuario.papel === 'admin';
  const isPerito = usuario.papel === 'perito';

  const docs = p.documentos.length
    ? p.documentos.map((d) => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <b>${esc(d.tipo || 'Documento')}</b>
            <span class="muted">${esc(d.numero || '')}</span>
            ${d.arquivo ? `<a class="btn secondary sm" href="/api/processos/${p.id}/documento/${d.id}/arquivo" target="_blank" rel="noopener">📥 Baixar PDF</a>` : ''}
            ${d.conteudo ? `<button class="btn secondary sm" data-toggle="doc-${d.id}">📄 Ver texto</button>` : ''}
          </div>
          ${d.conteudo ? `<div id="doc-${d.id}" style="display:none;white-space:pre-wrap;background:var(--surface-2);padding:12px;border-radius:8px;margin-top:8px;font-size:13px;max-height:320px;overflow:auto">${esc(d.conteudo)}</div>` : ''}
        </div>`).join('')
    : '<span class="muted">Nenhum documento. Use “Buscar conteúdo no SEI”.</span>';

  const timeline = p.historico.length
    ? `<ul class="timeline">${p.historico.map((h) => `
        <li><div class="acao">${esc(h.detalhe || h.acao)}</div>
        <div class="meta">${esc(h.usuario_nome || 'Sistema')} • ${dataHora(h.criado_em)}</div></li>`).join('')}</ul>`
    : '<span class="muted">Sem histórico.</span>';

  setMain(`
    <div class="page-head">
      <div>
        <a href="#processos" class="muted">← voltar</a>
        <h2 class="num-proc" style="margin-top:4px">${esc(p.numero_sei)}</h2>
        <div class="desc">${badge(p.status)} ${badgePr(p.prioridade)}
          ${p.link_sei ? `• <a href="${esc(p.link_sei)}" target="_blank" rel="noopener">abrir no SEI ↗</a>` : ''}
          ${p.conteudo_em ? `• <span class="muted">conteúdo atualizado em ${dataHora(p.conteudo_em)}</span>` : ''}</div>
      </div>
      ${p.pdf_processo ? `<a class="btn" href="/api/processos/${p.id}/pdf" target="_blank" rel="noopener">📥 Baixar processo em PDF</a>` : ''}
    </div>
    <div class="detail-grid">
      <div>
        <div class="card">
          <div class="card-h">Dados do processo ${isOper ? '<button class="btn secondary sm" id="btn-editar">Editar</button>' : ''}</div>
          <div class="card-b">
            <dl class="info-list">
              <dt>Tipo</dt><dd>${esc(p.tipo || '—')}</dd>
              <dt>Interessado</dt><dd>${esc(p.interessado || '—')}</dd>
              <dt>Especificação</dt><dd>${esc(p.especificacao || '—')}</dd>
              <dt>Origem</dt><dd>${esc(p.unidade_origem || '—')}</dd>
              <dt>Autuação</dt><dd>${esc(p.data_autuacao || '—')}</dd>
              <dt>Perito</dt><dd>${esc(p.perito_nome || '—')}</dd>
              <dt>Prazo</dt><dd>${esc(p.prazo || '—')}</dd>
            </dl>
          </div>
        </div>
        <div class="card">
          <div class="card-h">Documentos do SEI</div>
          <div class="card-b">${docs}</div>
        </div>
        ${renderAreaDespacho(p, isOper, isPerito)}
      </div>
      <div>
        <div class="card">
          <div class="card-h">Ações</div>
          <div class="card-b" id="acoes">${renderAcoes(p, isOper, isPerito)}</div>
        </div>
        <div class="card">
          <div class="card-h">Histórico</div>
          <div class="card-b">${timeline}</div>
        </div>
      </div>
    </div>
  `);

  ligarAcoes(p, isOper, isPerito);
}

function renderAreaDespacho(p, isOper, isPerito) {
  const d = p.despacho;
  // Perito editando
  const podeEditar = isPerito && ['distribuido', 'em_pericia', 'devolvido'].includes(p.status);
  if (podeEditar) {
    const motivo = d?.status === 'devolvido' && d.motivo_devolucao
      ? `<div class="error-msg" style="min-height:auto;margin-bottom:12px">↩ Devolvido pelo operador: ${esc(d.motivo_devolucao)}</div>` : '';
    return `
      <div class="card">
        <div class="card-h">Despacho</div>
        <div class="card-b">
          ${motivo}
          <div class="field">
            <label>Conclusão</label>
            <select name="conclusao" id="d-conclusao">
              ${['', 'Deferido', 'Indeferido', 'Diligência', 'Parcialmente deferido']
                .map((c) => `<option value="${c}" ${d?.conclusao === c ? 'selected' : ''}>${c || '— selecione —'}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Texto do despacho</label>
            <textarea id="d-texto" placeholder="Redija aqui o despacho…">${esc(d?.texto || '')}</textarea>
          </div>
          <div class="row">
            <button class="btn secondary" id="btn-salvar-despacho">💾 Salvar rascunho</button>
            <button class="btn ok" id="btn-enviar-despacho">✔ Enviar para conferência</button>
          </div>
        </div>
      </div>`;
  }
  // Visualização do despacho (operador conferindo, ou já finalizado)
  if (d && d.texto) {
    const comprovante = d.comprovante
      ? `<div style="margin-top:12px"><a class="btn secondary sm" href="/api/processos/${p.id}/comprovante" target="_blank" rel="noopener">🧾 Ver comprovante do lançamento no SEI</a></div>`
      : '';
    return `
      <div class="card">
        <div class="card-h">Despacho ${d.conclusao ? `— <strong>${esc(d.conclusao)}</strong>` : ''}</div>
        <div class="card-b">
          <div style="white-space:pre-wrap">${esc(d.texto)}</div>
          ${d.motivo_devolucao && d.status === 'devolvido' ? `<div class="error-msg" style="min-height:auto;margin-top:10px">↩ ${esc(d.motivo_devolucao)}</div>` : ''}
          ${comprovante}
        </div>
      </div>`;
  }
  return '';
}

function renderAcoes(p, isOper, isPerito) {
  const acoes = [];
  if (isOper) {
    acoes.push(`<button class="btn secondary" id="a-detalhar">🔎 Buscar conteúdo no SEI</button>`);
    if (['em_controle', 'distribuido', 'devolvido'].includes(p.status)) {
      acoes.push(`<button class="btn" id="a-distribuir">👤 ${p.perito_id ? 'Redistribuir' : 'Distribuir'} a um perito</button>`);
    }
    if (p.status === 'despachado') {
      acoes.push(`<button class="btn ok" id="a-aprovar">✔ Aprovar (conferido)</button>`);
      acoes.push(`<button class="btn warn" id="a-devolver">↩ Devolver ao perito</button>`);
    }
    if (p.status === 'conferido') {
      acoes.push(`<button class="btn" id="a-enviar-sei">📤 Enviar resposta ao SEI</button>`);
    }
    if (p.status === 'enviado_sei') {
      acoes.push(`<button class="btn secondary" id="a-concluir">🏁 Concluir processo</button>`);
    }
  }
  if (!acoes.length) acoes.push('<span class="muted">Nenhuma ação disponível neste momento.</span>');
  return acoes.join('<div style="height:10px"></div>');
}

function ligarAcoes(p, isOper, isPerito) {
  const recarrega = () => renderProcessoDetalhe(p.id);

  // Mostra/esconde o texto de cada documento.
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const alvo = document.getElementById(b.dataset.toggle);
      if (alvo) alvo.style.display = alvo.style.display === 'block' ? 'none' : 'block';
    };
  });

  // Editar dados (operador)
  const btnEditar = document.getElementById('btn-editar');
  if (btnEditar) btnEditar.onclick = async () => {
    const r = await modal({
      titulo: 'Editar processo',
      okLabel: 'Salvar',
      corpo: `
        <div class="field"><label>Tipo</label><input name="tipo" value="${esc(p.tipo || '')}"></div>
        <div class="field"><label>Interessado</label><input name="interessado" value="${esc(p.interessado || '')}"></div>
        <div class="field"><label>Especificação</label><input name="especificacao" value="${esc(p.especificacao || '')}"></div>
        <div class="row">
          <div class="field"><label>Prioridade</label><select name="prioridade">
            ${PRIORIDADES.map((x) => `<option value="${x}" ${p.prioridade === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select></div>
          <div class="field"><label>Prazo</label><input type="date" name="prazo" value="${esc(p.prazo || '')}"></div>
        </div>`,
    });
    if (!r) return;
    await api.put('/api/processos/' + p.id, r);
    toast('Processo atualizado');
    recarrega();
  };

  // Buscar conteúdo no SEI
  const btnDetalhar = document.getElementById('a-detalhar');
  if (btnDetalhar) btnDetalhar.onclick = async () => {
    btnDetalhar.disabled = true;
    btnDetalhar.textContent = '⏳ Buscando no SEI…';
    try {
      const r = await api.post(`/api/processos/${p.id}/detalhar-sei`);
      // No SEI real, se o PDF do processo não gerou, mostra o raio-x pra calibrar.
      if (r.modo === 'sei' && !r.pdfProcesso) {
        const box = (titulo, t) => t
          ? `<p class="muted" style="margin-top:12px"><b>${titulo}</b></p>
             <textarea readonly onclick="this.select()" style="height:150px;font-family:ui-monospace,monospace;font-size:12px">${esc(t)}</textarea>` : '';
        await modal({
          titulo: 'Documentos listados — falta o PDF do processo',
          okLabel: 'Fechar',
          corpo: `<p>Encontrei <b>${r.documentos}</b> documento(s), mas não consegui gerar o PDF do processo.</p>
            <p class="muted">👉 Clique no quadro, Ctrl+A, copie e <b>cole no chat do suporte</b>:</p>
            ${box('Raio-x do processo:', r.amostra) || '<i>Sem amostra.</i>'}`,
        });
      } else if (r.modo === 'sei') {
        toast(`Conteúdo atualizado: ${r.documentos} doc(s) — PDF do processo pronto.`);
      } else {
        toast(`Conteúdo atualizado: ${r.documentos} documento(s).`);
      }
      recarrega();
    } catch (e) {
      const debug = e.dados?.debug;
      if (debug) {
        await modal({ titulo: 'Não consegui abrir o processo', okLabel: 'Fechar',
          corpo: `<p>${esc(e.message)}</p><img src="/api/sei/debug/${encodeURIComponent(debug)}" style="width:100%;border:1px solid var(--border);border-radius:8px;margin-top:10px" />` });
      } else { toast(e.message, true); }
      btnDetalhar.disabled = false;
      btnDetalhar.textContent = '🔎 Buscar conteúdo no SEI';
    }
  };

  // Distribuir
  const btnDist = document.getElementById('a-distribuir');
  if (btnDist) btnDist.onclick = async () => {
    const peritos = await api.get('/api/usuarios/peritos');
    if (!peritos.length) return toast('Cadastre peritos primeiro (Usuários).', true);
    const r = await modal({
      titulo: 'Distribuir a um perito',
      okLabel: 'Distribuir',
      corpo: `<div class="field"><label>Perito</label><select name="perito_id">
        ${peritos.map((pe) => `<option value="${pe.id}" ${p.perito_id === pe.id ? 'selected' : ''}>${esc(pe.nome)}</option>`).join('')}
      </select></div>`,
    });
    if (!r) return;
    await api.post(`/api/processos/${p.id}/distribuir`, { perito_id: Number(r.perito_id) });
    toast('Processo distribuído');
    recarrega();
  };

  // Aprovar
  const btnAprovar = document.getElementById('a-aprovar');
  if (btnAprovar) btnAprovar.onclick = async () => {
    await api.post(`/api/despachos/processo/${p.id}/aprovar`);
    toast('Despacho aprovado');
    recarrega();
  };

  // Devolver
  const btnDevolver = document.getElementById('a-devolver');
  if (btnDevolver) btnDevolver.onclick = async () => {
    const r = await modal({
      titulo: 'Devolver ao perito',
      okLabel: 'Devolver',
      okClasse: 'btn warn',
      corpo: `<div class="field"><label>Motivo / orientação</label><textarea name="motivo" placeholder="Explique o que precisa ser ajustado…"></textarea></div>`,
    });
    if (!r) return;
    await api.post(`/api/despachos/processo/${p.id}/devolver`, { motivo: r.motivo });
    toast('Processo devolvido ao perito');
    recarrega();
  };

  // Enviar ao SEI (lançamento automático pelo robô)
  const btnSei = document.getElementById('a-enviar-sei');
  if (btnSei) btnSei.onclick = async () => {
    const r = await modal({
      titulo: 'Lançar despacho no SEI',
      okLabel: 'Lançar automaticamente',
      corpo: `<p>O robô vai <b>logar no SEI</b> e lançar o despacho no processo
        <b>${esc(p.numero_sei)}</b> automaticamente (incluir documento “Despacho”,
        escrever o texto e salvar). Um comprovante em imagem será guardado.</p>
        <p class="muted">Confirme que o despacho já foi conferido.</p>`,
    });
    if (!r) return;
    btnSei.disabled = true;
    btnSei.textContent = '⏳ Lançando no SEI…';
    try {
      const resp = await api.post(`/api/processos/${p.id}/enviar-sei`);
      toast(resp.modo === 'simulacao' ? 'Despacho lançado (simulação)' : 'Despacho lançado no SEI');
      recarrega();
    } catch (e) {
      toast(e.message, true);
      btnSei.disabled = false;
      btnSei.textContent = '📤 Enviar resposta ao SEI';
    }
  };

  // Concluir
  const btnConcluir = document.getElementById('a-concluir');
  if (btnConcluir) btnConcluir.onclick = async () => {
    await api.post(`/api/processos/${p.id}/concluir`);
    toast('Processo concluído');
    recarrega();
  };

  // Perito: salvar / enviar despacho
  const btnSalvar = document.getElementById('btn-salvar-despacho');
  const btnEnviar = document.getElementById('btn-enviar-despacho');
  const coletar = () => ({
    texto: document.getElementById('d-texto').value,
    conclusao: document.getElementById('d-conclusao').value,
  });
  if (btnSalvar) btnSalvar.onclick = async () => {
    const d = coletar();
    if (!d.texto.trim()) return toast('Escreva o texto do despacho', true);
    try { await api.post(`/api/despachos/processo/${p.id}`, d); toast('Rascunho salvo'); recarrega(); }
    catch (e) { toast(e.message, true); }
  };
  if (btnEnviar) btnEnviar.onclick = async () => {
    const d = coletar();
    if (!d.texto.trim()) return toast('Escreva o texto do despacho', true);
    try {
      await api.post(`/api/despachos/processo/${p.id}`, d);
      await api.post(`/api/despachos/processo/${p.id}/enviar`);
      toast('Despacho enviado para conferência');
      recarrega();
    } catch (e) { toast(e.message, true); }
  };
}

// ============================================================
// Usuários (admin)
// ============================================================
async function renderUsuarios() {
  shell('<div class="empty">Carregando…</div>');
  const usuarios = await api.get('/api/usuarios');
  setMain(`
    <div class="page-head">
      <div><h2>Usuários</h2><div class="desc">Gerencie operadores e peritos.</div></div>
      <button class="btn" id="btn-novo-user">＋ Novo usuário</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th></th></tr></thead>
      <tbody>${usuarios.map((u) => `
        <tr>
          <td>${esc(u.nome)}</td><td>${esc(u.email)}</td>
          <td style="text-transform:capitalize">${esc(u.papel)}</td>
          <td>${u.ativo ? '<span class="badge st-conferido">ativo</span>' : '<span class="badge st-devolvido">inativo</span>'}</td>
          <td><button class="btn secondary sm" data-edit="${u.id}" data-ativo="${u.ativo}">${u.ativo ? 'Desativar' : 'Ativar'}</button></td>
        </tr>`).join('')}</tbody>
    </table></div>
  `);
  document.getElementById('btn-novo-user').onclick = async () => {
    const r = await modal({
      titulo: 'Novo usuário',
      okLabel: 'Criar',
      corpo: `
        <div class="field"><label>Nome</label><input name="nome"></div>
        <div class="field"><label>E-mail</label><input name="email" type="email"></div>
        <div class="field"><label>Senha</label><input name="senha" type="text" placeholder="senha inicial"></div>
        <div class="field"><label>Papel</label><select name="papel">
          <option value="perito">Perito</option>
          <option value="operador">Operador</option>
          <option value="admin">Administrador</option>
        </select></div>`,
    });
    if (!r) return;
    try { await api.post('/api/usuarios', r); toast('Usuário criado'); renderUsuarios(); }
    catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = async () => {
      await api.put('/api/usuarios/' + b.dataset.edit, { ativo: b.dataset.ativo === '1' ? false : true });
      renderUsuarios();
    };
  });
}

// ============================================================
// Configuração do SEI (admin)
// ============================================================
async function renderConfigSei() {
  shell('<div class="empty">Carregando…</div>');
  // À prova de falha: se algo não carregar, usa padrões em vez de travar.
  const [cfgs, modo] = await Promise.all([
    api.get('/api/sei/config').catch(() => []),
    api.get('/api/sei/modo').catch(() => ({ simulacao: true, travadoPorEnv: false })),
  ]);
  const real = !modo.simulacao;
  setMain(`
    <div class="page-head">
      <div><h2>Configuração do SEI</h2><div class="desc">Credenciais de acesso do robô ao SEI de Nova Iguaçu.</div></div>
      <button class="btn" id="btn-nova-cfg">＋ Nova configuração</button>
    </div>

    <div class="card">
      <div class="card-h">Modo de operação</div>
      <div class="card-b">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div style="font-weight:600;font-size:16px">
              ${real ? '🟢 SEI REAL — acessando o SEI de verdade' : '🟡 Simulação — dados de exemplo'}
            </div>
            <div class="muted" style="margin-top:4px">
              ${real
                ? 'O robô vai logar no SEI com as credenciais cadastradas e extrair/lançar de verdade.'
                : 'O sistema usa processos de exemplo. Nada é enviado ao SEI. Bom para treinar.'}
            </div>
          </div>
          <button class="btn ${real ? 'warn' : 'ok'}" id="btn-modo" ${modo.travadoPorEnv ? 'disabled' : ''}>
            ${real ? 'Voltar para simulação' : 'Ativar SEI real'}
          </button>
        </div>
        ${modo.travadoPorEnv ? '<div class="muted" style="margin-top:10px">O modo está fixado pela variável de ambiente SEI_MOCK e não pode ser mudado por aqui.</div>' : ''}
        ${real ? '<div class="error-msg" style="min-height:auto;margin-top:12px">⚠ Modo real ligado: cadastre a configuração com usuário e senha do SEI abaixo antes de extrair.</div>' : ''}
      </div>
    </div>

    <div class="card"><div class="card-b muted">
      As senhas são guardadas criptografadas e nunca exibidas. O robô usa estas credenciais para logar no SEI e extrair os processos do “Controle de Processos” da unidade.
    </div></div>
    <div class="card">
      ${cfgs.length ? `<table>
        <thead><tr><th>Apelido</th><th>URL</th><th>Usuário</th><th>Unidade</th><th>Padrão</th><th></th></tr></thead>
        <tbody>${cfgs.map((c) => `
          <tr>
            <td>${esc(c.apelido)}</td><td class="muted">${esc(c.base_url)}</td>
            <td>${esc(c.usuario)}</td><td>${esc(c.unidade || '—')}</td>
            <td>${c.padrao ? '⭐' : ''}</td>
            <td><button class="btn danger sm" data-del="${c.id}">Excluir</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">Nenhuma configuração. Em modo simulação o sistema funciona sem cadastrar nada.</div>'}
    </div>
  `);
  const btnModo = document.getElementById('btn-modo');
  if (btnModo && !modo.travadoPorEnv) btnModo.onclick = async () => {
    const ativarReal = modo.simulacao; // se está em simulação, o clique ativa o real
    if (ativarReal) {
      const ok = await modal({
        titulo: 'Ativar SEI real',
        okLabel: 'Sim, ativar o SEI real',
        okClasse: 'btn ok',
        corpo: `<p>A partir de agora o robô vai <b>acessar o SEI de verdade</b> com as credenciais cadastradas.
          Confirme que já cadastrou a configuração com <b>usuário e senha</b> do SEI.</p>`,
      });
      if (!ok) return;
    }
    await api.post('/api/sei/modo', { simulacao: !ativarReal });
    toast(ativarReal ? 'Modo SEI real ativado' : 'Voltou para simulação');
    renderConfigSei();
  };

  document.getElementById('btn-nova-cfg').onclick = async () => {
    const r = await modal({
      titulo: 'Nova configuração do SEI',
      okLabel: 'Salvar',
      corpo: `
        <div class="field"><label>Apelido</label><input name="apelido" placeholder="Perícia - Unidade X"></div>
        <div class="field"><label>URL base do SEI</label><input name="base_url" value="https://sei.novaiguacu.rj.gov.br/sei"></div>
        <div class="row">
          <div class="field"><label>Órgão (se houver)</label><input name="orgao" placeholder="opcional"></div>
          <div class="field"><label>Unidade (infra_unidade_atual)</label><input name="unidade" placeholder="110001126"></div>
        </div>
        <div class="field"><label>Usuário SEI</label><input name="usuario"></div>
        <div class="field"><label>Senha SEI</label><input name="senha" type="password"></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:6px 0 16px">
        <div style="font-weight:600;margin-bottom:10px">Lançamento automático do despacho</div>
        <div class="row">
          <div class="field"><label>Tipo de documento</label><input name="tipo_documento" value="Despacho"></div>
          <div class="field"><label>Nível de acesso</label><select name="nivel_acesso">
            <option value="publico">Público</option>
            <option value="restrito">Restrito</option>
          </select></div>
        </div>
        <div class="field"><label>Enviar processo à unidade (opcional)</label><input name="unidade_destino" placeholder="ex.: SEMUS ou sigla da unidade de destino"></div>`,
    });
    if (!r) return;
    try { await api.post('/api/sei/config', { ...r, padrao: 1 }); toast('Configuração salva'); renderConfigSei(); }
    catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => { await api.del('/api/sei/config/' + b.dataset.del); renderConfigSei(); };
  });
}

// ============================================================
// Inicialização
// ============================================================
(async function init() {
  try {
    usuario = await api.get('/api/auth/me');
    shell('<div class="empty">Carregando…</div>');
    navegar();
  } catch {
    renderLogin();
  }
})();
