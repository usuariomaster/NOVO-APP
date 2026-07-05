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
// ("Gerar Arquivo PDF do Processo") e salva o arquivo. Retorna o nome
// do arquivo salvo, ou null se não conseguiu.
async function gerarPdfProcesso(page, dir, processoId) {
  // 1) Procura e clica em "Gerar Arquivo PDF do Processo" (na barra do processo).
  let abriu = false;
  for (const f of page.frames()) {
    try {
      const link = f
        .locator('a[href*="procedimento_gerar_pdf"], img[title*="Gerar Arquivo PDF do Processo"], a:has-text("Gerar Arquivo PDF")')
        .first();
      if (await link.count()) {
        await link.click({ timeout: 10000 });
        abriu = true;
        break;
      }
    } catch { /* tenta o próximo quadro */ }
  }
  if (!abriu) return null;
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // 2) Na tela de geração, clica "Gerar" e captura o download do PDF.
  let download = null;
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }).catch(() => null),
      (async () => {
        for (const f of page.frames()) {
          const b = f
            .locator('#sbmGerar, input[type="button"][value*="Gerar"], input[type="submit"][value*="Gerar"], button:has-text("Gerar"), a:has-text("Gerar")')
            .first();
          if (await b.count()) { await b.click({ timeout: 10000 }).catch(() => {}); break; }
        }
      })(),
    ]);
    download = dl;
  } catch { /* ignora */ }

  if (download) {
    const nome = `processo-${processoId}.pdf`;
    try {
      await download.saveAs(join(dir, nome));
      return nome;
    } catch { /* ignora */ }
  }
  return null;
}

// Abre a "autuação" do processo (Consultar/Alterar Processo) e lê
// Tipo, Especificação e Interessados. Também devolve uma amostra da tela
// para calibração remota.
async function coletarMetadados(page) {
  // 1) Tenta abrir a tela de dados do processo.
  try {
    for (const f of page.frames()) {
      const link = f
        .locator('a[href*="procedimento_alterar"], a[href*="procedimento_consultar"], img[title*="Consultar/Alterar Processo"], img[title*="Consultar Processo"]')
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
  let pdfProcesso = null;
  if (dados.dir && dados.genPdf) {
    pdfProcesso = await gerarPdfProcesso(page, dados.dir, dados.processoId);
  }
  const meta = await coletarMetadados(page);
  const amostraMeta = meta._amostra; delete meta._amostra;
  return { modo: 'sei', ...meta, documentos, pdfProcesso, amostra, amostraMeta, debug };
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
