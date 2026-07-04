// ============================================================
// Robô de ESCRITA no SEI — lança o despacho de volta no processo
//
// Em vez de depender do Web Service oficial (que exige chave
// liberada pelo TI do município), este módulo automatiza a
// própria tela do SEI: faz login, abre o processo pelo número,
// inclui um documento do tipo "Despacho", escreve o texto no
// editor e (opcionalmente) envia o processo para a unidade de
// destino. É a mesma sequência que a operadora faria à mão.
//
// Cada passo é registrado e um COMPROVANTE (print) é salvo em
// data/comprovantes para auditoria. Em SEI_MOCK=true nada disso
// acontece: geramos um comprovante simulado.
// ============================================================
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SEL, abrirNavegador, autenticar } from './scraper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dirComprovantes = join(__dirname, '..', '..', 'data', 'comprovantes');
mkdirSync(dirComprovantes, { recursive: true });

// Localiza o frame de conteúdo do SEI (ifrVisualizacao) de forma tolerante.
function frameVis(page) {
  return (
    page.frame({ name: SEL.frameVisualizacao }) ||
    page.frames().find((f) => /ifrVisualizacao|infra_visualizacao/i.test(f.name() + f.url())) ||
    page.mainFrame()
  );
}

async function print(page, id, passo) {
  const arquivo = `proc-${id}-${passo}.png`;
  await page.screenshot({ path: join(dirComprovantes, arquivo), fullPage: true }).catch(() => {});
  return arquivo;
}

