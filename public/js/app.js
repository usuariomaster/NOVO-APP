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
    root.querySelector('.modal-back').onclick = (e) => { if (e.target.classList.contains('modal-back')) fechar(null); };
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
  if (hash.startsWith('#processo/')) {
    return renderProcessoDetalhe(hash.split('/')[1]);
  }
  const fn = rotas[hash] || renderPainel;
  fn();
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
      <div><h2>${isOper ? 'Controle de Processos' : 'Meus Processos'}</h2>
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
  if (!procs.length) {
    cont.innerHTML = `<div class="empty">Nenhum processo encontrado.</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr>
        <th>Nº do processo</th><th>Assunto / Interessado</th><th>Perito</th>
        <th>Prioridade</th><th>Status</th><th>Atualizado</th>
      </tr></thead>
      <tbody>
        ${procs.map((p) => `
          <tr data-id="${p.id}">
            <td class="num-proc">${esc(p.numero_sei)}</td>
            <td>${esc(p.especificacao || p.tipo || '—')}<br><span class="muted">${esc(p.interessado || '')}</span></td>
            <td>${esc(p.perito_nome || '—')}</td>
            <td>${badgePr(p.prioridade)}</td>
            <td>${badge(p.status)}</td>
            <td class="muted">${dataHora(p.atualizado_em)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  cont.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = () => (location.hash = `#processo/${tr.dataset.id}`);
  });
}

async function extrairDoSei() {
  const btn = document.getElementById('btn-extrair');
  btn.disabled = true;
  btn.textContent = '⏳ Extraindo…';
  try {
    const r = await api.post('/api/sei/extrair');
    const aviso = r.modo === 'simulacao' ? ' (modo simulação)' : '';
    toast(`Extração concluída${aviso}: ${r.novos} novo(s), ${r.ignorados} já existente(s).`);
    carregarLista(document.getElementById('busca').value, document.getElementById('filtro-status').value);
  } catch (err) {
    toast(err.message, true);
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
    ? `<ul style="margin:0;padding-left:18px">${p.documentos.map((d) => `<li>${esc(d.tipo || 'Documento')} ${esc(d.numero || '')} <span class="muted">${esc(d.data || '')}</span></li>`).join('')}</ul>`
    : '<span class="muted">Nenhum documento importado.</span>';

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
          ${p.link_sei ? `• <a href="${esc(p.link_sei)}" target="_blank" rel="noopener">abrir no SEI ↗</a>` : ''}</div>
      </div>
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
    return `
      <div class="card">
        <div class="card-h">Despacho ${d.conclusao ? `— <strong>${esc(d.conclusao)}</strong>` : ''}</div>
        <div class="card-b">
          <div style="white-space:pre-wrap">${esc(d.texto)}</div>
          ${d.motivo_devolucao && d.status === 'devolvido' ? `<div class="error-msg" style="min-height:auto;margin-top:10px">↩ ${esc(d.motivo_devolucao)}</div>` : ''}
        </div>
      </div>`;
  }
  return '';
}

function renderAcoes(p, isOper, isPerito) {
  const acoes = [];
  if (isOper) {
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

  // Enviar ao SEI
  const btnSei = document.getElementById('a-enviar-sei');
  if (btnSei) btnSei.onclick = async () => {
    const r = await modal({
      titulo: 'Enviar resposta ao SEI',
      okLabel: 'Confirmar envio',
      corpo: `<p>Confirme que o despacho foi lançado no SEI para o processo <b>${esc(p.numero_sei)}</b>. Isto marca o processo como enviado.</p>`,
    });
    if (!r) return;
    await api.post(`/api/processos/${p.id}/enviar-sei`);
    toast('Resposta registrada como enviada ao SEI');
    recarrega();
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
  const cfgs = await api.get('/api/sei/config');
  setMain(`
    <div class="page-head">
      <div><h2>Configuração do SEI</h2><div class="desc">Credenciais de acesso do robô ao SEI de Nova Iguaçu.</div></div>
      <button class="btn" id="btn-nova-cfg">＋ Nova configuração</button>
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
        <div class="field"><label>Senha SEI</label><input name="senha" type="password"></div>`,
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
