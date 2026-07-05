import { api } from './api.js';

// ============================================================
// Estado + utilidades
// ============================================================
let usuario = null;
const appEl = () => document.getElementById('app');

// Helpers de papel (com hierarquia)
const ehAdmin = () => ['admin', 'admin_master'].includes(usuario.papel);
const ehOper = () => ['operador', 'admin', 'admin_master'].includes(usuario.papel);
const ehPerito = () => ['perito', 'perito_admin'].includes(usuario.papel);
const podeSei = () => ['admin_master', 'perito_admin'].includes(usuario.papel); // pode tramitar direto no SEI

const PAPEL_LABEL = {
  admin: 'Administrador', admin_master: 'Administrador Master',
  operador: 'Operador', perito: 'Perito', perito_admin: 'Perito Administrador',
};

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
const TIPOS_PERICIA = ['Contestação de atestados', 'Prestação de informações', 'Reconsideração', 'Revisão', 'Readaptação', 'Perícia médica', 'Outros'];

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

// Só a data (AAAA-MM-DD ou DD/MM/AAAA) -> DD/MM/AAAA.
function dataBR(s) {
  if (!s) return '—';
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(s).slice(0, 10);
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
      root.querySelectorAll('[name]').forEach((i) => (dados[i.name] = i.type === 'checkbox' ? i.checked : i.value));
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
  '#caixa': renderCaixaEntrada,
  '#fila': renderProcessos,
  '#processos': renderProcessos,
  '#arquivo': renderArquivo,
  '#servidores': renderServidores,
  '#ocorrencias': renderOcorrencias,
  '#juntas': renderJuntas,
  '#mensageiro': renderMensageiro,
  '#usuarios': renderUsuarios,
  '#sei': renderConfigSei,
  '#ia': renderConfigIa,
  '#config-pericia': renderConfigPericia,
};

async function navegar() {
  if (!usuario) return; // deslogado: nada a renderizar (o login cuida da tela)
  const hash = location.hash;
  const fn = hash.startsWith('#processo/')
    ? () => renderProcessoDetalhe(hash.split('/')[1])
    : hash.startsWith('#servidor/')
    ? () => renderServidorDetalhe(hash.split('/')[1])
    : hash.startsWith('#junta/')
    ? () => renderJuntaDetalhe(hash.split('/')[1])
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
  const isAdmin = usuario.papel === 'admin' || usuario.papel === 'admin_master';
  const isOper = usuario.papel === 'operador' || isAdmin;
  const isPerito = usuario.papel === 'perito' || usuario.papel === 'perito_admin';
  const nav = (isPerito ? [
    `<a href="#painel">📊 Painel</a>`,
    `<a href="#processos">📋 Meus casos</a>`,
    `<a href="#juntas">⚖️ Junta Médica</a>`,
    `<a href="#servidores">🧑‍⚕️ Servidores</a>`,
  ] : [
    `<a href="#painel">📊 Painel</a>`,
    `<a href="#caixa">📥 Caixa de entrada <span class="badge-caixa"></span></a>`,
    `<a href="#fila">🗓️ Fila do dia</a>`,
    `<a href="#servidores">🧑‍⚕️ Servidores</a>`,
    `<a href="#juntas">⚖️ Junta Médica</a>`,
    isOper ? `<a href="#mensageiro">🚚 Malote</a>` : '',
    `<a href="#arquivo">🗄️ Arquivo</a>`,
    isAdmin ? `<a href="#usuarios">👥 Usuários &amp; Peritos</a>` : '',
    isAdmin ? `<a href="#config-pericia">⚙️ Config. da Perícia</a>` : '',
    isAdmin ? `<a href="#sei">🔗 Configuração SEI</a>` : '',
    isAdmin ? `<a href="#ia">🤖 Configuração da IA</a>` : '',
  ]).join('');

  appEl().innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">SisPerícia<small>Despachos da Perícia</small></div>
        <nav class="nav">${nav}</nav>
        <div class="user">
          <div class="nome">${esc(usuario.nome)}</div>
          <div class="papel">${esc(PAPEL_LABEL[usuario.papel] || usuario.papel)}</div>
          <button id="btn-senha" class="secondary">🔒 Trocar senha</button>
          <button id="btn-sair">Sair</button>
        </div>
      </aside>
      <main class="main">
        <div id="aviso-topo">${usuario.senha_padrao ? `<div class="aviso-seguranca">
          🔒 <b>Senha padrão em uso.</b> Este acesso ainda usa a senha de fábrica (<code>admin123</code>).
          Troque agora para proteger o sistema. <button id="aviso-trocar">Trocar senha</button></div>` : ''}</div>
        <div id="main-content">${conteudo}</div>
      </main>
    </div>`;
  document.getElementById('btn-sair').onclick = async () => {
    await api.post('/api/auth/logout');
    usuario = null;
    location.hash = '';
    renderLogin();
  };
  document.getElementById('btn-senha').onclick = trocarSenha;
  const avisoBtn = document.getElementById('aviso-trocar');
  if (avisoBtn) avisoBtn.onclick = trocarSenha;
  navegar._marcarNav?.();
  atualizarBadgeCaixa();
}

// Mostra quantos itens estão aguardando triagem na Caixa de entrada.
async function atualizarBadgeCaixa() {
  const el = document.querySelector('.badge-caixa');
  if (!el) return;
  try {
    const r = await api.get('/api/processos/caixa-entrada');
    if (r.total > 0) { el.textContent = r.total; el.classList.add('on'); }
    else { el.textContent = ''; el.classList.remove('on'); }
  } catch { /* ignora */ }
}

// Troca da própria senha (primeiro acesso / rotina de segurança).
async function trocarSenha() {
  const r = await modal({ titulo: '🔒 Trocar minha senha', okLabel: 'Salvar', corpo: `
    <div class="field"><label>Senha atual</label><input type="password" name="senha_atual" autocomplete="current-password"></div>
    <div class="field"><label>Nova senha (mínimo 6 caracteres)</label><input type="password" name="nova_senha" autocomplete="new-password"></div>
    <div class="field"><label>Repita a nova senha</label><input type="password" name="confirmar" autocomplete="new-password"></div>` });
  if (!r) return;
  if (!r.nova_senha || r.nova_senha.length < 6) return toast('A nova senha deve ter ao menos 6 caracteres.', true);
  if (r.nova_senha !== r.confirmar) return toast('A confirmação não confere com a nova senha.', true);
  try {
    await api.post('/api/auth/trocar-senha', { senha_atual: r.senha_atual, nova_senha: r.nova_senha });
    usuario.senha_padrao = false;
    const t = document.getElementById('aviso-topo'); if (t) t.innerHTML = '';
    toast('Senha alterada com sucesso.');
  } catch (e) { toast(e.message, true); }
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
// Calcula o farol de prazo de um processo.
function farol(p, cfg) {
  if (['concluido', 'enviado_sei'].includes(p.status)) return { cor: '', dot: '✔', label: 'concluído', dias: null };
  const ref = p.distribuido_em || p.data_entrada || p.criado_em;
  if (!ref) return { cor: 'v', dot: '🟢', label: '—', dias: 0 };
  const d = new Date(ref.replace(' ', 'T') + (ref.includes('T') ? '' : 'Z'));
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= cfg.prazo_dias) return { cor: 'v', dot: '🟢', label: `${dias}d (no prazo)`, dias };
  if (dias <= cfg.prazo_dias + cfg.atraso_dias) return { cor: 'a', dot: '🟡', label: `${dias}d (passou do prazo)`, dias };
  return { cor: 'r', dot: '🔴', label: `${dias}d (atrasado)`, dias };
}

async function renderPainel() {
  shell('<div class="empty">Carregando…</div>');
  const isPerito = ehPerito();
  const isOper = ehOper();
  const [procs, cfg, tipos, ocor, servs] = await Promise.all([
    api.get('/api/processos'),
    api.get('/api/processos/config-prazos').catch(() => ({ prazo_dias: 10, atraso_dias: 5 })),
    api.get('/api/processos/tipos').catch(() => []),
    api.get('/api/processos/ocorrencias').catch(() => ({ ocorrencias: [], porCid: {} })),
    isPerito ? Promise.resolve([]) : api.get('/api/servidores').catch(() => []),
  ]);

  const emTramite = procs.filter((p) => !['concluido'].includes(p.status));
  const contagem = { v: 0, a: 0, r: 0 };
  for (const p of emTramite) { const f = farol(p, cfg); if (f.cor) contagem[f.cor]++; }

  // KPIs de visão geral (é isto que diferencia o Painel da lista de Processos).
  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="n">${emTramite.length}</div><div class="l">Em tramitação</div></div>
      <div class="kpi"><div class="n">🟢 ${contagem.v}</div><div class="l">No prazo</div></div>
      <div class="kpi"><div class="n">🟡 ${contagem.a}</div><div class="l">Passou do prazo</div></div>
      <div class="kpi"><div class="n">🔴 ${contagem.r}</div><div class="l">Atrasado</div></div>
      ${!isPerito ? `<div class="kpi"><div class="n">${servs.length}</div><div class="l">Servidores</div></div>
      <div class="kpi"><div class="n">${(ocor.ocorrencias || []).length}</div><div class="l">Ocorrências (CID)</div></div>` : ''}
    </div>`;

  // Só os processos que EXIGEM atenção (🟡🔴) — a lista completa é a tela Processos.
  const urgentes = emTramite.filter((p) => ['a', 'r'].includes(farol(p, cfg).cor))
    .sort((a, b) => (farol(b, cfg).dias || 0) - (farol(a, cfg).dias || 0)).slice(0, 12);
  const linhas = urgentes.map((p) => {
    const f = farol(p, cfg);
    return `<tr data-id="${p.id}">
      <td style="font-size:18px" title="${esc(f.label)}">${f.dot}</td>
      <td class="num-proc">${esc(p.numero_sei)}</td>
      <td><b>${esc(p.interessado || '—')}</b><br><span class="muted">${esc(p.especificacao || p.tipo || '')}</span></td>
      ${isOper ? `<td>${esc(p.perito_nome || '<sem perito>')}</td>` : ''}
      <td>${badge(p.status)}</td><td class="muted">${esc(f.label)}</td></tr>`;
  }).join('');

  // Mini-painéis: por assunto e por CID.
  const topAssunto = (tipos || []).slice(0, 6).map((t) =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(t.assunto)}</span><b>${t.total}</b></div>`).join('') || '<span class="muted">—</span>';
  const topCid = Object.entries(ocor.porCid || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(c)}</span><b>${n}</b></div>`).join('') || '<span class="muted">—</span>';

  const configBtn = ehAdmin()
    ? `<button class="btn secondary" id="btn-prazos">⏱ Configurar prazos (${cfg.prazo_dias}d / ${cfg.atraso_dias}d)</button>` : '';

  setMain(`
    <div class="page-head">
      <div><h2>Painel</h2><div class="desc">Olá, ${esc(usuario.nome)}. Visão geral da perícia.</div></div>
      ${configBtn}
    </div>
    ${kpis}
    <div class="card">
      <div class="card-h">⚠️ Precisam de atenção (fora do prazo) <a href="#processos" class="muted" style="font-weight:400;font-size:13px">ver todos os processos →</a></div>
      <div>${urgentes.length ? `<table>
        <thead><tr><th>Prazo</th><th>Nº</th><th>Servidor / assunto</th>${isOper ? '<th>Médico</th>' : ''}<th>Status</th><th>Tempo</th></tr></thead>
        <tbody>${linhas}</tbody></table>` : '<div class="empty">Tudo dentro do prazo 🎉</div>'}</div>
    </div>
    ${!isPerito ? `<div class="detail-grid">
      <div class="card"><div class="card-h">Processos por assunto</div><div class="card-b">${topAssunto}</div></div>
      <div class="card"><div class="card-h">Ocorrências por CID</div><div class="card-b">${topCid}</div></div>
    </div>` : ''}
  `);

  document.querySelectorAll('#main-content tr[data-id]').forEach((tr) => {
    tr.onclick = () => (location.hash = `#processo/${tr.dataset.id}`);
  });

  const btnPrazos = document.getElementById('btn-prazos');
  if (btnPrazos) btnPrazos.onclick = async () => {
    const r = await modal({
      titulo: 'Configurar prazos',
      okLabel: 'Salvar',
      corpo: `<p class="muted">Dias a partir da distribuição ao perito.</p>
        <div class="row">
          <div class="field"><label>🟢 No prazo até (dias)</label><input name="prazo_dias" type="number" value="${cfg.prazo_dias}"></div>
          <div class="field"><label>🟡 Tolerância extra (dias)</label><input name="atraso_dias" type="number" value="${cfg.atraso_dias}"></div>
        </div>
        <p class="muted">🔴 atrasado = acima de ${cfg.prazo_dias} + tolerância.</p>`,
    });
    if (!r) return;
    await api.post('/api/processos/config-prazos', { prazo_dias: Number(r.prazo_dias), atraso_dias: Number(r.atraso_dias) });
    toast('Prazos atualizados');
    renderPainel();
  };
}

