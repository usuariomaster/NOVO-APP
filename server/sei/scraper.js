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

const MOCK = () => String(process.env.SEI_MOCK ?? 'true').toLowerCase() === 'true';
const HEADFUL = () => String(process.env.SEI_HEADFUL ?? 'false').toLowerCase() === 'true';

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
async function autenticar(browser, cfg) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const baseUrl = (cfg.base_url || '').replace(/\/+$/, '');
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Campos padrão do SEI 4.x
  await page.fill('#txtUsuario', cfg.usuario);
  await page.fill('#pwdSenha', cfg.senha);
  if (cfg.orgao) {
    // Seletor de órgão, quando presente
    const temOrgao = await page.$('#selOrgao');
    if (temOrgao) {
      await page.selectOption('#selOrgao', { label: cfg.orgao }).catch(() => {});
    }
  }
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}),
    page.click('#sbmAcessar, #Acessar, button[type="submit"], input[type="submit"]'),
  ]);

  // Se ainda houver o campo de senha, o login falhou.
  if (await page.$('#pwdSenha')) {
    throw new Error('Falha no login do SEI — verifique usuário, senha e órgão.');
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
export async function extrairProcessos(cfg) {
  if (MOCK()) {
    // Simula latência de rede
    await new Promise((r) => setTimeout(r, 400));
    return { modo: 'simulacao', processos: processosDeExemplo() };
  }

  // Import dinâmico para não exigir o Chromium instalado no modo simulação
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: !HEADFUL() });
  try {
    const { page, baseUrl } = await autenticar(browser, cfg);
    const processos = await extrairControleProcessos(page, baseUrl, cfg);
    return { modo: 'sei', processos };
  } finally {
    await browser.close();
  }
}
