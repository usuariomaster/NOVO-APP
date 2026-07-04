// ============================================================
// Robô de extração do SEI (Nova Iguaçu)
//
// O SEI é um sistema autenticado: o link "controlador.php?..."
// só abre para quem já fez login naquela unidade. Por isso o
// robô faz o login com usuário/senha e navega até o "Controle
// de Processos" para extrair a lista.
//
// Como cada instalação do SEI pode variar de layout/versão, os
// seletores abaixo têm valores padrão do SEI 4.x e podem ser
// ajustados. Em SEI_MOCK=true nada disso roda: devolvemos
// processos de exemplo para o sistema ser testado de ponta a
// ponta sem credenciais.
// ============================================================
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR_DIAG = join(__dirname, '..', '..', 'data', 'comprovantes');
fs.mkdirSync(DIR_DIAG, { recursive: true });

export const HEADFUL = () => String(process.env.SEI_HEADFUL ?? 'false').toLowerCase() === 'true';

// Salva um print + o HTML da página para diagnóstico remoto.
// Retorna o nome do arquivo de imagem (ou null).
export async function salvarDiagnostico(page, nome) {
  try {
    const png = `${nome}.png`;
    await page.screenshot({ path: join(DIR_DIAG, png), fullPage: true });
    try {
      const html = await page.content();
      fs.writeFileSync(join(DIR_DIAG, `${nome}.html`), html, 'utf8');
    } catch { /* ignora */ }
    return png;
  } catch {
    return null;
  }
}

// Seletores do SEI 4.x — centralizados para facilitar o ajuste caso a
// instalação de Nova Iguaçu use um layout/tema diferente.
export const SEL = {
  loginUsuario: '#txtUsuario',
  loginSenha: '#pwdSenha',
  loginOrgao: '#selOrgao',
  loginBotao: '#sbmLogin, #sbmAcessar, #Acessar, button[type="submit"], input[type="submit"]',
  buscaRapida: '#txtPesquisaRapida',
  frameArvore: 'ifrArvore',
  frameVisualizacao: 'ifrVisualizacao',
  linkTrabalhar: 'a[href*="procedimento_trabalhar"]',
  incluirDocumento: 'a[href*="documento_escolher_tipo"], img[title="Incluir Documento"]',
  campoTipoDocumento: '#txtFiltro, #tblSeries input[type=text]',
  editorCorpo: 'body', // dentro do iframe do CKEditor
  botaoSalvarDoc: '#btnSalvar, a[onclick*="salvar"], input[value="Salvar"]',
  enviarProcesso: 'a[href*="procedimento_enviar"], img[title="Enviar Processo"]',
};

// Procura um Chromium já instalado no ambiente (útil quando o pacote
// não baixou o navegador). Retorna o caminho do executável ou null.
function acharChromiumInstalado() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  try {
    const bases = ['/opt/pw-browsers'];
    for (const base of bases) {
      if (!fs.existsSync(base)) continue;
      for (const dir of fs.readdirSync(base)) {
        if (!/^chromium-\d+$/.test(dir)) continue;
        const alvo = `${base}/${dir}/chrome-linux/chrome`;
        if (fs.existsSync(alvo)) return alvo;
      }
    }
  } catch { /* ignora */ }
  return null;
}

// Sobe o navegador do robô. Usa o navegador do próprio Playwright quando
// disponível; senão, cai para um Chromium já instalado no ambiente.
export async function abrirNavegador() {
  const { chromium } = await import('playwright');
  const execPath = acharChromiumInstalado() || undefined;
  return chromium.launch({
    headless: !HEADFUL(),
    ...(execPath ? { executablePath: execPath } : {}),
    args: ['--no-sandbox'],
  });
}

function processosDeExemplo() {
  const hoje = new Date().toISOString().slice(0, 10);
  return [
    {
      numero_sei: '00000.00123/2026-45',
      tipo: 'Perícia Médica',
      interessado: 'João da Silva',
      especificacao: 'Solicitação de perícia para readaptação funcional',
      data_autuacao: hoje,
      unidade_origem: 'SEMAD',
      link_sei: 'https://sei.novaiguacu.rj.gov.br/sei/controlador.php?acao=procedimento_visualizar',
      documentos: [
        { numero: '0012345', tipo: 'Requerimento', data: hoje },
        { numero: '0012346', tipo: 'Laudo Médico', data: hoje },
      ],
    },
    {
      numero_sei: '00000.00456/2026-11',
      tipo: 'Perícia Ambiental',
      interessado: 'Construtora Horizonte LTDA',
      especificacao: 'Vistoria técnica de licenciamento',
      data_autuacao: hoje,
      unidade_origem: 'SEMAM',
      link_sei: 'https://sei.novaiguacu.rj.gov.br/sei/controlador.php?acao=procedimento_visualizar',
      documentos: [{ numero: '0045601', tipo: 'Projeto', data: hoje }],
    },
    {
      numero_sei: '00000.00789/2026-88',
      tipo: 'Perícia Contábil',
      interessado: 'Secretaria de Fazenda',
      especificacao: 'Análise de prestação de contas',
      data_autuacao: hoje,
      unidade_origem: 'SEMFA',
      link_sei: 'https://sei.novaiguacu.rj.gov.br/sei/controlador.php?acao=procedimento_visualizar',
      documentos: [],
    },
  ];
}

