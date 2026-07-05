// ============================================================
// Robô de DETALHAMENTO — abre um processo no SEI e lê o conteúdo
// (interessado, tipo, especificação e a lista de documentos).
//
// Abrimos o processo pela "pesquisa rápida" do SEI (que funciona
// numa sessão nova) e lemos a árvore de documentos + os dados.
// Como cada SEI mostra os detalhes de forma um pouco diferente,
// também coletamos uma AMOSTRA de texto para calibração.
// ============================================================
import fs from 'node:fs';
import { join } from 'node:path';
import { SEL, abrirNavegador, autenticar, salvarDiagnostico } from './scraper.js';

// Abre o processo pelo número usando a pesquisa rápida do SEI.
async function abrirProcesso(page, baseUrl, numeroSei) {
  const busca = await page.$(SEL.buscaRapida);
  if (busca) {
    await busca.fill(numeroSei);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}),
      busca.press('Enter'),
    ]);
  } else {
    // Fallback: clica no processo dentro do "Controle de Processos".
    for (const frame of page.frames()) {
      const link = frame.locator(`a:has-text("${numeroSei}")`).first();
      if (await link.count()) {
        await link.click({ timeout: 15000 }).catch(() => {});
        break;
      }
    }
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

// Localiza o quadro (frame) da árvore de documentos — o que tiver mais
// links com número de documento (6 a 9 dígitos).
async function acharArvore(page) {
  let melhor = null;
  let maxN = 0;
  for (const frame of page.frames()) {
    try {
      const n = await frame.$$eval('a', (els) =>
        els.filter((el) => /\d{6,9}/.test((el.textContent || '').trim())).length
      );
      if (n > maxN) { maxN = n; melhor = frame; }
    } catch { /* ignora */ }
  }
  return melhor;
}

// Localiza o quadro de conteúdo do documento (procedimento_visualizar).
function acharConteudo(page) {
  const frames = page.frames();
  return (
    frames.find((f) => /documento_visualizar/i.test(f.url())) ||
    frames.find((f) => /procedimento_visualizar/i.test(f.url())) ||
    null
  );
}

// Coleta os documentos a partir da árvore do processo, filtrando o lixo
// (nomes de setores, "Fechar", "Link para Acesso Direto", número do processo).
async function coletarDocumentos(page) {
  const arvore = await acharArvore(page);
  if (!arvore) return [];
  let itens = [];
  try {
    itens = await arvore.$$eval('a', (els) =>
      els
        .map((el) => ({ t: (el.textContent || '').trim(), h: el.href || '' }))
        .filter((x) => x.t)
    );
  } catch {
    return [];
  }

  // Cada documento tem um número de 6 a 9 dígitos (ex.: 0283965).
  // O número do processo tem "/" — descartamos. Rótulos sem número
  // (setores, "Fechar") também são descartados.
  const porNumero = new Map();
  for (const it of itens) {
    if (/^(fechar|link para acesso direto)$/i.test(it.t)) continue;
    if (it.t.includes('/')) continue; // número do processo
    const m = it.t.match(/(\d{6,9})/);
    if (!m) continue;
    const numero = m[1];
    const tipo = it.t.replace(/\(?\b\d{6,9}\b\)?/, '').replace(/[()]/g, '').trim();
    const anterior = porNumero.get(numero);
    // Mantém a versão com o nome (tipo) mais descritivo.
    if (!anterior || tipo.length > (anterior._tipoLen || 0)) {
      porNumero.set(numero, {
        numero,
        tipo: tipo || 'Documento',
        _tipoLen: tipo.length,
        link_sei: it.h && /^https?:/i.test(it.h) ? it.h : '',
      });
    }
  }
  return [...porNumero.values()].map(({ _tipoLen, ...d }) => d);
}

// Abre o primeiro documento e captura uma amostra da tela do documento,
// para calibrar a leitura de conteúdo (texto do despacho / PDF).
async function amostraDocumento(page) {
  const arvore = await acharArvore(page);
  if (!arvore) return null;
  try {
    // clica no primeiro link que tenha número de documento
    const link = arvore.locator('a').filter({ hasText: /\d{6,9}/ }).first();
    if (!(await link.count())) return null;
    await link.click({ timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } catch {
    return null;
  }
  // coleta texto + fontes de PDF (embed/object/iframe) de todos os quadros
  const partes = [];
  for (const frame of page.frames()) {
    try {
      const info = await frame.evaluate(() => {
        const txt = (document.body ? document.body.innerText : '').trim().slice(0, 1200);
        const srcs = [];
        document.querySelectorAll('embed,object,iframe').forEach((e) => {
          const s = e.getAttribute('src') || e.getAttribute('data') || '';
          if (s) srcs.push(s);
        });
        return { txt, srcs };
      });
      if (info.txt || info.srcs.length) {
        partes.push(`--- quadro: ${frame.url().slice(0, 90)} ---\nTEXTO:\n${info.txt}\nPDF/SRC:\n${info.srcs.join('\n')}`);
      }
    } catch { /* ignora */ }
  }
  return partes.join('\n\n').slice(0, 8000);
}

// Gera o PDF do processo inteiro usando a função nativa do SEI
// ("Gerar Arquivo PDF do Processo") e salva o arquivo. Trata os 3 finais
// possíveis: download direto, popup que baixa, ou popup que ABRE o PDF
// (nesse caso baixamos via requisição autenticada). Retorna o nome ou null.
async function gerarPdfProcesso(page, dir, processoId) {
  const context = page.context();
  const destino = join(dir, `processo-${processoId}.pdf`);
  const salvarDownload = async (dl) => { try { await dl.saveAs(destino); return true; } catch { return false; } };
  const salvarPorUrl = async (url) => {
    try {
      const resp = await context.request.get(url, { timeout: 60000 });
      if (resp.ok()) { const buf = await resp.body(); if (buf && buf.length > 800) { fs.writeFileSync(destino, buf); return true; } }
    } catch { /* ignora */ }
    return false;
  };

  // 1) Clica em "Gerar Arquivo PDF do Processo" na barra do processo.
  const seletores = [
    'a[href*="procedimento_gerar_pdf"]',
    'a:has-text("Gerar Arquivo PDF do Processo")',
    'img[title*="Gerar Arquivo PDF do Processo"]',
    'img[title*="Gerar Arquivo PDF"]',
    'a[onclick*="gerar_pdf"]',
  ];
  let tela = null;
  let dlInicial = null;
  outer:
  for (const f of page.frames()) {
    for (const sel of seletores) {
      try {
        const link = f.locator(sel).first();
        if (!(await link.count())) continue;
        const [popup, dl] = await Promise.all([
          context.waitForEvent('page', { timeout: 3500 }).catch(() => null),
          page.waitForEvent('download', { timeout: 3500 }).catch(() => null),
          link.click({ timeout: 8000 }).catch(() => null),
        ]);
        dlInicial = dl;
        tela = popup || page;
        break outer;
      } catch { /* próximo */ }
    }
  }
  if (!tela) return null;
  if (dlInicial && (await salvarDownload(dlInicial))) return `processo-${processoId}.pdf`;
  await tela.waitForLoadState('domcontentloaded').catch(() => {});
  await tela.waitForTimeout(1000);

  // Se a tela já é um PDF (popup abriu o arquivo), baixa por URL.
  if (/\.pdf(\?|$)|gerar_pdf|documento_download|arquivo_pdf/i.test(tela.url())) {
    if (await salvarPorUrl(tela.url())) { if (tela !== page) await tela.close().catch(() => {}); return `processo-${processoId}.pdf`; }
  }

  // 2) Tela de opções: clica "Gerar" e captura download OU popup com o PDF.
  const clicarGerar = async () => {
    for (const f of tela.frames()) {
      try {
        const b = f.locator('#sbmGerar, input[value*="Gerar"], button:has-text("Gerar"), a:has-text("Gerar")').first();
        if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); return; }
      } catch { /* próximo */ }
    }
  };
  let download = null, popup2 = null;
  try {
    [download, popup2] = await Promise.all([
      tela.waitForEvent('download', { timeout: 60000 }).catch(() => null),
      context.waitForEvent('page', { timeout: 60000 }).catch(() => null),
      clicarGerar(),
    ]);
  } catch { /* ignora */ }
  if (download && (await salvarDownload(download))) { if (tela !== page) await tela.close().catch(() => {}); return `processo-${processoId}.pdf`; }
  if (popup2) {
    await popup2.waitForLoadState('domcontentloaded').catch(() => {});
    const dl2 = await popup2.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    if (dl2 && (await salvarDownload(dl2))) { await popup2.close().catch(() => {}); return `processo-${processoId}.pdf`; }
    if (await salvarPorUrl(popup2.url())) { await popup2.close().catch(() => {}); return `processo-${processoId}.pdf`; }
    await popup2.close().catch(() => {});
  }
  if (tela !== page) await tela.close().catch(() => {});
  return null;
}

// Abre a "autuação" do processo (Consultar/Alterar Processo) e lê
// Tipo, Especificação e Interessados. Também devolve uma amostra da tela
// para calibração remota.
async function coletarMetadados(page) {
  // 1) Abre a tela de dados do processo (autuação).
  //    Primeiro clica no NÓ RAIZ da árvore (número do processo), que carrega
  //    a barra de ações do processo; depois clica em "Consultar Dados do
  //    Processo"/"Consultar Andamento" para chegar aos campos da autuação.
  try {
    const arvore = await acharArvore(page);
    if (arvore) {
      const raiz = arvore.locator('a').filter({ hasText: /\d{3}.*\/\d{4}|\d{5,}/ }).first();
      if (await raiz.count()) {
        await raiz.click({ timeout: 8000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
  } catch { /* segue */ }
  try {
    for (const f of page.frames()) {
      const link = f
        .locator('a[href*="procedimento_alterar"], a[href*="procedimento_consultar"], a[href*="procedimento_visualizar"], img[title*="Consultar Dados do Processo"], img[title*="Consultar/Alterar Processo"], img[title*="Consultar Processo"], a[title*="Consultar Dados do Processo"]')
        .first();
      if (await link.count()) {
        await link.click({ timeout: 10000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1200);
        break;
      }
    }
  } catch { /* segue com o que tiver */ }

  // 2) Lê os campos do formulário (vários IDs possíveis) + heurística por rótulo.
  const meta = { interessado: null, tipo: null, especificacao: null };
  let amostra = '';
  for (const f of page.frames()) {
    try {
      const d = await f.evaluate(() => {
        // Campos reais da autuação do SEI de Nova Iguaçu (descobertos por amostra):
        //  hdnInteressadosProcedimento = "id±NOME¥id±NOME2"
        //  hdnAssuntos                 = "id±CODIGO - descrição"
        //  selTipoProcedimento         = tipo do processo (opção selecionada)
        //  txtDescricao                = descrição livre (às vezes "REF. NOME")
        const g = (id) => { const e = document.getElementById(id); return e ? String(e.value || e.textContent || '').trim() : ''; };
        const selText = (id) => { const e = document.getElementById(id); if (!e || !e.options) return ''; const o = e.options[e.selectedIndex]; return o ? o.textContent.trim() : ''; };
        const aposPipe = (v) => !v ? '' : v.split(/[¥\n]/).map((x) => { const i = x.indexOf('±'); return (i >= 0 ? x.slice(i + 1) : x).trim(); }).filter(Boolean).join('; ');

        const tipo = selText('selTipoProcedimento') || g('hdnNomeTipoProcedimento') || null;
        let inter = aposPipe(g('hdnInteressadosProcedimento'));
        if (!inter) {
          const sel = document.getElementById('selInteressadosProcedimento') || document.querySelector('select[id*="Interessad"]');
          if (sel && sel.options) inter = Array.from(sel.options).map((o) => o.textContent.trim()).filter(Boolean).join('; ');
        }
        inter = inter || null;
        // Assunto/especificação: prefere a descrição livre; senão o assunto classificado.
        const espec = g('txtDescricao') || aposPipe(g('hdnAssuntos')) || null;
        // amostra: rótulos + campos visíveis
        const campos = Array.from(document.querySelectorAll('input,select,textarea'))
          .map((e) => `${e.id || e.name || ''}=${(e.value || (e.tagName === 'SELECT' && e.options[e.selectedIndex]?.textContent) || '').toString().trim().slice(0, 40)}`)
          .filter((x) => x.length > 1).slice(0, 40);
        const txt = (document.body ? document.body.innerText : '').trim().slice(0, 900);
        return { tipo, espec, inter, campos, txt };
      });
      if (d.tipo && !meta.tipo) meta.tipo = d.tipo;
      if (d.espec && !meta.especificacao) meta.especificacao = d.espec;
      if (d.inter && !meta.interessado) meta.interessado = d.inter;
      if ((d.txt || d.campos.length)) {
        amostra += `--- ${f.url().slice(0, 70)} ---\nCAMPOS:\n${d.campos.join('\n')}\nTEXTO:\n${d.txt}\n\n`;
      }
    } catch { /* ignora */ }
  }
  meta._amostra = amostra.slice(0, 8000);
  return meta;
}

// Amostra de texto/campos de todos os quadros, para calibração.
async function coletarAmostra(page) {
  const partes = [];
  for (const frame of page.frames()) {
    try {
      const info = await frame.evaluate(() => {
        const txt = (document.body ? document.body.innerText : '').trim().slice(0, 1200);
        // links relevantes (ações da barra): texto/title + href/onclick
        const links = Array.from(document.querySelectorAll('a,img,input[type=button],input[type=submit]'))
          .map((a) => {
            const t = (a.textContent || a.getAttribute('title') || a.getAttribute('value') || '').trim();
            const h = (a.getAttribute('href') || a.getAttribute('onclick') || '').slice(0, 120);
            return t || h ? `${t}  =>  ${h}` : '';
          })
          .filter(Boolean)
          .slice(0, 60);
        return { txt, links };
      });
      if (info.txt || info.links.length) {
        partes.push(
          `--- quadro: ${frame.url().slice(0, 80)} ---\nTEXTO:\n${info.txt}\nACOES:\n${info.links.join('\n')}`
        );
      }
    } catch { /* ignora */ }
  }
  return partes.join('\n\n').slice(0, 8000);
}

// ------------------------------------------------------------
// Captura automática da FICHA FUNCIONAL do processo (para OCR pela IA).
// Abre o processo, localiza na árvore os documentos com cara de ficha
// (Dados Cadastrais / Recursos Humanos / Ficha Funcional) e tira um
// print do conteúdo de cada um. Devolve as imagens em base64 (PNG).
// ------------------------------------------------------------
const FICHA_KW = /ficha|cadastr|funcional|recursos\s*humanos|dados\s*cadastr|assentament|\bRH\b|situa[çc][aã]o\s*funcional/i;

async function screenshotConteudo(page) {
  const frame = acharConteudo(page);
  try {
    if (frame) {
      const buf = await frame.locator('body').screenshot({ type: 'png', timeout: 8000 });
      return buf.toString('base64');
    }
  } catch { /* tenta a página inteira */ }
  try {
    const buf = await page.screenshot({ type: 'png', fullPage: true });
    return buf.toString('base64');
  } catch { return null; }
}

// Captura a ficha a partir de um processo JÁ ABERTO (reaproveita a navegação).
async function capturarFichaImagens(page) {
  const arvore = await acharArvore(page);
  if (!arvore) return { imagens: [], motivo: 'Árvore de documentos não encontrada.' };

  let anchors = [];
  try {
    anchors = await arvore.$$eval('a', (els) =>
      els.map((el, i) => ({ i, t: (el.textContent || '').trim() })).filter((x) => /\d{6,9}/.test(x.t))
    );
  } catch { /* segue */ }
  if (!anchors.length) return { imagens: [], motivo: 'Nenhum documento na árvore.' };

  // Prioriza documentos com cara de ficha; se nenhum, pega os 2 primeiros.
  const comKw = anchors.filter((a) => FICHA_KW.test(a.t));
  const alvos = (comKw.length ? comKw : anchors).slice(0, comKw.length ? 4 : 2);

  const imagens = [];
  const rotulos = [];
  for (const a of alvos) {
    try {
      const link = arvore.locator('a').nth(a.i);
      if (!(await link.count())) continue;
      await link.click({ timeout: 10000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const img = await screenshotConteudo(page);
      if (img) { imagens.push(img); rotulos.push(a.t); }
    } catch { /* tenta o próximo */ }
  }
  return { imagens, rotulos, motivo: imagens.length ? null : 'Não consegui capturar o conteúdo dos documentos.' };
}

// Captura CADA documento do processo como imagem (print do conteúdo) e monta
// o PDF do processo NÓS MESMOS — sem depender do "Gerar PDF" do SEI (que falha).
// Devolve [{numero, tipo, img(base64)}] na ordem da árvore.
async function capturarDocumentosVisual(page, limite = 40) {
  const arvore = await acharArvore(page);
  if (!arvore) return [];
  let anchors = [];
  try {
    anchors = await arvore.$$eval('a', (els) =>
      els.map((el, i) => ({ i, t: (el.textContent || '').trim() })).filter((x) => /\d{6,9}/.test(x.t))
    );
  } catch { return []; }
  // deduplica por número de documento (a árvore repete o mesmo doc)
  const vistos = new Set();
  const out = [];
  for (const a of anchors) {
    const m = a.t.match(/(\d{6,9})/);
    const numero = m ? m[1] : '';
    if (numero && vistos.has(numero)) continue;
    if (numero) vistos.add(numero);
    if (out.length >= limite) break;
    try {
      const link = arvore.locator('a').nth(a.i);
      if (!(await link.count())) continue;
      await link.click({ timeout: 10000 });
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(800);
      const img = await screenshotConteudo(page);
      if (img) out.push({ numero, tipo: a.t.replace(/\(?\b\d{6,9}\b\)?/, '').replace(/[()]/g, '').trim() || 'Documento', img });
    } catch { /* próximo */ }
  }
  return out;
}

// Monta um PDF (A4, um documento por página) a partir das imagens capturadas,
// usando o próprio Chromium do robô. Salva em `destino`. Retorna true/false.
async function montarPdfDocumentos(context, numeroSei, docsImg, destino) {
  if (!docsImg.length) return false;
  const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const paginas = docsImg.map((d, i) => `
    <section style="${i ? 'page-break-before:always;' : ''}padding:8px 0">
      <div style="font:600 12px Arial;color:#333;border-bottom:1px solid #ccc;padding-bottom:4px;margin-bottom:6px">
        ${esc(d.tipo)} ${esc(d.numero)} &nbsp;·&nbsp; ${esc(numeroSei)}</div>
      <img src="data:image/png;base64,${d.img}" style="width:100%;display:block" />
    </section>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:12mm}body{margin:0}</style></head><body>${paginas}</body></html>`;
  let pg = null;
  try {
    pg = await context.newPage();
    await pg.setContent(html, { waitUntil: 'load', timeout: 30000 });
    await pg.pdf({ path: destino, format: 'A4', printBackground: true });
    return true;
  } catch { return false; }
  finally { if (pg) await pg.close().catch(() => {}); }
}

// Abre o processo e captura a ficha (usado no botão avulso do servidor).
async function capturarFichaDoProcesso(page, baseUrl, numeroSei) {
  await abrirProcesso(page, baseUrl, numeroSei);
  return await capturarFichaImagens(page);
}

// API: abre o processo e devolve as imagens (PNG base64) da ficha para OCR.
export async function capturarFichaNoSei(cfg, dados, mock) {
  if (mock) {
    await new Promise((r) => setTimeout(r, 200));
    return { modo: 'simulacao', imagens: [], rotulos: [], motivo: 'Modo simulação: sem SEI real.' };
  }
  const browser = await abrirNavegador();
  let page = null;
  try {
    const auth = await autenticar(browser, cfg);
    page = auth.page;
    const r = await capturarFichaDoProcesso(page, auth.baseUrl, dados.numeroSei);
    return { modo: 'sei', ...r };
  } catch (e) {
    if (page && !e.debug) e.debug = await salvarDiagnostico(page, 'debug-ficha-erro');
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}

// dados = { processoId, numeroSei, dir }  (dir = pasta para salvar os PDFs)
export async function detalharProcessoNoSei(cfg, dados, mock) {
  if (mock) {
    await new Promise((r) => setTimeout(r, 300));
    return {
      modo: 'simulacao',
      interessado: 'João da Silva',
      tipo: 'Perícia Médica',
      especificacao: 'Solicitação de perícia para readaptação funcional',
      documentos: [
        { numero: '0012345', tipo: 'Requerimento', link_sei: '' },
        { numero: '0012346', tipo: 'Laudo Médico', link_sei: '' },
      ],
      pdfProcesso: null,
      amostra: null,
    };
  }

  const browser = await abrirNavegador();
  let page = null;
  try {
    const auth = await autenticar(browser, cfg);
    page = auth.page;
    return await detalharNaPagina(page, auth.baseUrl, dados);
  } catch (e) {
    if (page && !e.debug) e.debug = await salvarDiagnostico(page, 'debug-processo-erro');
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Detalha UM processo numa página já autenticada (reutilizável no lote).
async function detalharNaPagina(page, baseUrl, dados) {
  await abrirProcesso(page, baseUrl, dados.numeroSei);
  const documentos = await coletarDocumentos(page);
  const amostra = await coletarAmostra(page);
  const debug = await salvarDiagnostico(page, `debug-processo`);
  // Captura a ficha funcional (imagens) enquanto o processo está aberto —
  // para o OCR automático preencher o cadastro do servidor sem interação.
  let fichaImagens = [];
  if (dados.capturarFicha) {
    try { const cap = await capturarFichaImagens(page); fichaImagens = cap.imagens || []; } catch { /* ignora */ }
  }
  // PDF do processo: capturamos CADA documento como imagem e montamos o PDF
  // nós mesmos (confiável). Cada documento vira também um arquivo local, para
  // o link "Abrir" abrir o PDF/imagem — nunca o site do SEI.
  let pdfProcesso = null;
  if (dados.dir && dados.genPdf) {
    try {
      const docsImg = await capturarDocumentosVisual(page);
      for (const d of docsImg) {
        try {
          const fn = `doc-${d.numero || Math.random().toString(36).slice(2, 8)}.png`;
          fs.writeFileSync(join(dados.dir, fn), Buffer.from(d.img, 'base64'));
          d.arquivo = fn;
          const doc = documentos.find((x) => x.numero === d.numero);
          if (doc) doc.arquivo = fn; else documentos.push({ numero: d.numero, tipo: d.tipo, link_sei: '', arquivo: fn });
        } catch { /* ignora */ }
      }
      const nomePdf = `processo-${dados.processoId}.pdf`;
      if (await montarPdfDocumentos(page.context(), dados.numeroSei, docsImg, join(dados.dir, nomePdf))) pdfProcesso = nomePdf;
      // fallback: se não capturou nada por imagem, tenta o Gerar PDF nativo.
      if (!pdfProcesso) pdfProcesso = await gerarPdfProcesso(page, dados.dir, dados.processoId);
    } catch { /* ignora */ }
  }
  const meta = await coletarMetadados(page);
  const amostraMeta = meta._amostra; delete meta._amostra;
  return { modo: 'sei', ...meta, documentos, pdfProcesso, fichaImagens, amostra, amostraMeta, debug };
}

// Detalha VÁRIOS processos reaproveitando UMA sessão/navegador (bem mais
// rápido que logar a cada processo). onItem(idx, item, resultadoOuErro) é
// chamado a cada processo para persistência incremental.
export async function detalharVariosNoSei(cfg, itens, mock, onItem) {
  if (mock) {
    for (let i = 0; i < itens.length; i++) {
      const r = await detalharProcessoNoSei(cfg, itens[i], true);
      await onItem?.(i, itens[i], r, null);
    }
    return;
  }
  const browser = await abrirNavegador();
  let page = null;
  try {
    const auth = await autenticar(browser, cfg);
    page = auth.page;
    for (let i = 0; i < itens.length; i++) {
      try {
        const r = await detalharNaPagina(page, auth.baseUrl, itens[i]);
        await onItem?.(i, itens[i], r, null);
      } catch (e) {
        await onItem?.(i, itens[i], null, e);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
