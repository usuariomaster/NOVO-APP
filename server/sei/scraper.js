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

// Extrai a lista de processos da tela "Controle de Processos".
async function extrairControleProcessos(page, baseUrl, cfg) {
  const url = cfg.unidade
    ? `${baseUrl}/controlador.php?acao=procedimento_controlar&infra_unidade_atual=${cfg.unidade}`
    : `${baseUrl}/controlador.php?acao=procedimento_controlar`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // O SEI mostra os processos em tabelas cujas linhas têm links
  // para "procedimento_trabalhar". Extraímos número + link.
  const linhas = await page.$$eval('a[href*="procedimento_trabalhar"]', (els) =>
    els.map((el) => ({
      numero_sei: (el.textContent || '').trim(),
      link_sei: el.href,
    }))
  );

  // Deduplica por número
  const vistos = new Set();
  const processos = [];
  for (const l of linhas) {
    if (!l.numero_sei || vistos.has(l.numero_sei)) continue;
    vistos.add(l.numero_sei);
    processos.push({
      numero_sei: l.numero_sei,
      link_sei: l.link_sei,
      tipo: null,
      interessado: null,
      especificacao: null,
      data_autuacao: null,
      unidade_origem: cfg.apelido || null,
      documentos: [],
    });
  }
  return processos;
}

// API pública: extrai os processos usando a configuração informada.
// cfg = { base_url, orgao, unidade, usuario, senha, apelido }
// mock = true usa dados de exemplo (não acessa o SEI).
export async function extrairProcessos(cfg, mock) {
  if (mock) {
    // Simula latência de rede
    await new Promise((r) => setTimeout(r, 400));
    return { modo: 'simulacao', processos: processosDeExemplo() };
  }

  const browser = await abrirNavegador();
  let page = null;
  try {
    const auth = await autenticar(browser, cfg);
    page = auth.page;
    const processos = await extrairControleProcessos(page, auth.baseUrl, cfg);
    // Guarda um print do "Controle de Processos" para conferência/calibração.
    const debug = await salvarDiagnostico(page, 'debug-controle');
    return { modo: 'sei', processos, debug };
  } catch (e) {
    if (page && !e.debug) e.debug = await salvarDiagnostico(page, 'debug-extracao');
    throw e;
  } finally {
    await browser.close();
  }
}