// Faz login e retorna a página/contexto autenticados.
export async function autenticar(browser, cfg) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const baseUrl = (cfg.base_url || '').replace(/\/+$/, '');
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Campos padrão do SEI 4.x
  await page.fill(SEL.loginUsuario, cfg.usuario);
  await page.fill(SEL.loginSenha, cfg.senha);
  if (cfg.orgao) {
    const temOrgao = await page.$(SEL.loginOrgao);
    if (temOrgao) {
      await page.selectOption(SEL.loginOrgao, { label: cfg.orgao }).catch(() => {});
    }
  }
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}),
    page.click(SEL.loginBotao),
  ]);

  // Se ainda houver o campo de senha, o login falhou.
  if (await page.$(SEL.loginSenha)) {
    const debug = await salvarDiagnostico(page, 'debug-login');
    const err = new Error('Falha no login do SEI — verifique usuário, senha e órgão.');
    err.debug = debug;
    throw err;
  }
  return { context, page, baseUrl };
}

// Coleta os links de processo dentro de UM frame (tolerante a erros).
async function coletarDoFrame(frame) {
  try {
    return await frame.$$eval('a', (els) => {
      // Reconhece número de processo: tem dígitos e algum separador (. - /),
      // sem espaços, com tamanho razoável. Ex.: 00000.000123/2026-45,
      // SEI-000000/000000/2026, 12345.678910/2026-01, etc.
      const pareceProcesso = (s) =>
        !!s && !/\s/.test(s) && /\d/.test(s) && /[.\-/]/.test(s) && s.length >= 9;
      const out = [];
      for (const el of els) {
        const txt = (el.textContent || '').trim();
        const href = el.getAttribute('href') || '';
        const porHref = /procedimento_trabalhar|procedimento_visualizar/.test(href);
        if ((porHref || pareceProcesso(txt)) && pareceProcesso(txt)) {
          out.push({ numero_sei: txt, link_sei: el.href || '', porHref });
        }
      }
      return out;
    });
  } catch {
    return [];
  }
}

// Coleta candidatos de todos os quadros da página.
async function coletarTodos(page) {
  let c = [];
  for (const frame of page.frames()) {
    c = c.concat(await coletarDoFrame(frame));
  }
  return c;
}

// Clica no menu "Controle de Processos" (usando o link real da tela, que
// carrega o hash de sessão do SEI). Retorna true se conseguiu clicar.
async function clicarControle(page) {
  for (const frame of page.frames()) {
    try {
      const link = frame
        .locator('a[href*="procedimento_controlar"], a:has-text("Controle de Processos"), img[title*="Controle de Processos"]')
        .first();
      if (await link.count()) {
        await link.click({ timeout: 10000 });
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1200);
        return true;
      }
    } catch { /* tenta o próximo quadro */ }
  }
  return false;
}

// Extrai a lista de processos da tela "Controle de Processos".
// Importante: NÃO navegamos por URL direta — o SEI rejeita isso (falta o
// hash de sessão) e volta ao login. Após o login o SEI já mostra o
// "Controle de Processos"; se não for o caso, clicamos no menu.
async function extrairControleProcessos(page, unidadeNome) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // A lista pode estar na página ou dentro de um quadro (iframe).
  let candidatos = await coletarTodos(page);

  // Se não achou nada, tenta abrir o menu "Controle de Processos".
  if (candidatos.length === 0) {
    await clicarControle(page);
    candidatos = await coletarTodos(page);
  }

  // Prioriza os que vieram por link de "trabalhar/visualizar"; se não houver
  // nenhum, usa todos os que parecem número de processo (fallback).
  const comHref = candidatos.filter((c) => c.porHref);
  const base = comHref.length ? comHref : candidatos;

  // Deduplica por número
  const vistos = new Set();
  const processos = [];
  for (const l of base) {
    if (!l.numero_sei || vistos.has(l.numero_sei)) continue;
    vistos.add(l.numero_sei);
    processos.push({
      numero_sei: l.numero_sei,
      link_sei: l.link_sei,
      tipo: null,
      interessado: null,
      especificacao: null,
      data_autuacao: null,
      unidade_origem: unidadeNome || null,
      documentos: [],
    });
  }

  // Se nada foi encontrado, coleta uma amostra (texto) do que há na tela,
  // para diagnóstico/calibração remota.
  let amostra = null;
  if (processos.length === 0) {
    amostra = await coletarAmostra(page);
  }
  return { processos, amostra };
}