// ============================================================
// Caixa de entrada — as 3 portas (SEI · físico · WhatsApp)
// ============================================================
const CANAL_TAG = {
  sei: '<span class="canal sei">SEI</span>',
  fisico: '<span class="canal fis">Físico</span>',
  whatsapp: '<span class="canal wa">WhatsApp</span>',
};
async function renderCaixaEntrada() {
  shell('<div class="empty">Carregando…</div>');
  const cfg = await api.get('/api/processos/config-prazos').catch(() => ({ prazo_dias: 10, atraso_dias: 5 }));
  const desenhar = async () => {
    const r = await api.get('/api/processos/caixa-entrada');
    const linha = (p) => {
      const f = farol(p, cfg);
      const cor = f.cor || 'v';
      return `<tr data-id="${p.id}">
        <td><span class="stripe ${cor}"></span></td>
        <td><b>${esc(p.interessado || '—')}</b>${!p.interessado ? ' <span class="canal gh">identificar</span>' : ''}<br>
          <span class="muted">${esc(p.especificacao || p.tipo || 'sem assunto')}</span></td>
        <td class="num-proc">${esc(p.numero_sei)}</td>
        <td>${CANAL_TAG[p.canal] || CANAL_TAG.sei}</td>
        <td class="muted">${dataBR(p.data_entrada)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn secondary sm" data-abrir="${p.id}">Abrir</button>
          <button class="btn sm" data-triar="${p.id}">Triar → fila</button></td></tr>`;
    };
    document.getElementById('cx-canais').innerHTML = `
      <div class="kpi"><div class="n">${r.porCanal.sei || 0}</div><div class="l">SEI</div></div>
      <div class="kpi"><div class="n">${r.porCanal.fisico || 0}</div><div class="l">Físico / malote</div></div>
      <div class="kpi"><div class="n">${r.porCanal.whatsapp || 0}</div><div class="l">WhatsApp</div></div>
      <div class="kpi"><div class="n">${r.total}</div><div class="l">Total a triar</div></div>`;
    document.getElementById('cx-lista').innerHTML = r.itens.length ? `<table>
      <thead><tr><th></th><th>Servidor / assunto</th><th>Nº</th><th>Canal</th><th>Entrada</th><th></th></tr></thead>
      <tbody>${r.itens.map(linha).join('')}</tbody></table>`
      : '<div class="empty">Caixa vazia — tudo triado. 🎉</div>';
    document.querySelectorAll('#cx-lista [data-abrir]').forEach((b) => b.onclick = () => (location.hash = `#processo/${b.dataset.abrir}`));
    document.querySelectorAll('#cx-lista [data-triar]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation();
      try { await api.post(`/api/processos/${b.dataset.triar}/triar`, {}); toast('Enviado à fila do dia'); desenhar(); atualizarBadgeCaixa(); }
      catch (err) { toast(err.message, true); }
    });
  };
  setMain(`
    <div class="page-head"><div>
      <h2>📥 Caixa de entrada</h2>
      <div class="desc">O que chegou pelas 3 portas e ainda não foi triado. Identifique o servidor, confira e mande para a fila.</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn secondary" id="cx-registrar">＋ Registrar entrada</button>
      <button class="btn secondary" id="cx-extrair">⬇️ Extrair do SEI</button>
    </div></div>
    <div class="kpis" id="cx-canais"></div>
    <div class="card"><div id="cx-lista"><div class="empty">Carregando…</div></div></div>
  `);
  document.getElementById('cx-extrair').onclick = () => { location.hash = '#fila'; setTimeout(extrairDoSei, 300); };
  document.getElementById('cx-registrar').onclick = async () => {
    const r = await modal({ titulo: 'Registrar entrada (físico / WhatsApp)', okLabel: 'Registrar', corpo: `
      <div class="field"><label>Canal de entrada</label>
        <select name="canal"><option value="fisico">🚚 Físico / malote</option><option value="whatsapp">💬 WhatsApp (manual)</option></select></div>
      <div class="field"><label>Servidor / interessado</label><input name="interessado"></div>
      <div class="field"><label>Assunto</label><input name="especificacao" placeholder="ex.: Atestado, Reconsideração"></div>
      <div class="field"><label>Nº (deixe vazio para gerar automático)</label><input name="numero_sei"></div>` });
    if (!r) return;
    try { const c = await api.post('/api/processos/fisico', r); toast(`Entrada registrada: ${c.numero_sei}`); desenhar(); atualizarBadgeCaixa(); }
    catch (e) { toast(e.message, true); }
  };
  await desenhar();
}