// dados = { numeroSei, texto, conclusao }
// cfg   = { base_url, orgao, usuario, senha, tipo_documento, nivel_acesso, unidade_destino, escrita }
export async function lancarDespachoNoSei(cfg, dados, mock) {
  const passos = [];
  const log = (m) => passos.push(m);

  if (mock) {
    await new Promise((r) => setTimeout(r, 500));
    const nome = `proc-${dados.processoId}-simulado.txt`;
    writeFileSync(
      join(dirComprovantes, nome),
      `COMPROVANTE (SIMULAÇÃO)\nProcesso: ${dados.numeroSei}\nConclusão: ${dados.conclusao || '-'}\n\n${dados.texto}\n`,
      'utf8'
    );
    return {
      modo: 'simulacao',
      ok: true,
      comprovante: nome,
      passos: ['Login (simulado)', 'Processo aberto (simulado)', 'Despacho incluído (simulado)', 'Comprovante gerado'],
    };
  }

  const browser = await abrirNavegador();
  let page;
  let comprovante = null;
  try {
    const auth = await autenticar(browser, cfg);
    page = auth.page;
    const baseUrl = auth.baseUrl;
    log('Login realizado');

    // 1) Abre o processo pelo número, via pesquisa rápida do SEI.
    const busca = await page.$(SEL.buscaRapida);
    if (busca) {
      await busca.fill(dados.numeroSei);
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}),
        busca.press('Enter'),
      ]);
    } else {
      // Fallback: tela de controle e clique no processo correspondente.
      await page.goto(`${baseUrl}/controlador.php?acao=procedimento_controlar`, { waitUntil: 'domcontentloaded' });
      const link = page.locator(`${SEL.linkTrabalhar}:has-text("${dados.numeroSei}")`).first();
      await link.click({ timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    }
    log(`Processo ${dados.numeroSei} aberto`);
    comprovante = await print(page, dados.processoId, '1-aberto');

    // 2) Inclui um novo documento.
    const vis = frameVis(page);
    const incluir = vis.locator(SEL.incluirDocumento).first();
    await incluir.click({ timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    log('Tela de inclusão de documento aberta');

    // 3) Escolhe o tipo de documento (ex.: "Despacho").
    const vis2 = frameVis(page);
    const filtro = vis2.locator(SEL.campoTipoDocumento).first();
    if (await filtro.count()) {
      await filtro.fill(cfg.tipo_documento || 'Despacho');
    }
    const tipoLink = vis2.locator(`a:has-text("${cfg.tipo_documento || 'Despacho'}")`).first();
    await tipoLink.click({ timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    log(`Tipo de documento selecionado: ${cfg.tipo_documento || 'Despacho'}`);

    // 4) Formulário "Gerar Documento": nível de acesso + salvar.
    const vis3 = frameVis(page);
    const nivel = (cfg.nivel_acesso || 'publico').toLowerCase();
    const radioNivel = vis3.locator(
      nivel === 'publico' ? 'input#lblPublico, input[value="0"]' :
      nivel === 'restrito' ? 'input#lblRestrito, input[value="1"]' :
      'input#lblSigiloso, input[value="2"]'
    ).first();
    if (await radioNivel.count()) await radioNivel.check().catch(() => {});
    const salvarForm = vis3.locator(SEL.botaoSalvarDoc).first();
    await salvarForm.click({ timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    log('Documento criado');

    // 5) Escreve o texto no editor (CKEditor abre em nova aba/janela).
    const editorPage = await esperarEditor(page, browser);
    const corpo = await localizarCorpoEditor(editorPage);
    const conteudo = montarHtmlDespacho(dados);
    await corpo.evaluate((el, html) => { el.innerHTML = html; }, conteudo);
    log('Texto do despacho inserido');

    // 6) Salva o documento (Ctrl+S é o atalho padrão do editor do SEI).
    await editorPage.keyboard.press('Control+s');
    await editorPage.waitForTimeout(2500);
    log('Despacho salvo');
    comprovante = await print(editorPage, dados.processoId, '2-despacho');
    await editorPage.close().catch(() => {});

    // 6b) Assina o documento com a senha do SEI (assinatura eletrônica válida).
    if (cfg.assinar !== false) {
      try {
        await assinarDocumento(page, cfg);
        log('Documento assinado no SEI');
        comprovante = await print(page, dados.processoId, '2b-assinado');
      } catch (e) {
        log(`Aviso: não consegui assinar automaticamente (${e.message})`);
      }
    }

    // 7) (Opcional) Envia o processo de volta para a unidade de destino.
    if (cfg.unidade_destino) {
      const visEnv = frameVis(page);
      const btnEnviar = visEnv.locator(SEL.enviarProcesso).first();
      if (await btnEnviar.count()) {
        await btnEnviar.click({ timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
        const visEnv2 = frameVis(page);
        const campoUnidade = visEnv2.locator('#txtUnidade, input[name="txtUnidade"]').first();
        if (await campoUnidade.count()) {
          await campoUnidade.fill(cfg.unidade_destino);
          await campoUnidade.press('Enter').catch(() => {});
        }
        const enviar = visEnv2.locator('#sbmEnviar, input[value="Enviar"], a[onclick*="enviar"]').first();
        if (await enviar.count()) await enviar.click({ timeout: 20000 }).catch(() => {});
        log(`Processo enviado para a unidade ${cfg.unidade_destino}`);
        comprovante = await print(page, dados.processoId, '3-enviado');
      }
    }

    return { modo: 'sei', ok: true, comprovante, passos };
  } catch (e) {
    if (page) comprovante = await print(page, dados.processoId, 'erro').catch(() => comprovante);
    const err = new Error(`Falha ao lançar no SEI: ${e.message}`);
    err.passos = passos;
    err.comprovante = comprovante;
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Assina o documento recém-criado usando a senha do SEI (assinatura
// eletrônica do SEI). Procura o botão "Assinar Documento", preenche o
// cargo/função (se informado) e a senha, e confirma.
async function assinarDocumento(page, cfg) {
  // 1) Clica em "Assinar Documento" (na barra do documento).
  let clicou = false;
  for (const f of page.frames()) {
    try {
      const btn = f
        .locator('a[href*="documento_assinar"], img[title*="Assinar Documento"], a:has-text("Assinar Documento")')
        .first();
      if (await btn.count()) { await btn.click({ timeout: 15000 }); clicou = true; break; }
    } catch { /* tenta o próximo quadro */ }
  }
  if (!clicou) throw new Error('botão Assinar não encontrado');

  // O SEI abre a tela de assinatura (pode ser em popup).
  await page.waitForTimeout(1500);
  const ctx = page.context();
  const popup = ctx.pages().find((p) => /assinar/i.test(p.url()) && p !== page);
  const alvo = popup || page;
  await alvo.waitForLoadState('domcontentloaded').catch(() => {});

  // 2) Preenche cargo/função (se houver e configurado) e a senha.
  const frames = [alvo, ...alvo.frames()];
  for (const f of frames) {
    try {
      if (cfg.cargo) {
        const sel = f.locator('#selCargoFuncao, select[name*="Cargo"], select[id*="Cargo"]').first();
        if (await sel.count()) await sel.selectOption({ label: cfg.cargo }).catch(() => {});
      }
      const senhaCampo = f.locator('#pwdSenhaAssinatura, #pwdSenha, input[type="password"]').first();
      if (await senhaCampo.count()) {
        await senhaCampo.fill(cfg.senha);
        const ok = f.locator('#sbmAssinar, input[value*="Assinar"], button:has-text("Assinar"), a[onclick*="assinar"]').first();
        if (await ok.count()) {
          await ok.click({ timeout: 15000 });
          await page.waitForTimeout(2000);
          return true;
        }
      }
    } catch { /* tenta o próximo quadro */ }
  }
  throw new Error('campo de senha da assinatura não encontrado');
}

function montarHtmlDespacho(dados) {
  const conclusao = dados.conclusao ? `<p><strong>Conclusão:</strong> ${escaparHtml(dados.conclusao)}</p>` : '';
  const texto = escaparHtml(dados.texto || '').replace(/\n/g, '<br>');
  return `${conclusao}<p>${texto}</p>`;
}

function escaparHtml(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// O editor do SEI costuma abrir em nova aba/popup; aguardamos essa página.
async function esperarEditor(page, browser) {
  const ctx = page.context();
  const nova = await Promise.race([
    ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null),
    page.waitForTimeout(3000).then(() => null),
  ]);
  if (nova) {
    await nova.waitForLoadState('domcontentloaded').catch(() => {});
    return nova;
  }
  // Sem popup: o editor pode estar embutido na própria página.
  return page;
}

// Localiza o corpo editável do CKEditor (dentro de um iframe .cke_wysiwyg_frame).
async function localizarCorpoEditor(editorPage) {
  const iframe = editorPage.locator('iframe.cke_wysiwyg_frame, iframe.cke_wysiwyg_div, iframe[title*="Rich Text"]').first();
  if (await iframe.count()) {
    const frame = await iframe.contentFrame();
    if (frame) return frame.locator('body').first();
  }
  // Fallback: área contenteditable direta.
  return editorPage.locator('[contenteditable="true"], body').first();
}