// Amostra de diagnóstico: títulos de tabelas e primeiros links de cada frame.
async function coletarAmostra(page) {
  const partes = [];
  for (const frame of page.frames()) {
    try {
      const dados = await frame.$$eval('a', (els) =>
        els
          .map((el) => ({ t: (el.textContent || '').trim(), h: el.getAttribute('href') || '' }))
          .filter((x) => x.t)
          .slice(0, 60)
      );
      if (dados.length) {
        partes.push(
          `--- quadro: ${frame.url().slice(0, 80)} ---\n` +
            dados.map((d) => `${d.t}  =>  ${d.h.slice(0, 90)}`).join('\n')
        );
      }
    } catch { /* ignora */ }
  }
  return partes.join('\n\n').slice(0, 6000);
}

// Lê o nome da unidade atual (indicador no topo do SEI).
async function unidadeAtual(page) {
  for (const f of page.frames()) {
    try {
      const t = await f.evaluate(() => {
        const el = document.querySelector('#lnkInfraUnidade, a[href*="infra_trocar_unidade"]');
        return el ? (el.textContent || '').trim() : '';
      });
      if (t && t.length <= 60) return t;
    } catch { /* ignora */ }
  }
  return null;
}

// Abre o "Trocar Unidade" e lista as unidades que o usuário pode acessar.
async function listarUnidades(page) {
  let abriu = false;
  for (const f of page.frames()) {
    try {
      const link = f.locator('#lnkInfraUnidade, a[href*="infra_trocar_unidade"]').first();
      if (await link.count()) { await link.click({ timeout: 10000 }); abriu = true; break; }
    } catch { /* ignora */ }
  }
  if (!abriu) return [];
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
  for (const f of page.frames()) {
    try {
      const us = await f.$$eval('a', (els) =>
        els
          .map((e) => ({ nome: (e.textContent || '').trim(), href: e.href || '' }))
          .filter((x) => x.nome && /id_unidade=/.test(x.href) && x.nome.length <= 60)
      );
      if (us.length) {
        const vistos = new Set();
        return us.filter((u) => (vistos.has(u.nome) ? false : vistos.add(u.nome)));
      }
    } catch { /* ignora */ }
  }
  return [];
}

// Troca para a unidade informada (o link carrega o hash de sessão).
async function trocarUnidade(page, unidade) {
  try {
    await page.goto(unidade.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  } catch {
    return false;
  }
}

// API pública: extrai os processos de TODAS as unidades permitidas.
// mock = true usa dados de exemplo (não acessa o SEI).
export async function extrairProcessos(cfg, mock) {
  if (mock) {
    await new Promise((r) => setTimeout(r, 400));
    const processos = processosDeExemplo();
    const porUnidade = {};
    for (const p of processos) porUnidade[p.unidade_origem] = (porUnidade[p.unidade_origem] || 0) + 1;
    return { modo: 'simulacao', processos, porUnidade };
  }

  const browser = await abrirNavegador();
  let page = null;
  try {
    const auth = await autenticar(browser, cfg);
    page = auth.page;

    const todos = [];
    const porUnidade = {};
    const nomeAtual = (await unidadeAtual(page)) || cfg.apelido || 'Unidade atual';

    // 1) Unidade em que já entramos.
    const r1 = await extrairControleProcessos(page, nomeAtual);
    for (const p of r1.processos) todos.push(p);
    porUnidade[nomeAtual] = r1.processos.length;

    // 2) Demais unidades permitidas.
    const unidades = await listarUnidades(page);
    for (const u of unidades) {
      if (u.nome === nomeAtual) continue;
      const ok = await trocarUnidade(page, u);
      if (!ok) continue;
      const r = await extrairControleProcessos(page, u.nome);
      for (const p of r.processos) todos.push(p);
      porUnidade[u.nome] = r.processos.length;
    }

    const debug = await salvarDiagnostico(page, 'debug-controle');
    if (r1.amostra) {
      try { fs.writeFileSync(join(DIR_DIAG, 'debug-amostra.txt'), r1.amostra, 'utf8'); } catch { /* ignora */ }
    }
    return { modo: 'sei', processos: todos, porUnidade, debug, amostra: r1.amostra };
  } catch (e) {
    if (page && !e.debug) e.debug = await salvarDiagnostico(page, 'debug-extracao');
    throw e;
  } finally {
    await browser.close();
  }
}