// ============================================================
// Arquivo — processos arquivados (guardados no prontuário)
// ============================================================
async function renderArquivo() {
  shell('<div class="empty">Carregando…</div>');
  const procs = await api.get('/api/processos?status=arquivado');
  setMain(`
    <div class="page-head"><div>
      <h2>🗄️ Arquivo</h2>
      <div class="desc">Processos arquivados — encerrados e guardados no prontuário do servidor para consulta.</div>
    </div></div>
    <div class="card"><div id="arq-lista">${procs.length ? `<table>
      <thead><tr><th>Nº</th><th>Servidor</th><th>Assunto</th><th>Arquivado</th><th></th></tr></thead>
      <tbody>${procs.map((p) => `<tr data-id="${p.id}" style="cursor:pointer">
        <td class="num-proc">${esc(p.numero_sei)}</td><td><b>${esc(p.interessado || '—')}</b></td>
        <td>${esc(p.especificacao || p.tipo || '—')}</td><td class="muted">${dataBR(p.arquivado_em)}</td>
        <td>${p.pdf_processo ? `<a class="btn secondary sm" href="/api/processos/${p.id}/pdf" target="_blank" rel="noopener" onclick="event.stopPropagation()">📄 PDF</a>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhum processo arquivado.</div>'}</div></div>
  `);
  document.querySelectorAll('#arq-lista tr[data-id]').forEach((tr) => tr.onclick = () => (location.hash = `#processo/${tr.dataset.id}`));
}

// ============================================================
// Lista de processos
// ============================================================
async function renderProcessos() {
  shell('<div class="empty">Carregando…</div>');
  const isOper = ehOper();
  const botoes = isOper
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
         <button class="btn secondary" id="btn-fisico">＋ Processo físico</button>
         <button class="btn secondary" id="btn-conteudo-todos">🔎 Buscar conteúdo de todos</button>
         <button class="btn" id="btn-extrair">⬇️ Extrair do SEI</button>
       </div>` : '';

  setMain(`
    <div class="page-head">
      <div><h2>${isOper ? 'Controle de Processos' : 'Meus Processos'} <span id="contador-proc" class="badge pr-normal" style="font-size:14px">…</span></h2>
      <div class="desc">${isOper ? 'Processos do SEI e físicos, e sua distribuição.' : 'Processos distribuídos a você para despacho.'}</div></div>
      ${botoes}
    </div>
    <div class="toolbar">
      <input type="search" id="busca" placeholder="Buscar nº, interessado, assunto…" />
      <select id="filtro-status">
        <option value="">Todos os status</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        <option value="arquivado">🗄️ Arquivados</option>
      </select>
      <select id="filtro-tipo">
        <option value="">Todos os assuntos</option>
        ${TIPOS_PERICIA.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
      </select>
    </div>
    <div class="card"><div id="lista-proc"><div class="empty">Carregando…</div></div></div>
  `);

  if (isOper) {
    document.getElementById('btn-extrair').onclick = extrairDoSei;
    document.getElementById('btn-conteudo-todos').onclick = buscarConteudoTodos;
    document.getElementById('btn-fisico').onclick = async () => {
      const r = await modal({
        titulo: 'Novo processo físico',
        okLabel: 'Criar',
        corpo: `
          <div class="field"><label>Nº do processo (deixe vazio para gerar automático)</label><input name="numero_sei"></div>
          <div class="field"><label>Interessado / Servidor</label><input name="interessado"></div>
          <div class="field"><label>Assunto</label><input name="especificacao"></div>
          <div class="row">
            <div class="field"><label>Secretaria de destino</label><input name="secretaria_destino" placeholder="ex.: SEMAD"></div>
            <div class="field"><label>Prioridade</label><select name="prioridade">
              ${PRIORIDADES.map((x) => `<option value="${x}" ${x === 'normal' ? 'selected' : ''}>${x}</option>`).join('')}
            </select></div>
          </div>`,
      });
      if (!r) return;
      try { const c = await api.post('/api/processos/fisico', r); toast(`Processo físico criado: ${c.numero_sei}`); carregarLista('', ''); }
      catch (e) { toast(e.message, true); }
    };
  }
  const busca = document.getElementById('busca');
  const filtro = document.getElementById('filtro-status');
  const filtroTipo = document.getElementById('filtro-tipo');
  const recarregar = () => carregarLista(busca.value, filtro.value, filtroTipo.value);
  let deb;
  busca.oninput = () => { clearTimeout(deb); deb = setTimeout(recarregar, 300); };
  filtro.onchange = recarregar;
  filtroTipo.onchange = recarregar;
  // Preenche o filtro de assunto com as categorias REAIS (pedidos, recursos…).
  api.get('/api/processos/tipos').then((tipos) => {
    const atuais = new Set([...filtroTipo.options].map((o) => o.value));
    for (const t of tipos) {
      if (!t.assunto || atuais.has(t.assunto)) continue;
      const o = document.createElement('option');
      o.value = t.assunto; o.textContent = `${t.assunto} (${t.total})`;
      filtroTipo.appendChild(o);
    }
  }).catch(() => {});
  carregarLista('', '', '');
}

async function carregarLista(q, status, tipo) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (tipo) params.set('tipo', tipo);
  const procs = await api.get('/api/processos?' + params.toString());
  const cont = document.getElementById('lista-proc');
  if (!cont) return;
  const contador = document.getElementById('contador-proc');
  if (contador) contador.textContent = `${procs.length} processo(s)`;
  if (!procs.length) {
    cont.innerHTML = `<div class="empty">Nenhum processo encontrado.</div>`;
    return;
  }
  const podeExcluir = ehOper();
  cont.innerHTML = `
    <table>
      <thead><tr>
        <th>Nº do processo</th><th>Servidor</th><th>Assunto</th><th>Entrada</th><th>Enc. perícia</th>
        <th>Perito</th><th>Status</th>${podeExcluir ? '<th></th>' : ''}
      </tr></thead>
      <tbody>
        ${procs.map((p) => `
          <tr data-id="${p.id}">
            <td class="num-proc">${esc(p.numero_sei)} ${p.fisico ? '<span class="badge pr-alta" style="font-size:11px">físico</span>' : ''}</td>
            <td><b>${esc(p.interessado || '—')}</b></td>
            <td>${esc(p.especificacao || p.tipo || '—')}</td>
            <td class="muted">${dataBR(p.data_entrada)}</td>
            <td class="muted">${dataBR(p.data_encaminhado || p.data_autuacao)}</td>
            <td>${esc(p.perito_nome || '—')}</td>
            <td>${badge(p.status)}</td>
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
      try { await api.del('/api/processos/' + b.dataset.del); toast('Processo excluído'); carregarLista(q, status, tipo); }
      catch (err) { toast(err.message, true); }
    };
  });
}

// Busca o conteúdo (nome/assunto/tipo + documentos) de TODOS os processos
// que ainda estão sem conteúdo. Roda em segundo plano no servidor e a tela
// acompanha o progresso.
async function buscarConteudoTodos() {
  const btn = document.getElementById('btn-conteudo-todos');
  if (!confirm('Buscar no SEI o conteúdo de todos os processos que ainda estão sem nome/assunto?\n\nO robô abre cada processo, lê nome/assunto/documentos e — se a IA estiver configurada — captura a ficha funcional por OCR e preenche o cadastro do servidor sozinho.\n\nPode levar alguns minutos. Você pode continuar usando o sistema.')) return;
  btn.disabled = true;
  const original = btn.textContent;
  try {
    const ini = await api.post('/api/processos/detalhar-todos', {});
    if (ini.total === 0) { toast(ini.mensagem || 'Nada a buscar.'); btn.disabled = false; btn.textContent = original; return; }
    toast(`Buscando conteúdo de ${ini.total} processo(s)…`);
    // Poll de progresso.
    const timer = setInterval(async () => {
      let st;
      try { st = await api.get('/api/processos/detalhar-todos/status'); } catch { return; }
      btn.textContent = `⏳ ${st.feitos}/${st.total}${st.atual ? ' — ' + st.atual : ''}`;
      if (!st.rodando) {
        clearInterval(timer);
        btn.disabled = false; btn.textContent = original;
        const fichas = st.comFicha ? `, ${st.fichas || 0} ficha(s) por OCR${st.afastamentos ? `, ${st.afastamentos} afastamento(s)` : ''}${st.semFicha ? `, ${st.semFicha} sem ficha ⚠️` : ''}` : '';
        toast(`Concluído: ${st.novos} com nome${fichas}, ${st.erros} com erro, de ${st.total}.`);
        carregarLista(document.getElementById('busca').value, document.getElementById('filtro-status').value, document.getElementById('filtro-tipo')?.value || '');
      }
    }, 2500);
  } catch (e) {
    btn.disabled = false; btn.textContent = original;
    if (e.dados?.status) toast('Já existe uma busca em andamento.', true);
    else toast(e.message, true);
  }
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
    // Resumo da extração.
    if (r.modo === 'sei') {
      const resumoNome = typeof r.comNome === 'number' ? ` <span class="muted">(${r.comNome} já com nome e assunto)</span>` : '';
      await modal({
        titulo: 'Extração concluída',
        okLabel: 'Ver processos',
        corpo: `<p><b>${r.novos}</b> novo(s) e <b>${r.ignorados}</b> já existente(s).${resumoNome}</p>
          <p class="muted" style="margin-top:6px">Use <b>"🔎 Buscar conteúdo de todos"</b> para completar documentos, ficha e afastamentos.</p>`,
      });
    } else {
      toast(`Extração concluída${aviso}: ${r.novos} novo(s), ${r.ignorados} já existente(s).`);
    }
    carregarLista(document.getElementById('busca').value, document.getElementById('filtro-status').value, document.getElementById('filtro-tipo')?.value || '');
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
// Servidores (pessoas periciadas) — cadastro + dashboard
// ============================================================
// Ficha funcional agrupada (espelha a tela de RH da Prefeitura).
const GRUPOS_SERV = [
  ['Identificação', [
    ['nome', 'Nome'], ['prontuario', 'Prontuário nº (perícia)'], ['cpf', 'CPF'], ['matricula', 'Matrícula'], ['data_nascimento', 'Nascimento'],
    ['sexo', 'Sexo'], ['estado_civil', 'Estado civil'], ['nacionalidade', 'Nacionalidade'],
    ['naturalidade', 'Naturalidade'], ['uf_naturalidade', 'UF nat.'], ['grau_instrucao', 'Grau de instrução'],
    ['pai', 'Pai'], ['mae', 'Mãe'],
  ]],
  ['Documentação', [
    ['identidade', 'Identidade (RG)'], ['identidade_emissao', 'Emissão RG'], ['identidade_orgao', 'Órgão emissor'],
    ['titulo_eleitor', 'Título de eleitor'], ['zona', 'Zona'], ['secao', 'Seção'],
    ['ctps', 'CTPS'], ['ctps_serie', 'Série CTPS'], ['ctps_uf', 'UF CTPS'], ['nit', 'NIT'], ['pis_pasep', 'PIS/PASEP'],
  ]],
  ['Dados funcionais', [
    ['cargo', 'Cargo'], ['classificacao_funcional', 'Classificação funcional'], ['funcao', 'Função'],
    ['cbo', 'CBO'], ['cbo_mt', 'CBO MT'], ['simbologia', 'Simbologia'],
    ['secretaria', 'Secretaria'], ['lotacao', 'Lotação'], ['setor', 'Setor'], ['unidade_trabalho', 'Unidade de trabalho'],
    ['situacao', 'Situação'], ['vinculo', 'Vínculo'], ['vinculo_empregaticio', 'Vínculo empregatício'],
    ['regime_previdencia', 'Regime previdência'], ['tipo_admissao', 'Tipo de admissão'],
    ['data_admissao', 'Admissão'], ['data_posse', 'Posse'], ['data_exercicio', 'Exercício'],
    ['data_concurso', 'Concurso'], ['num_portaria', 'Nº da Portaria'], ['data_publicacao', 'Publicação'],
    ['tipo_salario', 'Tipo de salário'], ['carga_horaria', 'Carga horária'], ['data_demissao', 'Demissão'],
  ]],
  ['Endereço / contato', [
    ['endereco', 'Endereço'], ['numero_ende', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'],
    ['municipio', 'Município'], ['uf_ende', 'UF'], ['cep', 'CEP'], ['telefone', 'Telefone'],
    ['celular', 'Celular'], ['email', 'E-mail'],
  ]],
];
const CAMPOS_TEXTAREA = new Set(['pai', 'mae', 'observacoes', 'atividades', 'agentes_nocivos', 'ppp_atividades', 'ltcat', 'pcmso']);

// Controle de ocorrências com CID — afastamentos de todos os servidores.
async function renderOcorrencias() {
  shell('<div class="empty">Carregando…</div>');
  const desenhar = async (cid) => {
    const r = await api.get('/api/processos/ocorrencias' + (cid ? '?cid=' + encodeURIComponent(cid) : ''));
    const resumo = Object.entries(r.porCid || {}).sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `<span class="badge pr-normal" style="margin:2px">${esc(c)}: <b>${n}</b></span>`).join(' ');
    const linhas = r.ocorrencias.length ? `<table>
      <thead><tr><th>Servidor</th><th>CID</th><th>Tipo</th><th>Início</th><th>Fim</th><th>Dias</th><th>Processo</th></tr></thead>
      <tbody>${r.ocorrencias.map((o) => `<tr data-serv="${o.servidor_id}" style="cursor:pointer">
        <td><b>${esc(o.servidor_nome)}</b><br><span class="muted">${esc(o.matricula || '')}</span></td>
        <td><b>${esc(o.cid || '—')}</b>${o.cid2 ? '/' + esc(o.cid2) : ''}</td>
        <td>${esc(o.tipo || '—')}</td><td class="muted">${dataBR(o.data_inicio)}</td>
        <td class="muted">${dataBR(o.data_fim)}</td><td>${o.dias ?? '—'}</td>
        <td class="num-proc">${esc(o.numero_sei || '—')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhuma ocorrência registrada. Elas são criadas ao ler os despachos/afastamentos ou manualmente na ficha do servidor.</div>';
    document.getElementById('oc-resumo').innerHTML = resumo || '<span class="muted">Sem CIDs ainda.</span>';
    document.getElementById('oc-lista').innerHTML = linhas;
    document.querySelectorAll('#oc-lista tr[data-serv]').forEach((tr) => { tr.onclick = () => (location.hash = `#servidor/${tr.dataset.serv}`); });
  };
  setMain(`
    <div class="page-head"><div>
      <a href="#servidores" class="muted">← servidores</a>
      <h2 style="margin-top:4px">🩺 Ocorrências (CID)</h2>
      <div class="desc">Ocorrências/BIM de todos os servidores, com CID — base para o controle epidemiológico e o PPP.</div>
    </div></div>
    <div class="toolbar"><input type="search" id="oc-busca" placeholder="Filtrar por CID (ex.: M54)"></div>
    <div class="card"><div class="card-h">Resumo por CID</div><div class="card-b" id="oc-resumo">…</div></div>
    <div class="card"><div id="oc-lista"><div class="empty">Carregando…</div></div></div>
  `);
  await desenhar('');
  let deb; document.getElementById('oc-busca').oninput = (e) => { clearTimeout(deb); deb = setTimeout(() => desenhar(e.target.value.trim()), 300); };
}

// ============================================================
// Junta Médica — avaliação colegiada + laudo RAI
// ============================================================
const TIPOS_JUNTA = ['Aposentadoria por incapacidade', 'Revisão de benefício', 'Readaptação', 'Divergência de laudos', 'Invalidez'];

async function renderJuntas() {
  shell('<div class="empty">Carregando…</div>');
  const lista = await api.get('/api/juntas');
  setMain(`
    <div class="page-head"><div>
      <h2>⚖️ Junta Médica</h2>
      <div class="desc">Avaliações colegiadas (aposentadoria por incapacidade, revisão, divergência) e o laudo RAI.</div>
    </div>
    <button class="btn" id="j-nova">＋ Formar junta</button></div>
    <div class="card"><div id="j-lista">${lista.length ? `<table>
      <thead><tr><th>Servidor</th><th>Tipo</th><th>Reunião</th><th>Conclusão</th><th>Status</th><th></th></tr></thead>
      <tbody>${lista.map((j) => `<tr data-id="${j.id}" style="cursor:pointer">
        <td><b>${esc(j.servidor_nome || '—')}</b></td><td>${esc(j.tipo || '—')}</td>
        <td class="muted">${dataBR(j.data_reuniao)}</td><td>${esc(j.conclusao || '—')}</td>
        <td><span class="canal ${j.status === 'concluida' ? 'wa' : 'fis'}">${j.status === 'concluida' ? 'Concluída' : 'Aberta'}</span></td>
        <td><a class="btn secondary sm" href="/api/juntas/${j.id}/laudo" target="_blank" rel="noopener" onclick="event.stopPropagation()">📄 RAI</a></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhuma junta. Clique em "Formar junta" ou use "Formar Junta" na ficha do servidor.</div>'}</div></div>
  `);
  document.querySelectorAll('#j-lista tr[data-id]').forEach((tr) => tr.onclick = () => (location.hash = `#junta/${tr.dataset.id}`));
  document.getElementById('j-nova').onclick = async () => {
    const servs = await api.get('/api/servidores');
    if (!servs.length) return toast('Cadastre um servidor primeiro.', true);
    const r = await modal({ titulo: 'Formar junta médica', okLabel: 'Criar', corpo: `
      <div class="field"><label>Servidor</label><select name="servidor_id">${servs.map((s) => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo</label><select name="tipo">${TIPOS_JUNTA.map((t) => `<option>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Data da reunião</label><input name="data_reuniao" type="date"></div>` });
    if (!r || !r.servidor_id) return;
    try { const c = await api.post('/api/juntas', r); toast('Junta criada'); location.hash = `#junta/${c.id}`; }
    catch (e) { toast(e.message, true); }
  };
}

async function renderJuntaDetalhe(id) {
  shell('<div class="empty">Carregando…</div>');
  let j;
  try { j = await api.get('/api/juntas/' + id); } catch (e) { setMain(`<div class="card"><div class="empty">${esc(e.message)}</div></div>`); return; }
  const s = j.servidor || {};
  const peritosCad = await api.get('/api/juntas/peritos').catch(() => []);
  const af = j.dossie.afastamentos;
  const totalDias = af.reduce((t, a) => t + (a.dias || 0), 0);

  const dossieAfast = af.length ? `<table><thead><tr><th>Início</th><th>Fim</th><th>Dias</th><th>CID</th><th>Tipo</th><th>Decisão</th></tr></thead>
    <tbody>${af.map((a) => `<tr><td>${dataBR(a.data_inicio)}</td><td>${dataBR(a.data_fim)}</td><td>${a.dias ?? '—'}</td><td><b>${esc(a.cid || '—')}</b></td><td>${esc(a.tipo || '—')}</td><td>${esc(a.conclusao || '—')}</td></tr>`).join('')}</tbody></table>`
    : '<span class="muted">Sem afastamentos registrados.</span>';
  const dossieProc = j.dossie.processos.length ? j.dossie.processos.map((p) => `<div style="padding:5px 0;border-bottom:1px solid var(--border)"><span class="num-proc">${esc(p.numero_sei)}</span> <span class="muted">${esc(p.especificacao || p.tipo || '')}</span></div>`).join('') : '<span class="muted">—</span>';

  // Composição: até 3+ peritos, escolhidos dos cadastrados ou digitados.
  const linhaPerito = (p = {}, i) => `<div class="row" style="gap:8px">
    <input data-pnome="${i}" placeholder="Nome do perito" value="${esc(p.nome || '')}" list="peritos-dl" style="flex:2">
    <input data-pcrm="${i}" placeholder="CRM" value="${esc(p.crm || '')}" style="flex:1">
  </div>`;
  const peritos = j.peritos.length ? j.peritos : [{}, {}, {}];

  setMain(`
    <div class="page-head"><div>
      <a href="#juntas" class="muted">← juntas</a>
      <h2 style="margin-top:4px">⚖️ ${esc(s.nome || 'Junta')}</h2>
      <div class="desc">${esc(j.tipo || '')} • ${af.length} afastamento(s) • ${totalDias} dia(s) • ${j.status === 'concluida' ? 'Concluída' : 'Aberta'}</div>
    </div>
    <div style="display:flex;gap:8px">
      <a class="btn" href="/api/juntas/${id}/laudo" target="_blank" rel="noopener">📄 Laudo RAI</a>
      <button class="btn secondary" id="j-salvar">Salvar</button>
    </div></div>
    <datalist id="peritos-dl">${peritosCad.map((p) => `<option value="${esc(p.nome)}">CRM ${esc(p.crm || '')}</option>`).join('')}</datalist>
    <div class="detail-grid">
      <div>
        <div class="card"><div class="card-h">Laudo da incapacidade (RAI)</div><div class="card-b">
          <div class="row"><div class="field"><label>Tipo</label><select data-jc="tipo">${TIPOS_JUNTA.map((t) => `<option ${j.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="field"><label>Data da reunião</label><input data-jc="data_reuniao" type="date" value="${esc(j.data_reuniao || '')}"></div></div>
          <div class="row"><div class="field"><label>Prontuário atual</label><input data-jc="prontuario_atual" value="${esc(j.prontuario_atual || s.prontuario || '')}"></div>
            <div class="field"><label>Prontuário anterior</label><input data-jc="prontuario_anterior" value="${esc(j.prontuario_anterior || '')}"></div></div>
          <div class="row"><div class="field"><label>Médico assistente</label><input data-jc="medico_assistente" value="${esc(j.medico_assistente || '')}"></div>
            <div class="field"><label>CRM assistente</label><input data-jc="crm_assistente" value="${esc(j.crm_assistente || '')}"></div></div>
          <div class="field"><label>CID(s)</label><input data-jc="cids" value="${esc(j.cids || '')}" placeholder="ex.: F41.1, F32.2"></div>
          <div class="field"><label>Relatório médico da incapacidade</label>
            <textarea data-jc="relatorio" style="min-height:200px" placeholder="REUNIDA A JMP NA DATA DE…, ANALISAMOS TODO O PRONTUÁRIO…">${esc(j.relatorio || '')}</textarea></div>
          <div class="row"><div class="field"><label>Conclusão</label><input data-jc="conclusao" list="jconc" value="${esc(j.conclusao || '')}" placeholder="Concede aposentadoria por incapacidade / Nega / Diligência">
            <datalist id="jconc"><option value="Concede aposentadoria por incapacidade"><option value="Nega o pedido"><option value="Diligência"><option value="Readaptação"></datalist></div></div>
        </div></div>
      </div>
      <div>
        <div class="card"><div class="card-h">Composição da Junta <button class="btn sm" id="j-add-perito">＋ perito</button></div>
          <div class="card-b" id="j-peritos">${peritos.map(linhaPerito).join('')}</div></div>
        <div class="card"><div class="card-h">Dossiê — afastamentos</div><div class="card-b">${dossieAfast}</div></div>
        <div class="card"><div class="card-h">Dossiê — processos</div><div class="card-b">${dossieProc}</div></div>
        <div class="card"><div class="card-b" style="display:flex;gap:8px;align-items:center">
          <button class="btn ${j.status === 'concluida' ? 'secondary' : ''}" id="j-status">${j.status === 'concluida' ? '↩️ Reabrir junta' : '✔ Concluir junta'}</button>
          <button class="btn danger sm" id="j-del">🗑 Excluir</button>
        </div></div>
      </div>
    </div>
  `);

  const coletar = () => {
    const c = {};
    document.querySelectorAll('[data-jc]').forEach((el) => c[el.dataset.jc] = el.value);
    const per = [];
    document.querySelectorAll('#j-peritos .row').forEach((row, i) => {
      const nome = row.querySelector(`[data-pnome="${i}"]`)?.value.trim();
      const crm = row.querySelector(`[data-pcrm="${i}"]`)?.value.trim();
      if (nome) per.push({ nome, crm });
    });
    c.peritos = per;
    return c;
  };
  const salvar = async (extra = {}) => {
    try { await api.put('/api/juntas/' + id, { ...coletar(), ...extra }); toast('Junta salva'); }
    catch (e) { toast(e.message, true); }
  };
  document.getElementById('j-salvar').onclick = () => salvar();
  document.getElementById('j-add-perito').onclick = () => {
    const box = document.getElementById('j-peritos');
    const i = box.querySelectorAll('.row').length;
    box.insertAdjacentHTML('beforeend', linhaPerito({}, i));
  };
  document.getElementById('j-status').onclick = async () => {
    await salvar({ status: j.status === 'concluida' ? 'aberta' : 'concluida' });
    renderJuntaDetalhe(id);
  };
  document.getElementById('j-del').onclick = async () => {
    if (!confirm('Excluir esta junta?')) return;
    try { await api.del('/api/juntas/' + id); toast('Junta excluída'); location.hash = '#juntas'; }
    catch (e) { toast(e.message, true); }
  };
}

async function renderServidores() {
  shell('<div class="empty">Carregando…</div>');
  const lista = await api.get('/api/servidores');
  setMain(`
    <div class="page-head">
      <div><h2>Servidores <span class="badge pr-normal" style="font-size:14px">${lista.length}</span></h2>
      <div class="desc">Pessoas periciadas — ficha funcional, ocorrências/BIM (CID), prontuário e base para PPP.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn secondary" href="#ocorrencias">🩺 Ocorrências (CID)</a>
        <button class="btn" id="btn-novo-serv">＋ Novo servidor</button>
      </div>
    </div>
    <div class="toolbar"><input type="search" id="busca-serv" placeholder="Buscar nome, CPF, matrícula…"></div>
    <div class="card"><div id="lista-serv"></div></div>
  `);
  const flagFicha = (s) => {
    if (s.n_sem_ficha > 0) return ' <span class="badge pr-alta" style="font-size:11px" title="A ficha funcional não foi encontrada no processo">⚠️ sem ficha</span>';
    if (!s.ficha_atualizada_em) return ' <span class="badge pr-normal" style="font-size:11px" title="Ficha ainda não lida — use Buscar conteúdo de todos">ficha pendente</span>';
    return '';
  };
  const desenha = (arr) => {
    document.getElementById('lista-serv').innerHTML = arr.length ? `<table>
      <thead><tr><th>Nome</th><th>Matrícula</th><th>Cargo</th><th>Processos</th><th>Afastamentos</th></tr></thead>
      <tbody>${arr.map((s) => `<tr data-id="${s.id}" style="cursor:pointer">
        <td><b>${esc(s.nome)}</b>${flagFicha(s)}<br><span class="muted">${esc(s.cpf || '')}</span></td>
        <td>${esc(s.matricula || '—')}</td><td>${esc(s.cargo || '—')}</td>
        <td>${s.n_processos}</td><td>${s.n_afastamentos}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhum servidor. Eles são criados automaticamente ao buscar o conteúdo dos processos, ou cadastre manualmente.</div>';
    document.querySelectorAll('#lista-serv tr[data-id]').forEach((tr) => { tr.onclick = () => (location.hash = `#servidor/${tr.dataset.id}`); });
  };
  desenha(lista);
  let deb; document.getElementById('busca-serv').oninput = (e) => {
    clearTimeout(deb); deb = setTimeout(async () => desenha(await api.get('/api/servidores?q=' + encodeURIComponent(e.target.value))), 300);
  };
  document.getElementById('btn-novo-serv').onclick = async () => {
    const r = await modal({ titulo: 'Novo servidor', okLabel: 'Criar',
      corpo: `<div class="field"><label>Nome</label><input name="nome"></div>
        <div class="row"><div class="field"><label>CPF</label><input name="cpf"></div>
        <div class="field"><label>Matrícula</label><input name="matricula"></div></div>` });
    if (!r || !r.nome) return;
    try { const c = await api.post('/api/servidores', r); toast('Servidor criado'); location.hash = `#servidor/${c.id}`; }
    catch (e) { toast(e.message, true); }
  };
}

async function renderServidorDetalhe(id) {
  shell('<div class="empty">Carregando…</div>');
  let s;
  try { s = await api.get('/api/servidores/' + id); }
  catch (e) { setMain(`<div class="card"><div class="empty">${esc(e.message)}</div></div>`); return; }

  const campoHtml = (k, lbl) => `<div class="field" style="margin-bottom:10px"><label>${lbl}</label>${
    CAMPOS_TEXTAREA.has(k)
      ? `<textarea data-campo="${k}" style="min-height:56px">${esc(s[k] || '')}</textarea>`
      : `<input data-campo="${k}" value="${esc(s[k] || '')}">`}</div>`;
  const ficha = GRUPOS_SERV.map(([titulo, campos]) =>
    `<div class="ficha-grupo"><div class="muted" style="font-weight:600;margin:14px 0 6px;border-bottom:1px solid var(--border);padding-bottom:4px">${titulo}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">${campos.map(([k, lbl]) => campoHtml(k, lbl)).join('')}</div></div>`
  ).join('');

  // Seção Segurança do Trabalho / PPP (campos livres + gerados por IA)
  const segTrab = ['atividades', 'agentes_nocivos', 'ppp_atividades', 'ltcat', 'pcmso', 'observacoes'].map((k) => {
    const rot = { atividades: 'Atividades exercidas', agentes_nocivos: 'Agentes nocivos', ppp_atividades: 'PPP — atividades (IA)', ltcat: 'LTCAT — condições ambientais (IA)', pcmso: 'PCMSO — controle médico (IA)', observacoes: 'Observações (nomeação/portaria/posse)' }[k];
    return campoHtml(k, rot);
  }).join('');
  const iaAviso = s.ia_atualizado_em ? `<span class="muted" style="font-size:12px">gerado por IA em ${esc(s.ia_atualizado_em)}</span>` : '';
  const fichaAviso = s.ficha_atualizada_em ? `<span class="muted" style="font-size:12px">ficha atualizada em ${esc(s.ficha_atualizada_em)}</span>` : '';

  // Ocorrências / BIM: cada perícia é um boletim individualizado, ligado ao
  // seu processo, com CID, conclusão e período. Cartão por ocorrência.
  const procDe = {}; for (const p of s.processos) procDe[p.id] = p.numero_sei;
  const concCor = (c) => /defer|apto|conced/i.test(c || '') ? 'pr-normal' : /indefer|inapto|neg/i.test(c || '') ? 'pr-alta' : 'pr-normal';
  const afast = s.afastamentos.length ? s.afastamentos.map((a) => `
    <div class="card" style="margin:0 0 10px;border:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:10px 12px">
        <div>
          <div><b>${esc(a.tipo || 'Ocorrência')}</b> ${a.conclusao ? `<span class="badge ${concCor(a.conclusao)}" style="font-size:11px">${esc(a.conclusao)}</span>` : ''}</div>
          <div class="muted" style="font-size:13px;margin-top:2px">
            CID <b>${esc(a.cid || '—')}</b>${a.cid2 ? '/' + esc(a.cid2) : ''}
            ${a.data_inicio ? ` • ${dataBR(a.data_inicio)}${a.data_fim ? ' a ' + dataBR(a.data_fim) : ''}` : ''}
            ${a.dias ? ` • ${a.dias} dia(s)` : ''}
            ${a.data_pericia ? ` • perícia ${dataBR(a.data_pericia)}` : ''}
          </div>
          ${a.processo_id && procDe[a.processo_id] ? `<div style="font-size:12px;margin-top:2px"><a href="#processo/${a.processo_id}" class="num-proc">📁 ${esc(procDe[a.processo_id])}</a></div>` : ''}
          ${a.descricao ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(a.descricao)}</div>` : ''}
          ${a.perito ? `<div class="muted" style="font-size:12px">Perito: ${esc(a.perito)}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
          <a class="btn secondary sm" href="/api/servidores/${id}/bim/${a.id}" target="_blank" rel="noopener" title="Boletim de Inspeção Médica (uso interno)">🖨 BIM</a>
          <a class="btn secondary sm" href="/api/servidores/${id}/comprovante/${a.id}" target="_blank" rel="noopener" title="Comprovante ao servidor (resposta oficial)">📄 Comprovante</a>
          <button class="btn secondary sm" data-editaf="${a.id}">✏️</button><button class="btn danger sm" data-delaf="${a.id}">🗑</button></div>
      </div>
    </div>`).join('')
    : '<span class="muted">Nenhuma ocorrência/BIM registrada. Elas entram sozinhas ao ler os despachos, ou registre manualmente.</span>';

  const docs = s.documentos.length ? s.documentos.map((d) => `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1"><b>${esc(d.tipo)}</b> <span class="muted">${esc(d.nome_orig || '')}</span></span>
      <a class="btn secondary sm" href="/api/servidores/${id}/documentos/${d.id}" target="_blank">baixar</a>
      <button class="btn danger sm" data-deldoc="${d.id}">🗑</button></div>`).join('')
    : '<span class="muted">Nenhum documento no prontuário.</span>';

  const linhaProc = (p) => `<tr data-proc="${p.id}" style="cursor:pointer">
      <td class="num-proc">${esc(p.numero_sei)} ${p.fisico ? '<span class="badge pr-alta" style="font-size:11px">físico</span>' : ''}</td>
      <td>${esc(p.especificacao || p.tipo || '—')}<br><span class="muted">${dataBR(p.data_encaminhado || p.data_autuacao || p.data_entrada)}</span></td>
      <td>${badge(p.status)}</td>
      <td>${p.pdf_processo ? `<a class="btn secondary sm" href="/api/processos/${p.id}/pdf" target="_blank" rel="noopener" onclick="event.stopPropagation()">📄 PDF</a>` : ''}</td></tr>`;
  const ativos = s.processos.filter((p) => !p.arquivado);
  const arquivados = s.processos.filter((p) => p.arquivado);
  const procs = ativos.length ? `<table><thead><tr><th>Processo</th><th>Assunto / data</th><th>Status</th><th></th></tr></thead>
    <tbody>${ativos.map(linhaProc).join('')}</tbody></table>`
    : '<span class="muted">Nenhum processo ativo.</span>';
  // "Arquivo do servidor": processos arquivados, guardados para consulta.
  const arquivo = arquivados.length ? `<table><thead><tr><th>Processo</th><th>Assunto / data</th><th>Status</th><th></th></tr></thead>
    <tbody>${arquivados.map(linhaProc).join('')}</tbody></table>`
    : '<span class="muted">Nenhum processo arquivado.</span>';

  // ---- Resumo (dados que já existem, sem abrir a ficha inteira) ----
  const idade = (() => {
    if (!s.data_nascimento) return '';
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s.data_nascimento) || /(\d{2})\/(\d{2})\/(\d{4})/.exec(s.data_nascimento);
    if (!m) return '';
    const ano = m[1].length === 4 ? +m[1] : +m[3];
    const y = 2026 - ano; return y > 0 && y < 120 ? ` (${y} anos)` : '';
  })();
  const item = (lbl, val) => val ? `<div class="resumo-item"><span class="muted">${lbl}</span><b>${esc(val)}</b></div>` : '';
  const resumo = `<div class="resumo-grid">
    ${item('Matrícula', s.matricula)}
    ${item('CPF', s.cpf)}
    ${item('Nascimento', s.data_nascimento ? dataBR(s.data_nascimento) + idade : '')}
    ${item('Sexo', s.sexo)}
    ${item('Cargo', s.cargo)}
    ${item('CBO', s.cbo)}
    ${item('Secretaria', s.secretaria)}
    ${item('Lotação', s.lotacao)}
    ${item('Vínculo / situação', s.situacao || s.vinculo)}
    ${item('WhatsApp', s.whatsapp)}
    <div class="resumo-item"><span class="muted">Processos</span><b>${s.processos.length}</b></div>
    <div class="resumo-item"><span class="muted">Dias afastado</span><b>${s.total_dias_afastado}</b></div>
  </div>
  ${s.prontuario ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)"><div class="muted" style="font-weight:600;margin-bottom:4px">Prontuário / resumo clínico</div><div style="white-space:pre-wrap">${esc(s.prontuario)}</div></div>` : ''}`;

  // ---- Licenças (histórico cronológico de afastamentos com período) ----
  const lics = s.afastamentos.filter((a) => a.data_inicio)
    .sort((a, b) => String(b.data_inicio).localeCompare(String(a.data_inicio)));
  const licencas = lics.length ? `<table><thead><tr><th>Período</th><th>Dias</th><th>CID</th><th>Natureza / conclusão</th></tr></thead>
    <tbody>${lics.map((a) => `<tr>
      <td>${dataBR(a.data_inicio)}${a.data_fim ? ' a ' + dataBR(a.data_fim) : ''}</td>
      <td>${a.dias || '—'}</td>
      <td class="num-proc">${esc(a.cid || '—')}${a.cid2 ? '/' + esc(a.cid2) : ''}</td>
      <td>${esc(a.natureza || a.tipo || '—')}${a.conclusao ? ' • ' + esc(a.conclusao) : ''}</td></tr>`).join('')}</tbody></table>
    <div class="muted" style="font-size:12px;margin-top:6px">Total: ${s.total_dias_afastado} dia(s) em ${lics.length} período(s).</div>`
    : '<span class="muted">Nenhuma licença/afastamento com período registrado.</span>';

  // ---- Comentários (anotações livres da equipe, tipo cesar.ia) ----
  const comentarios = (s.comentarios && s.comentarios.length)
    ? s.comentarios.map((c) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="white-space:pre-wrap">${esc(c.texto)}</div>
        <div class="muted" style="font-size:12px;margin-top:3px;display:flex;justify-content:space-between;align-items:center">
          <span>${esc(c.autor || '')} • ${dataBR(c.criado_em)}</span>
          <button class="btn danger sm" data-delcom="${c.id}">🗑</button></div></div>`).join('')
    : '<span class="muted">Sem comentários.</span>';

  setMain(`
    <div class="page-head"><div>
      <a href="#servidores" class="muted">← servidores</a>
      <h2 style="margin-top:4px">${esc(s.nome)}</h2>
      <div class="desc">${esc(s.cargo || '')} ${s.matricula ? '• Matrícula ' + esc(s.matricula) : ''} • ${s.processos.length} processo(s) • ${s.total_dias_afastado} dia(s) afastado</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn secondary" id="s-formar-junta">⚖️ Formar Junta</button>
      <a class="btn" href="/api/servidores/${id}/ppp" target="_blank" rel="noopener">🖨 Ficha / PPP</a>
    </div></div>

    <!-- Resumo: só o que já existe, sem poluir a tela -->
    <div class="card"><div class="card-h">📋 Resumo do servidor
      <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${fichaAviso}
        <button class="btn secondary sm" id="s-ia-sei" title="Abre o processo no SEI, tira print da ficha e preenche sozinho">🤖 Buscar ficha no SEI</button>
      </span></div>
      <div class="card-b">${resumo}</div></div>

    <!-- Ficha completa fica recolhida (edição sob demanda) -->
    <details class="card">
      <summary style="cursor:pointer;padding:14px 16px;font-weight:600;display:flex;justify-content:space-between;align-items:center">
        <span>✏️ Editar ficha funcional completa (Segurança do Trabalho / PPP)</span></summary>
      <div class="card-b" style="border-top:1px solid var(--border)">
        <div style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          <button class="btn secondary sm" id="s-ia-ficha">🤖 Preencher (colar/foto)</button>
          <button class="btn sm" id="s-salvar">Salvar ficha</button></div>
        ${ficha}
        <div class="muted" style="font-weight:600;margin:18px 0 6px;border-bottom:1px solid var(--border);padding-bottom:4px;display:flex;justify-content:space-between;align-items:center">
          <span>Segurança do Trabalho / PPP</span>
          <span style="display:flex;gap:6px;align-items:center">${iaAviso}
            <button class="btn secondary sm" id="s-ia-cbo">🤖 Gerar por CBO</button>
            <button class="btn sm" id="s-salvar-2">Salvar</button></span></div>
        ${segTrab}
      </div>
    </details>

    <div class="detail-grid">
      <div>
        <div class="card"><div class="card-h">🩺 Ocorrências / BIM (CID) <button class="btn sm" id="s-add-af">＋ Nova ocorrência</button></div>
          <div class="card-b">${afast}</div></div>
        <div class="card"><div class="card-h">Processos na perícia</div><div class="card-b" style="overflow-x:auto">${procs}</div></div>
        <div class="card"><div class="card-h">📅 Licenças / afastamentos</div><div class="card-b" style="overflow-x:auto">${licencas}</div></div>
        <div class="card"><div class="card-h">🗄️ Arquivo do servidor <span class="muted" style="font-weight:400;font-size:12px">${arquivados.length} arquivado(s)</span></div><div class="card-b" style="overflow-x:auto">${arquivo}</div></div>
      </div>
      <div>
        <div class="card"><div class="card-h">💬 Comentários da equipe</div><div class="card-b">
          <div id="s-coms">${comentarios}</div>
          <div class="field" style="margin:10px 0 0"><textarea id="s-com-texto" style="min-height:56px" placeholder="Anotação da equipe sobre este servidor…"></textarea></div>
          <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn sm" id="s-com-add">Adicionar comentário</button></div>
        </div></div>
        <div class="card"><div class="card-h">Prontuário médico</div><div class="card-b">
          <div id="s-docs">${docs}</div>
          <div class="row" style="margin-top:10px;align-items:flex-end">
            <div class="field" style="margin:0"><label>Tipo</label><input id="s-doc-tipo" placeholder="ex.: Laudo, Atestado"></div>
            <div class="field" style="margin:0"><label>Arquivo</label><input id="s-doc-arq" type="file"></div>
            <button class="btn sm" id="s-doc-up">Anexar</button>
          </div>
        </div></div>
      </div>
    </div>
  `);

  document.querySelectorAll('#main-content tr[data-proc]').forEach((tr) => { tr.onclick = () => (location.hash = `#processo/${tr.dataset.proc}`); });
  const salvarFicha = async () => {
    const corpo = {};
    document.querySelectorAll('[data-campo]').forEach((el) => (corpo[el.dataset.campo] = el.value));
    try { await api.put('/api/servidores/' + id, corpo); toast('Ficha salva'); }
    catch (e) { toast(e.message, true); }
  };
  document.getElementById('s-salvar').onclick = salvarFicha;
  document.getElementById('s-salvar-2').onclick = salvarFicha;

  // ⚖️ Formar Junta a partir deste servidor.
  document.getElementById('s-formar-junta').onclick = async () => {
    const r = await modal({ titulo: 'Formar junta médica', okLabel: 'Criar', corpo: `
      <p class="muted">Cria uma junta para <b>${esc(s.nome)}</b>, já com o dossiê (afastamentos e processos).</p>
      <div class="field"><label>Tipo</label><select name="tipo">${TIPOS_JUNTA.map((t) => `<option>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Data da reunião</label><input name="data_reuniao" type="date"></div>` });
    if (!r) return;
    try { const c = await api.post('/api/juntas', { servidor_id: id, ...r }); toast('Junta criada'); location.hash = `#junta/${c.id}`; }
    catch (e) { toast(e.message, true); }
  };

  // 🤖 Buscar ficha no SEI: abre o processo, tira print da ficha e OCR — sozinho.
  document.getElementById('s-ia-sei').onclick = async () => {
    const btn = document.getElementById('s-ia-sei');
    if (!confirm('Abrir o processo deste servidor no SEI, capturar a ficha funcional e preencher automaticamente?\n\nPode levar alguns segundos.')) return;
    btn.disabled = true; const orig = btn.textContent; btn.textContent = '⏳ Buscando no SEI…';
    try {
      const r = await api.post(`/api/servidores/${id}/buscar-ficha-sei`, {});
      const af = r.afastamentos ? `, ${r.afastamentos} afastamento(s)` : '';
      const semF = r.temFicha === false ? ' ⚠️ (ficha funcional não encontrada no processo)' : '';
      toast(`Ficha lida do SEI: ${r.preenchidos} campo(s)${af}.${semF}`, r.temFicha === false);
      renderServidorDetalhe(id);
    } catch (e) {
      const msg = /não configurada/i.test(e.message) ? 'Configure a chave da IA em "🤖 Configuração da IA" (admin).' : e.message;
      toast(msg, true);
      btn.disabled = false; btn.textContent = orig;
    }
  };

  // 🤖 Preencher com IA: OCR de foto/PDF OU texto colado -> preenche a ficha.
  document.getElementById('s-ia-ficha').onclick = async () => {
    let arquivos = [];
    let leitura = Promise.resolve();
    const p = modal({
      titulo: '🤖 Preencher ficha com IA (OCR)',
      okLabel: 'Extrair',
      corpo: `<p class="muted">Anexe uma <b>foto, print ou PDF</b> da ficha funcional (a IA lê por OCR)
        <b>ou</b> cole o texto. Depois <b>confira e salve</b>.</p>
        <div class="field"><label>📷 Foto / PDF da ficha (pode selecionar várias páginas)</label>
        <input type="file" id="ia-ficha-arq" accept="image/*,application/pdf" multiple></div>
        <div class="field"><label>ou cole o texto</label>
        <textarea name="texto" style="min-height:150px" placeholder="Cole aqui os DADOS CADASTRAIS DO FUNCIONÁRIO…"></textarea></div>`,
    });
    const inp = document.getElementById('ia-ficha-arq');
    if (inp) inp.onchange = () => {
      leitura = Promise.all([...inp.files].slice(0, 8).map((f) =>
        new Promise((res) => { const rd = new FileReader(); rd.onload = () => res({ base64: rd.result, mime: f.type || 'image/png' }); rd.readAsDataURL(f); })
      )).then((a) => { arquivos = a; });
    };
    const r = await p;
    if (!r) return;
    await leitura;
    const temTexto = r.texto && r.texto.trim().length >= 20;
    if (!arquivos.length && !temTexto) return toast('Anexe uma imagem/PDF ou cole o texto da ficha.', true);
    toast(arquivos.length ? 'Lendo a imagem/PDF com IA (OCR)… aguarde' : 'Lendo a ficha com IA…');
    try {
      const { campos } = await api.post('/api/ia/extrair-ficha', arquivos.length ? { arquivos } : { texto: r.texto });
      let n = 0;
      for (const [k, v] of Object.entries(campos || {})) {
        const el = document.querySelector(`[data-campo="${k}"]`);
        if (el && v) { el.value = v; n++; }
      }
      if (!n) return toast('A IA não encontrou campos reconhecíveis.', true);
      // Compõe as observações (nomeação/portaria/lotação/posse) se estiver vazio.
      const obsEl = document.querySelector('[data-campo="observacoes"]');
      if (obsEl && !obsEl.value.trim()) {
        const g = (k) => campos[k] || document.querySelector(`[data-campo="${k}"]`)?.value || '';
        const partes = [];
        if (g('num_portaria')) partes.push(`Nomeado(a) pela Portaria nº ${g('num_portaria')}${g('data_publicacao') ? ' (publicada em ' + g('data_publicacao') + ')' : ''}`);
        if (g('secretaria') || g('lotacao')) partes.push(`Lotação: ${[g('secretaria'), g('lotacao')].filter(Boolean).join(' — ')}`);
        if (g('data_posse')) partes.push(`Posse em ${g('data_posse')}`);
        if (g('data_exercicio')) partes.push(`Exercício desde ${g('data_exercicio')}`);
        if (partes.length) obsEl.value = partes.join('. ') + '.';
      }
      await salvarFicha();
      toast(`${n} campo(s) preenchidos e salvos. Confira os dados.`);
    } catch (e) {
      const msg = /não configurada/i.test(e.message) ? 'Configure a chave da IA em Configuração da IA (admin).' : e.message;
      toast(msg, true);
    }
  };

  // 🤖 Gerar por CBO: preenche PPP/LTCAT/PCMSO a partir do CBO/cargo.
  document.getElementById('s-ia-cbo').onclick = async () => {
    const cboAtual = document.querySelector('[data-campo="cbo"]')?.value || s.cbo || '';
    const cargoAtual = document.querySelector('[data-campo="cargo"]')?.value || s.cargo || '';
    if (!cboAtual && !cargoAtual) return toast('Preencha o CBO ou o cargo primeiro.', true);
    if (!confirm(`Gerar PPP / LTCAT / PCMSO com IA para o CBO "${cboAtual || '(sem CBO)'}" / cargo "${cargoAtual}"?`)) return;
    toast('Gerando com IA… (pode levar alguns segundos)');
    try {
      const r = await api.post(`/api/ia/servidor/${id}/cbo`, { cbo: cboAtual });
      const set = (k, v) => { const el = document.querySelector(`[data-campo="${k}"]`); if (el && v) el.value = v; };
      set('ppp_atividades', r.ppp_atividades); set('ltcat', r.ltcat); set('pcmso', r.pcmso);
      if (r.agentes_nocivos && !document.querySelector('[data-campo="agentes_nocivos"]').value) set('agentes_nocivos', r.agentes_nocivos);
      toast('PPP / LTCAT / PCMSO gerados e salvos.');
    } catch (e) {
      const msg = /não configurada/i.test(e.message) ? 'Configure a chave da IA em Configuração da IA (admin).' : e.message;
      toast(msg, true);
    }
  };
  // Formulário de ocorrência/BIM (novo ou edição), individualizado por processo.
  const formOcorrencia = (a = {}) => `
    <div class="field"><label>Processo (a qual perícia se refere)</label>
      <select name="processo_id"><option value="">— sem vínculo —</option>${
        s.processos.map((p) => `<option value="${p.id}" ${String(a.processo_id) === String(p.id) ? 'selected' : ''}>${esc(p.numero_sei)} — ${esc(p.especificacao || p.tipo || '')}</option>`).join('')
      }</select></div>
    <div class="row"><div class="field"><label>Natureza (parecer)</label>
      <select name="natureza"><option value="">—</option>
        ${['Licença inicial', 'Prorrogação', 'Alta', 'Aposentadoria por invalidez', 'Readaptação', 'Reconsideração'].map((n) => `<option ${a.natureza === n ? 'selected' : ''}>${n}</option>`).join('')}
      </select></div>
      <div class="field"><label>Conclusão / decisão</label>
      <input name="conclusao" list="conc-list" placeholder="Concedido / Negado / Em exigência" value="${esc(a.conclusao || '')}">
      <datalist id="conc-list"><option value="Concedido"><option value="Negado"><option value="Em exigência"><option value="Deferido"><option value="Indeferido"></datalist></div></div>
    <div class="row"><div class="field"><label>Beneficiário</label>
      <select name="beneficiario"><option value="">—</option><option ${a.beneficiario === 'Próprio' ? 'selected' : ''}>Próprio</option><option ${a.beneficiario === 'Familiar' ? 'selected' : ''}>Familiar</option></select></div>
      <div class="field"><label>Remuneração</label>
      <select name="remunerado"><option value="">—</option><option ${a.remunerado === 'Com' ? 'selected' : ''}>Com</option><option ${a.remunerado === 'Sem' ? 'selected' : ''}>Sem</option></select></div></div>
    <div class="row"><div class="field"><label>CID</label><input name="cid" placeholder="ex.: M54.5" value="${esc(a.cid || '')}"></div>
      <div class="field"><label>CID 2 (opcional)</label><input name="cid2" value="${esc(a.cid2 || '')}"></div></div>
    <div class="row"><div class="field"><label>Data da perícia</label><input name="data_pericia" type="date" value="${esc(a.data_pericia || '')}"></div>
      <div class="field"><label>Início do afastamento</label><input name="data_inicio" type="date" value="${esc(a.data_inicio || '')}"></div>
      <div class="field"><label>Fim</label><input name="data_fim" type="date" value="${esc(a.data_fim || '')}"></div></div>
    <div class="row"><div class="field"><label>Nº do BIM</label><input name="bim_numero" value="${esc(a.bim_numero || '')}"></div>
      <div class="field"><label>BIM anterior nº</label><input name="bim_anterior" value="${esc(a.bim_anterior || '')}"></div>
      <div class="field"><label>Licença ininterrupta anterior (dias)</label><input name="licenca_anterior_dias" type="number" value="${esc(a.licenca_anterior_dias || '')}"></div></div>
    <div class="field"><label>Perito responsável</label><input name="perito" value="${esc(a.perito || '')}"></div>
    <div class="field"><label>Relatório / observações ao servidor</label><textarea name="descricao" style="min-height:60px">${esc(a.descricao || '')}</textarea></div>`;
  document.getElementById('s-add-af').onclick = async () => {
    const r = await modal({ titulo: '＋ Nova ocorrência / BIM', okLabel: 'Salvar', corpo: formOcorrencia() });
    if (!r) return;
    try { await api.post(`/api/servidores/${id}/afastamentos`, r); toast('Ocorrência registrada'); renderServidorDetalhe(id); }
    catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('[data-editaf]').forEach((b) => { b.onclick = async () => {
    const a = s.afastamentos.find((x) => String(x.id) === b.dataset.editaf) || {};
    const r = await modal({ titulo: 'Editar ocorrência / BIM', okLabel: 'Salvar', corpo: formOcorrencia(a) });
    if (!r) return;
    try { await api.put(`/api/servidores/${id}/afastamentos/${b.dataset.editaf}`, r); toast('Ocorrência atualizada'); renderServidorDetalhe(id); }
    catch (e) { toast(e.message, true); }
  }; });
  document.querySelectorAll('[data-delaf]').forEach((b) => { b.onclick = async () => { await api.del(`/api/servidores/${id}/afastamentos/${b.dataset.delaf}`); renderServidorDetalhe(id); }; });
  document.querySelectorAll('[data-deldoc]').forEach((b) => { b.onclick = async () => { await api.del(`/api/servidores/${id}/documentos/${b.dataset.deldoc}`); renderServidorDetalhe(id); }; });
  document.getElementById('s-doc-up').onclick = async () => {
    const tipo = document.getElementById('s-doc-tipo').value.trim();
    const arq = document.getElementById('s-doc-arq').files[0];
    if (!tipo) return toast('Informe o tipo', true);
    if (!arq) return toast('Escolha um arquivo', true);
    const dados_base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(arq); });
    try { await api.post(`/api/servidores/${id}/documentos`, { tipo, nome_orig: arq.name, dados_base64 }); toast('Documento anexado'); renderServidorDetalhe(id); }
    catch (e) { toast(e.message, true); }
  };

  // 💬 Comentários da equipe (anotações livres).
  document.getElementById('s-com-add').onclick = async () => {
    const texto = document.getElementById('s-com-texto').value.trim();
    if (!texto) return toast('Escreva um comentário.', true);
    try { await api.post(`/api/servidores/${id}/comentarios`, { texto }); toast('Comentário adicionado'); renderServidorDetalhe(id); }
    catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('[data-delcom]').forEach((b) => { b.onclick = async () => {
    if (!confirm('Excluir este comentário?')) return;
    try { await api.del(`/api/servidores/${id}/comentarios/${b.dataset.delcom}`); renderServidorDetalhe(id); }
    catch (e) { toast(e.message, true); }
  }; });
}

// ============================================================
// Mensageiro (remessas de processos físicos)
// ============================================================
async function renderMensageiro() {
  shell('<div class="empty">Carregando…</div>');
  const [prontos, remessas] = await Promise.all([
    api.get('/api/remessas/prontos'),
    api.get('/api/remessas'),
  ]);

  // Agrupa prontos por secretaria.
  const porSec = {};
  for (const p of prontos) (porSec[p.secretaria_destino || 'Sem secretaria'] ||= []).push(p);

  const blocosProntos = Object.keys(porSec).length
    ? Object.entries(porSec).map(([sec, lista]) => `
        <div class="card">
          <div class="card-h">${esc(sec)} — ${lista.length} pronto(s)
            <button class="btn sm" data-remessa="${esc(sec)}">🚚 Criar remessa</button></div>
          <div class="card-b">
            ${lista.map((p) => `<label style="display:block;padding:4px 0">
              <input type="checkbox" class="chk-${cssId(sec)}" value="${p.id}" checked>
              <b class="num-proc">${esc(p.numero_sei)}</b> — ${esc(p.interessado || '—')} <span class="muted">${esc(p.especificacao || '')}</span>
            </label>`).join('')}
          </div>
        </div>`).join('')
    : '<div class="card"><div class="empty">Nenhum processo físico conferido aguardando envio.</div></div>';

  const listaRemessas = remessas.length
    ? `<table><thead><tr><th>#</th><th>Secretaria</th><th>Mensageiro</th><th>Qtd</th><th>Emissão</th><th>Retirada</th><th></th></tr></thead>
        <tbody>${remessas.map((r) => `<tr>
          <td>${r.id}</td><td>${esc(r.secretaria)}</td><td>${esc(r.mensageiro || '—')}</td>
          <td>${r.total}</td><td class="muted">${dataHora(r.criado_em)}</td>
          <td>${r.retirada_em ? `<span class="badge st-conferido">${esc(r.retirada_em)}</span>` : '<span class="badge st-em_pericia">aguardando</span>'}</td>
          <td style="white-space:nowrap">
            <a class="btn secondary sm" href="/api/remessas/${r.id}/relatorio" target="_blank" rel="noopener">🖨 Relatório</a>
            ${r.retirada_em ? '' : `<button class="btn ok sm" data-retirada="${r.id}">✔ Registrar retirada</button>`}
          </td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Nenhuma remessa ainda.</div>';

  setMain(`
    <div class="page-head"><div><h2>Mensageiro</h2>
      <div class="desc">Envio de processos físicos às secretarias. Gere a remessa, imprima o relatório e registre a retirada.</div></div></div>
    <h3 style="margin:0 0 8px">Prontos para enviar</h3>
    ${blocosProntos}
    <h3 style="margin:24px 0 8px">Remessas</h3>
    <div class="card">${listaRemessas}</div>
  `);

  document.querySelectorAll('[data-remessa]').forEach((b) => {
    b.onclick = async () => {
      const sec = b.dataset.remessa;
      const ids = [...document.querySelectorAll('.chk-' + cssId(sec) + ':checked')].map((c) => Number(c.value));
      if (!ids.length) return toast('Selecione ao menos um processo', true);
      const r = await modal({ titulo: `Criar remessa — ${sec}`, okLabel: 'Criar remessa',
        corpo: `<p>${ids.length} processo(s) para <b>${esc(sec)}</b>.</p>
          <div class="field"><label>Mensageiro (opcional)</label><input name="mensageiro"></div>` });
      if (!r) return;
      try {
        await api.post('/api/remessas', { secretaria: sec, mensageiro: r.mensageiro, processo_ids: ids });
        toast('Remessa criada — imprima o relatório'); renderMensageiro();
      } catch (e) { toast(e.message, true); }
    };
  });

  document.querySelectorAll('[data-retirada]').forEach((b) => {
    b.onclick = async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const r = await modal({ titulo: 'Registrar retirada do mensageiro', okLabel: 'Confirmar retirada', okClasse: 'btn ok',
        corpo: `<p>Ao confirmar, os processos desta remessa são <b>encerrados na perícia</b> e saem do painel.</p>
          <div class="row">
            <div class="field"><label>Data da retirada</label><input name="data" type="date" value="${hoje}"></div>
            <div class="field"><label>Mensageiro</label><input name="mensageiro"></div>
          </div>` });
      if (!r) return;
      try { const x = await api.post(`/api/remessas/${b.dataset.retirada}/retirada`, r); toast(`Retirada registrada — ${x.encerrados} processo(s) encerrado(s)`); renderMensageiro(); }
      catch (e) { toast(e.message, true); }
    };
  });
}
function cssId(s) { return String(s).replace(/[^a-zA-Z0-9]/g, ''); }

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
  const isOper = ehOper();
  const isPerito = ehPerito();

  const docs = p.documentos.length
    ? p.documentos.map((d) => {
        // Abre SEMPRE o arquivo local (PDF/imagem capturado) — nunca o site do SEI.
        const alvo = d.arquivo ? `/api/processos/${p.id}/documento/${d.id}/arquivo` : '';
        const abrir = alvo
          ? `<a class="btn secondary sm" href="${esc(alvo)}" target="_blank" rel="noopener">🔎 Abrir</a>`
          : '<span class="muted" style="font-size:12px">sem arquivo — use “Buscar conteúdo no SEI”</span>';
        const titulo = alvo
          ? `<a href="${esc(alvo)}" target="_blank" rel="noopener" style="text-decoration:none"><b>${esc(d.tipo || 'Documento')}</b></a>`
          : `<b>${esc(d.tipo || 'Documento')}</b>`;
        return `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${titulo}
            <span class="muted">${esc(d.numero || '')}</span>
            ${abrir}
            ${d.conteudo ? `<button class="btn secondary sm" data-toggle="doc-${d.id}">📄 Ver texto</button>` : ''}
          </div>
          ${d.conteudo ? `<div id="doc-${d.id}" style="display:none;white-space:pre-wrap;background:var(--surface-2);padding:12px;border-radius:8px;margin-top:8px;font-size:13px;max-height:320px;overflow:auto">${esc(d.conteudo)}</div>` : ''}
        </div>`; }).join('')
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
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${p.pdf_processo ? `<a class="btn" href="/api/processos/${p.id}/pdf" target="_blank" rel="noopener">📥 Baixar processo em PDF</a>` : ''}
        <button class="btn secondary" id="btn-avisar-wa">📲 Avisar servidor (WhatsApp)</button>
        ${isOper ? `<button class="btn secondary" id="btn-arquivar">${p.arquivado ? '↩️ Desarquivar' : '🗄️ Arquivar'}</button>` : ''}
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card">
          <div class="card-h">Dados do processo ${isOper ? '<button class="btn secondary sm" id="btn-editar">Editar</button>' : ''}</div>
          <div class="card-b">
            <dl class="info-list">
              <dt>Servidor</dt><dd>${p.servidor_id ? `<a href="#servidor/${p.servidor_id}">${esc(p.interessado || '—')}</a>` : esc(p.interessado || '—')}</dd>
              <dt>Assunto</dt><dd>${esc(p.especificacao || p.tipo || '—')}</dd>
              <dt>Entrada no sistema</dt><dd>${dataBR(p.data_entrada)}</dd>
              <dt>Encaminhado à perícia</dt><dd>${dataBR(p.data_encaminhado || p.data_autuacao)}</dd>
              <dt>Origem</dt><dd>${esc(p.unidade_origem || '—')}</dd>
              <dt>Perito</dt><dd>${esc(p.perito_nome || '—')}</dd>
              <dt>Prazo</dt><dd>${esc(p.prazo || '—')}</dd>
            </dl>
          </div>
        </div>
        <div class="card">
          <div class="card-h">Documentos do SEI
            ${p.pdf_processo ? `<a class="btn sm" href="/api/processos/${p.id}/pdf" target="_blank" rel="noopener">📄 Ver processo completo (PDF)</a>` : ''}</div>
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
            <label>Meus padrões de despacho</label>
            <div class="row" style="align-items:center;gap:8px">
              <select id="d-padrao" style="flex:2"><option value="">— escolher um padrão —</option></select>
              <button class="btn secondary sm" id="d-inserir-padrao">Inserir</button>
              <button class="btn secondary sm" id="d-salvar-padrao">💾 Salvar atual</button>
            </div>
          </div>
          <div class="field">
            <label style="display:flex;justify-content:space-between;align-items:center">
              <span>Texto do despacho <span class="muted" style="font-weight:400">— processo ${esc(p.numero_sei)}</span></span>
              <button class="btn secondary sm" id="d-ia-sugerir" type="button" title="A IA redige uma minuta que você revisa e edita">🤖 Sugerir com IA</button>
            </label>
            <textarea id="d-texto" placeholder="Redija aqui o despacho… ou use “🤖 Sugerir com IA” e revise.">${esc(d?.texto || '')}</textarea>
          </div>
          <div class="field">
            <label>Ou anexe um despacho feito fora do sistema (PDF/imagem)</label>
            <div class="row" style="align-items:center">
              <input type="file" id="d-arquivo" style="flex:2">
              <button class="btn secondary" id="btn-anexar-despacho" style="flex:1">📎 Anexar</button>
            </div>
            ${d?.arquivo ? `<div style="margin-top:8px"><a class="btn secondary sm" href="/api/despachos/processo/${p.id}/arquivo" target="_blank" rel="noopener">📄 Ver despacho anexado</a></div>` : ''}
          </div>
          <hr style="border:none;border-top:1px solid var(--border);margin:8px 0 16px">
          <div class="row">
            <button class="btn secondary" id="btn-salvar-despacho">💾 Salvar rascunho</button>
            <button class="btn ok" id="btn-enviar-despacho">✔ Enviar para conferência</button>
          </div>
          ${podeSei() ? `<div style="margin-top:10px"><button class="btn" id="btn-tramitar-sei" style="width:100%">🚀 Tramitar direto ao SEI</button>
            <div class="muted" style="margin-top:4px;font-size:12px">Seu papel permite lançar direto no SEI, sem conferência do operador.</div></div>` : ''}
        </div>
      </div>`;
  }
  // Visualização do despacho (operador conferindo, ou já finalizado)
  if (d && (d.texto || d.arquivo)) {
    const comprovante = d.comprovante
      ? `<div style="margin-top:12px"><a class="btn secondary sm" href="/api/processos/${p.id}/comprovante" target="_blank" rel="noopener">🧾 Ver comprovante do lançamento no SEI</a></div>`
      : '';
    const anexo = d.arquivo
      ? `<div style="margin-top:12px"><a class="btn secondary sm" href="/api/despachos/processo/${p.id}/arquivo" target="_blank" rel="noopener">📄 Ver despacho anexado</a></div>`
      : '';
    return `
      <div class="card">
        <div class="card-h">Despacho ${d.conclusao ? `— <strong>${esc(d.conclusao)}</strong>` : ''}</div>
        <div class="card-b">
          <div style="white-space:pre-wrap">${esc(d.texto || '')}</div>
          ${d.motivo_devolucao && d.status === 'devolvido' ? `<div class="error-msg" style="min-height:auto;margin-top:10px">↩ ${esc(d.motivo_devolucao)}</div>` : ''}
          ${anexo}${comprovante}
        </div>
      </div>`;
  }
  return '';
}

function renderAcoes(p, isOper, isPerito) {
  const acoes = [];
  const temDespacho = p.despacho && (p.despacho.texto || p.despacho.arquivo);
  if (isOper) {
    if (!p.fisico) acoes.push(`<button class="btn secondary" id="a-detalhar">🔎 Buscar conteúdo no SEI</button>`);
    if (['em_controle', 'distribuido', 'devolvido'].includes(p.status)) {
      acoes.push(`<button class="btn" id="a-distribuir">👤 ${p.perito_id ? 'Redistribuir' : 'Distribuir'} a um perito</button>`);
    }
    if (p.status === 'despachado') {
      acoes.push(`<button class="btn ok" id="a-aprovar">✔ Aprovar (conferido)</button>`);
      acoes.push(`<button class="btn warn" id="a-devolver">↩ Devolver ao perito</button>`);
    }
    if (temDespacho) {
      acoes.push(`<a class="btn secondary" href="/api/processos/${p.id}/despacho-impressao" target="_blank" rel="noopener">🖨 Imprimir despacho</a>`);
    }
    if (p.status === 'conferido' && !p.fisico) {
      acoes.push(`<button class="btn" id="a-enviar-sei">📤 Enviar resposta ao SEI</button>`);
    }
    if (p.status === 'conferido' && p.fisico) {
      acoes.push(`<span class="muted">Físico conferido — pronto para o mensageiro (aba 🚚 Mensageiro).</span>`);
    }
    if (p.status === 'enviado_sei') {
      acoes.push(`<button class="btn secondary" id="a-concluir">🏁 Concluir processo</button>`);
    }
  }
  if (isPerito && temDespacho) {
    acoes.push(`<a class="btn secondary" href="/api/processos/${p.id}/despacho-impressao" target="_blank" rel="noopener">🖨 Imprimir despacho</a>`);
  }
  // Assinatura digital ICP-Brasil A1 (perito ou operador) quando há texto de despacho.
  if ((isPerito || isOper) && p.despacho?.texto && p.perito_id) {
    acoes.push(`<button class="btn" id="a-assinar">✍️ Assinar despacho (ICP-Brasil)</button>`);
  }
  if (p.pdf_assinado) {
    acoes.push(`<a class="btn ok" href="/api/processos/${p.id}/despacho-assinado" target="_blank" rel="noopener">📄 Baixar despacho assinado</a>`);
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
        <div class="field"><label>Tipo de processo</label>
          <input name="tipo" list="tipos-list" value="${esc(p.tipo || '')}" placeholder="ex.: Contestação de atestados">
          <datalist id="tipos-list">${TIPOS_PERICIA.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
        <div class="field"><label>Interessado / Servidor</label><input name="interessado" value="${esc(p.interessado || '')}"></div>
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

  // 📲 Avisar o servidor pelo WhatsApp (fila para a Natasha enviar).
  const btnWa = document.getElementById('btn-avisar-wa');
  if (btnWa) btnWa.onclick = async () => {
    const sugestao = `Perícia Médica de Nova Iguaçu: sobre o processo ${p.numero_sei} (${p.especificacao || p.tipo || 'sua solicitação'}), `;
    const r = await modal({ titulo: '📲 Avisar servidor pelo WhatsApp', okLabel: 'Enviar', corpo: `
      <p class="muted">A mensagem entra na fila e a Natasha envia ao servidor.</p>
      <div class="field"><label>WhatsApp (com DDD) — se já tivermos, deixe em branco</label><input name="telefone" placeholder="ex.: 5521999990000"></div>
      <div class="field"><label>Mensagem</label><textarea name="texto" style="min-height:110px">${esc(sugestao)}</textarea></div>` });
    if (!r || !r.texto?.trim()) return;
    try { await api.post(`/api/processos/${p.id}/avisar-whatsapp`, r); toast('Mensagem na fila — a Natasha vai enviar.'); }
    catch (e) { toast(e.message, true); }
  };

  // Arquivar / desarquivar
  const btnArq = document.getElementById('btn-arquivar');
  if (btnArq) btnArq.onclick = async () => {
    const arquivar = !p.arquivado;
    if (arquivar && !confirm('Arquivar este processo? Ele sai da lista ativa (fica em "Arquivados") e permanece no prontuário do servidor.')) return;
    try { await api.post(`/api/processos/${p.id}/arquivar`, { arquivar }); toast(arquivar ? 'Processo arquivado' : 'Processo desarquivado'); location.hash = '#processos'; }
    catch (e) { toast(e.message, true); }
  };

  // Buscar conteúdo no SEI
  const btnDetalhar = document.getElementById('a-detalhar');
  if (btnDetalhar) btnDetalhar.onclick = async () => {
    btnDetalhar.disabled = true;
    btnDetalhar.textContent = '⏳ Buscando no SEI…';
    try {
      const r = await api.post(`/api/processos/${p.id}/detalhar-sei`);
      const semMeta = r.modo === 'sei' && !r.interessado && !r.tipo && !r.especificacao;
      const box = (titulo, t) => t
        ? `<p class="muted" style="margin-top:12px"><b>${titulo}</b></p>
           <textarea readonly onclick="this.select()" style="height:150px;font-family:ui-monospace,monospace;font-size:12px">${esc(t)}</textarea>` : '';
      // Só mostra a calibração quando NÃO veio NADA (nem documentos, nem PDF,
      // nem dados). Com documentos capturados, é sucesso — sem modal alarmante.
      if (r.modo === 'sei' && semMeta && !r.pdfProcesso && !r.documentos) {
        await modal({
          titulo: 'Não achei conteúdo neste processo',
          okLabel: 'Fechar',
          corpo: `<p>O robô abriu o processo mas não encontrou documentos.</p>
            <p class="muted">Se precisar de ajuste, copie o quadro (Ctrl+A) e cole aqui:</p>
            ${box('Tela do processo:', r.amostra)}`,
        });
      } else if (r.modo === 'sei') {
        const partes = [`${r.documentos} doc(s)`];
        if (r.pdfProcesso) partes.push('PDF do processo gerado');
        if (!semMeta) partes.push('dados preenchidos');
        toast(`Conteúdo atualizado: ${partes.join(', ')}${r.fichaMsg || ''}.`, /sem ficha/.test(r.fichaMsg || ''));
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

  // Assinar despacho (ICP-Brasil)
  const btnAssinar = document.getElementById('a-assinar');
  if (btnAssinar) btnAssinar.onclick = async () => {
    btnAssinar.disabled = true;
    btnAssinar.textContent = '⏳ Assinando…';
    try {
      await api.post(`/api/processos/${p.id}/assinar-pdf`);
      toast('Despacho assinado digitalmente');
      recarrega();
    } catch (e) {
      toast(e.message, true);
      btnAssinar.disabled = false;
      btnAssinar.textContent = '✍️ Assinar despacho (ICP-Brasil)';
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

  // Perito: padrões pessoais de despacho
  const selPadrao = document.getElementById('d-padrao');
  if (selPadrao) {
    (async () => {
      const padroes = await api.get('/api/padroes').catch(() => []);
      selPadrao._padroes = padroes;
      selPadrao.insertAdjacentHTML('beforeend', padroes.map((x) => `<option value="${x.id}">${esc(x.titulo)}</option>`).join(''));
    })();
    document.getElementById('d-inserir-padrao').onclick = () => {
      const pad = (selPadrao._padroes || []).find((x) => String(x.id) === selPadrao.value);
      if (!pad) return toast('Escolha um padrão', true);
      const ta = document.getElementById('d-texto');
      ta.value = (ta.value ? ta.value + '\n' : '') + pad.texto;
    };
    document.getElementById('d-salvar-padrao').onclick = async () => {
      const texto = document.getElementById('d-texto').value.trim();
      if (!texto) return toast('Escreva o despacho antes de salvar como padrão', true);
      const r = await modal({ titulo: 'Salvar padrão pessoal', okLabel: 'Salvar',
        corpo: `<div class="field"><label>Título do padrão</label><input name="titulo" placeholder="ex.: Deferimento padrão"></div>` });
      if (!r || !r.titulo) return;
      try { await api.post('/api/padroes', { titulo: r.titulo, texto }); toast('Padrão salvo'); recarrega(); }
      catch (e) { toast(e.message, true); }
    };
  }

  // 🤖 Sugerir despacho com IA (minuta que o perito revisa).
  const btnIaSug = document.getElementById('d-ia-sugerir');
  if (btnIaSug) btnIaSug.onclick = async () => {
    const alvo = document.getElementById('d-texto');
    if (alvo.value.trim() && !confirm('Substituir o texto atual pela sugestão da IA?')) return;
    const decisao = document.getElementById('d-conclusao')?.value || '';
    btnIaSug.disabled = true; const o = btnIaSug.textContent; btnIaSug.textContent = '⏳ Redigindo…';
    try {
      const r = await api.post(`/api/ia/despacho/${p.id}`, { decisao });
      if (r.texto) alvo.value = r.texto;
      const sel = document.getElementById('d-conclusao');
      if (r.conclusao && sel && [...sel.options].some((op) => op.value === r.conclusao)) sel.value = r.conclusao;
      toast('Minuta gerada — revise e ajuste antes de enviar.');
    } catch (e) {
      const msg = /não configurada/i.test(e.message) ? 'Configure a chave da IA em "Configuração da IA".' : e.message;
      toast(msg, true);
    } finally { btnIaSug.disabled = false; btnIaSug.textContent = o; }
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
    try {
      if (d.texto.trim()) await api.post(`/api/despachos/processo/${p.id}`, d);
      else if (!p.despacho?.arquivo) return toast('Escreva ou anexe o despacho', true);
      await api.post(`/api/despachos/processo/${p.id}/enviar`);
      toast('Despacho enviado para conferência');
      recarrega();
    } catch (e) { toast(e.message, true); }
  };

  // Anexar despacho externo (PDF/imagem)
  const btnAnexar = document.getElementById('btn-anexar-despacho');
  if (btnAnexar) btnAnexar.onclick = async () => {
    const arq = document.getElementById('d-arquivo').files[0];
    if (!arq) return toast('Escolha um arquivo', true);
    const dados_base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(arq); });
    try {
      await api.post(`/api/despachos/processo/${p.id}/upload`, { nome_orig: arq.name, dados_base64, conclusao: document.getElementById('d-conclusao').value });
      toast('Despacho anexado');
      recarrega();
    } catch (e) { toast(e.message, true); }
  };

  // Tramitar direto ao SEI (perito administrador / master)
  const btnTramitar = document.getElementById('btn-tramitar-sei');
  if (btnTramitar) btnTramitar.onclick = async () => {
    const d = coletar();
    const ok = await modal({
      titulo: 'Tramitar direto ao SEI',
      okLabel: 'Tramitar agora',
      corpo: `<p>O robô vai lançar o despacho <b>direto no SEI</b> (sem passar pela conferência do operador).</p>
        <p class="muted">Confirma que o despacho está pronto?</p>`,
    });
    if (!ok) return;
    btnTramitar.disabled = true;
    btnTramitar.textContent = '⏳ Tramitando no SEI…';
    try {
      if (d.texto.trim()) await api.post(`/api/despachos/processo/${p.id}`, d);
      const r = await api.post(`/api/despachos/processo/${p.id}/tramitar-sei`);
      toast(r.modo === 'simulacao' ? 'Tramitado ao SEI (simulação)' : 'Despacho tramitado ao SEI');
      recarrega();
    } catch (e) {
      toast(e.message, true);
      btnTramitar.disabled = false;
      btnTramitar.textContent = '🚀 Tramitar direto ao SEI';
    }
  };
}

// ============================================================
// Usuários (admin)
// ============================================================
const PAPEL_OPTS = `
  <option value="perito">Perito</option>
  <option value="perito_admin">Perito Administrador (tramita direto no SEI)</option>
  <option value="operador">Operador</option>
  <option value="admin">Administrador</option>
  <option value="admin_master">Administrador Master (tramita direto no SEI)</option>`;

async function renderUsuarios() {
  shell('<div class="empty">Carregando…</div>');
  const usuarios = await api.get('/api/usuarios');
  setMain(`
    <div class="page-head">
      <div><h2>Servidores / Usuários</h2><div class="desc">Operadores, peritos e administradores.</div></div>
      <button class="btn" id="btn-novo-user">＋ Novo servidor</button>
    </div>
    <div class="card"><table>
      <thead><tr><th>Nome</th><th>CRM</th><th>Matrícula</th><th>Papel</th><th>Status</th><th></th></tr></thead>
      <tbody>${usuarios.map((u) => `
        <tr>
          <td>${esc(u.nome)}<br><span class="muted">${esc(u.email)}</span></td>
          <td>${esc(u.crm || '—')}</td>
          <td>${esc(u.matricula || '—')}</td>
          <td>${esc(PAPEL_LABEL[u.papel] || u.papel)}</td>
          <td>${u.ativo ? '<span class="badge st-conferido">ativo</span>' : '<span class="badge st-devolvido">inativo</span>'}</td>
          <td style="white-space:nowrap">
            <button class="btn secondary sm" data-ficha="${u.id}">📋 Ficha</button>
            <button class="btn secondary sm" data-ativo-id="${u.id}" data-ativo="${u.ativo}">${u.ativo ? 'Desativar' : 'Ativar'}</button>
            <button class="btn danger sm" data-del="${u.id}">🗑</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>
  `);

  document.getElementById('btn-novo-user').onclick = async () => {
    const r = await modal({
      titulo: 'Novo servidor',
      okLabel: 'Criar',
      corpo: `
        <div class="field"><label>Nome</label><input name="nome"></div>
        <div class="field"><label>E-mail (login)</label><input name="email" type="email"></div>
        <div class="row">
          <div class="field"><label>CPF</label><input name="cpf" placeholder="000.000.000-00"></div>
          <div class="field"><label>Matrícula</label><input name="matricula"></div>
        </div>
        <div class="row">
          <div class="field"><label>CRM</label><input name="crm" placeholder="somente peritos médicos"></div>
          <div class="field"><label>Senha inicial</label><input name="senha" type="text"></div>
        </div>
        <div class="field"><label>Papel</label><select name="papel">${PAPEL_OPTS}</select></div>`,
    });
    if (!r) return;
    try { await api.post('/api/usuarios', r); toast('Servidor criado'); renderUsuarios(); }
    catch (e) { toast(e.message, true); }
  };

  document.querySelectorAll('[data-ficha]').forEach((b) => { b.onclick = () => abrirFicha(b.dataset.ficha); });
  document.querySelectorAll('[data-ativo-id]').forEach((b) => {
    b.onclick = async () => {
      await api.put('/api/usuarios/' + b.dataset.ativoId, { ativo: b.dataset.ativo === '1' ? false : true });
      renderUsuarios();
    };
  });
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const ok = await modal({ titulo: 'Excluir servidor', okLabel: 'Excluir', okClasse: 'btn danger',
        corpo: '<p>Excluir este servidor e seus documentos? Esta ação não pode ser desfeita.</p>' });
      if (!ok) return;
      try { await api.del('/api/usuarios/' + b.dataset.del); toast('Servidor excluído'); renderUsuarios(); }
      catch (e) { toast(e.message, true); }
    };
  });
}

// Ficha do servidor: dados + documentos (upload/baixar/excluir).
async function abrirFicha(id) {
  const u = await api.get('/api/usuarios/' + id);
  const root = document.getElementById('modal-root');
  const docsHtml = (u.documentos || []).length
    ? u.documentos.map((d) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="flex:1"><b>${esc(d.tipo)}</b> ${d.nome_orig ? `<span class="muted">— ${esc(d.nome_orig)}</span>` : ''}</span>
          <a class="btn secondary sm" href="/api/usuarios/${id}/documentos/${d.id}" target="_blank" rel="noopener">baixar</a>
          <button class="btn danger sm" data-deldoc="${d.id}">🗑</button>
        </div>`).join('')
    : '<span class="muted">Nenhum documento anexado.</span>';

  root.innerHTML = `
    <div class="modal-back"><div class="modal">
      <h3>Ficha — ${esc(u.nome)}</h3>
      <div class="modal-b">
        <div class="row"><div class="field"><label>Papel</label><select id="f-papel">${PAPEL_OPTS}</select></div>
          <div class="field"><label>CRM</label><input id="f-crm" value="${esc(u.crm || '')}"></div></div>
        <div class="row"><div class="field"><label>CPF</label><input id="f-cpf" value="${esc(u.cpf || '')}"></div>
          <div class="field"><label>Matrícula</label><input id="f-matricula" value="${esc(u.matricula || '')}"></div></div>
        <div class="row"><div class="field"><label>Nova senha (opcional)</label><input id="f-senha" type="text" placeholder="deixe vazio p/ manter"></div></div>
        <button class="btn sm" id="f-salvar">Salvar dados</button>
        <hr style="border:none;border-top:1px solid var(--border);margin:16px 0">
        <div style="font-weight:600;margin-bottom:8px">Documentos (CRM, diploma, título, portaria de nomeação…)</div>
        <div id="f-docs">${docsHtml}</div>
        <div class="row" style="margin-top:12px;align-items:flex-end">
          <div class="field" style="margin:0"><label>Tipo do documento</label><input id="f-tipo" placeholder="ex.: Diploma, CRM, Portaria DO"></div>
          <div class="field" style="margin:0"><label>Arquivo</label><input id="f-arq" type="file"></div>
          <button class="btn sm" id="f-upload">Anexar</button>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:16px 0">
        <div style="font-weight:600;margin-bottom:8px">🔏 Certificado digital (ICP-Brasil A1) — para assinar despachos</div>
        <div class="muted" style="margin-bottom:8px">${u.tem_certificado ? '✅ Certificado cadastrado.' : 'Nenhum certificado cadastrado.'}
          ${u.tem_certificado ? '<button class="btn danger sm" id="f-cert-del" style="margin-left:8px">Remover</button>' : ''}</div>
        <div class="row" style="align-items:flex-end">
          <div class="field" style="margin:0"><label>Arquivo .pfx / .p12</label><input id="f-cert-arq" type="file" accept=".pfx,.p12"></div>
          <div class="field" style="margin:0"><label>Senha do certificado</label><input id="f-cert-senha" type="password"></div>
          <button class="btn sm" id="f-cert-up">Salvar certificado</button>
        </div>
      </div>
      <div class="modal-f"><button class="btn secondary" id="f-fechar">Fechar</button></div>
    </div></div>`;

  const papelSel = document.getElementById('f-papel');
  papelSel.value = u.papel;
  document.getElementById('f-fechar').onclick = () => (root.innerHTML = '');
  document.getElementById('f-salvar').onclick = async () => {
    const corpo = {
      papel: papelSel.value,
      crm: document.getElementById('f-crm').value,
      cpf: document.getElementById('f-cpf').value,
      matricula: document.getElementById('f-matricula').value,
    };
    const s = document.getElementById('f-senha').value;
    if (s) corpo.senha = s;
    try { await api.put('/api/usuarios/' + id, corpo); toast('Dados salvos'); }
    catch (e) { toast(e.message, true); }
  };
  document.getElementById('f-upload').onclick = async () => {
    const tipo = document.getElementById('f-tipo').value.trim();
    const arq = document.getElementById('f-arq').files[0];
    if (!tipo) return toast('Informe o tipo do documento', true);
    if (!arq) return toast('Escolha um arquivo', true);
    const dados_base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(arq); });
    try {
      await api.post(`/api/usuarios/${id}/documentos`, { tipo, nome_orig: arq.name, dados_base64 });
      toast('Documento anexado');
      abrirFicha(id);
    } catch (e) { toast(e.message, true); }
  };
  root.querySelectorAll('[data-deldoc]').forEach((b) => {
    b.onclick = async () => {
      await api.del(`/api/usuarios/${id}/documentos/${b.dataset.deldoc}`);
      abrirFicha(id);
    };
  });

  // Certificado A1
  document.getElementById('f-cert-up').onclick = async () => {
    const arq = document.getElementById('f-cert-arq').files[0];
    const senha = document.getElementById('f-cert-senha').value;
    if (!arq) return toast('Escolha o arquivo .pfx/.p12', true);
    if (!senha) return toast('Informe a senha do certificado', true);
    const dados_base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(arq); });
    try { await api.post(`/api/usuarios/${id}/certificado`, { dados_base64, senha }); toast('Certificado cadastrado'); abrirFicha(id); }
    catch (e) { toast(e.message, true); }
  };
  const certDel = document.getElementById('f-cert-del');
  if (certDel) certDel.onclick = async () => { await api.del(`/api/usuarios/${id}/certificado`); toast('Certificado removido'); abrirFicha(id); };
}

// ============================================================
// Configuração do SEI (admin)
// ============================================================
// Configuração da IA — "cofre de tokens": guarda a chave da Anthropic
// criptografada e permite testar a conexão.
async function renderConfigIa() {
  shell('<div class="empty">Carregando…</div>');
  const st = await api.get('/api/ia/status').catch(() => ({ configurado: false, modelo: '' }));
  setMain(`
    <div class="page-head"><div>
      <h2>🤖 Configuração da IA</h2>
      <div class="desc">Cofre de tokens — a chave da Anthropic fica guardada criptografada no servidor e nunca aparece de volta na tela.</div>
    </div></div>
    <div class="card"><div class="card-b">
      <p>Status: ${st.configurado
        ? '<b style="color:var(--ok,green)">✅ Chave configurada</b>'
        : '<b style="color:var(--danger,#c00)">⚠️ Sem chave</b>'} ${st.modelo ? `<span class="muted">• modelo: ${esc(st.modelo)}</span>` : ''}</p>
      <div class="field"><label>Chave da API (Anthropic)</label>
        <input id="ia-chave" type="password" placeholder="${st.configurado ? '•••••••• (deixe em branco para manter)' : 'sk-ant-...'}" autocomplete="off"></div>
      <div class="field"><label>Modelo</label>
        <input id="ia-modelo" value="${esc(st.modelo || 'claude-sonnet-4-5-20250929')}"></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn" id="ia-salvar">Salvar</button>
        <button class="btn secondary" id="ia-testar">Testar conexão</button>
      </div>
      <div id="ia-msg" class="muted" style="margin-top:10px"></div>
      <p class="muted" style="margin-top:14px;font-size:13px">A IA é usada para: (1) ler a ficha funcional colada em texto e preencher o cadastro do servidor;
      (2) gerar, a partir do CBO, as atividades do PPP e os elementos de LTCAT e PCMSO. A chave pode ser guardada aqui ou
      no arquivo <code>.env</code> do servidor (variável de ambiente) — o que preferir.</p>
    </div></div>
  `);
  document.getElementById('ia-salvar').onclick = async () => {
    const chave = document.getElementById('ia-chave').value.trim();
    const modelo = document.getElementById('ia-modelo').value.trim();
    try {
      await api.post('/api/ia/config', { chave: chave || undefined, modelo });
      toast('Configuração da IA salva'); renderConfigIa();
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('ia-testar').onclick = async () => {
    const msg = document.getElementById('ia-msg');
    msg.textContent = 'Testando…';
    try {
      const r = await api.post('/api/ia/testar');
      msg.innerHTML = r.ok ? '✅ Conexão OK — a IA respondeu.' : `Resposta inesperada: ${esc(r.resposta || '')}`;
    } catch (e) { msg.innerHTML = `<span style="color:var(--danger,#c00)">❌ ${esc(e.message)}</span>`; }
  };
}

// Configuração da Perícia — texto-padrão do comprovante + contato.
async function renderConfigPericia() {
  shell('<div class="empty">Carregando…</div>');
  const c = await api.get('/api/config/pericia').catch(() => ({}));
  setMain(`
    <div class="page-head"><div>
      <h2>⚙️ Configuração da Perícia</h2>
      <div class="desc">Textos e contatos usados nos documentos oficiais (comprovante ao servidor).</div>
    </div></div>
    <div class="card"><div class="card-b">
      <div class="row"><div class="field"><label>WhatsApp da perícia</label><input id="cp-wa" value="${esc(c.pericia_whatsapp || '')}"></div>
        <div class="field"><label>E-mail da perícia</label><input id="cp-email" value="${esc(c.pericia_email || '')}"></div></div>
      <div class="field"><label>Horários</label><input id="cp-horario" value="${esc(c.pericia_horario || '')}"></div>
      <div class="field"><label>Texto-padrão do comprovante (uma observação por linha)</label>
        <textarea id="cp-obs" style="min-height:220px;font-size:13px">${esc(c.comprovante_obs || '')}</textarea></div>
      <div class="field"><label>🔗 Token da Natasha (WhatsApp) — porta de entrada</label>
        <div style="margin:2px 0 6px">${c.natasha_do_cofre
          ? '<span class="canal wa">✅ lido do cofre automaticamente</span>'
          : c.natasha_token_definido ? '<span class="canal sei">definido</span>' : '<span class="canal gh">não encontrado no cofre</span>'}</div>
        <input id="cp-natasha" type="password" placeholder="${c.natasha_do_cofre ? 'já vem do cofre — só preencha para sobrepor' : (c.natasha_token_definido ? '•••••••• (definido — deixe em branco para manter)' : 'opcional: cole o token; ou deixe o sistema ler do cofre')}" ${c.natasha_travado_env ? 'disabled' : ''}>
        <span class="muted" style="font-size:12px">O sistema lê o token do <b>cofre</b> (<code>/etc/natasha/config.json</code> → <code>gro.token</code> ou o <code>integra_gro_natasha.key</code>). A Natasha usa esse token no header <code>X-Natasha-Token</code> para entregar os documentos do WhatsApp na Caixa de entrada.</span></div>
      <button class="btn" id="cp-salvar">Salvar</button>
      <span class="muted" style="margin-left:10px;font-size:13px">Aparece no rodapé do comprovante ao servidor.</span>
    </div></div>
  `);
  document.getElementById('cp-salvar').onclick = async () => {
    try {
      const nat = document.getElementById('cp-natasha').value.trim();
      await api.post('/api/config/pericia', {
        pericia_whatsapp: document.getElementById('cp-wa').value,
        pericia_email: document.getElementById('cp-email').value,
        pericia_horario: document.getElementById('cp-horario').value,
        comprovante_obs: document.getElementById('cp-obs').value,
        ...(nat ? { natasha_token: nat } : {}),
      });
      toast('Configuração da perícia salva');
    } catch (e) { toast(e.message, true); }
  };
}

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
        <div class="field"><label>Enviar processo à unidade (opcional)</label><input name="unidade_destino" placeholder="ex.: SEMUS ou sigla da unidade de destino"></div>
        <div class="field"><label><input type="checkbox" name="assinar" checked style="width:auto"> Assinar o despacho no SEI automaticamente (com a senha do SEI)</label></div>
        <div class="field"><label>Cargo/Função para assinatura (se o SEI pedir)</label><input name="cargo" placeholder="ex.: Perito Médico"></div>
        <div class="field"><label><input type="checkbox" name="gerar_pdf" checked style="width:auto"> Gerar PDF do processo inteiro ao buscar conteúdo (recomendado — permite consultar/imprimir/arquivar; deixe marcado)</label></div>`,
    });
    if (!r) return;
    try { await api.post('/api/sei/config', { ...r, padrao: 1, assinar: !!r.assinar, gerar_pdf: !!r.gerar_pdf }); toast('Configuração salva'); renderConfigSei(); }
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
