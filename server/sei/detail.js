// ============================================================
// Robô de DETALHAMENTO — abre um processo no SEI e lê o conteúdo
// (interessado, tipo, especificação e a lista de documentos).
//
// Abrimos o processo pela "pesquisa rápida" do SEI (que funciona
// numa sessão nova) e lemos a árvore de documentos + os dados.
// Como cada SEI mostra os detalhes de forma um pouco diferente,
// também coletamos uma AMOSTRA de texto para calibração.
// ============================================================
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

// Localiza o quadro (frame) da árvore de documentos do processo.
function acharArvore(page) {
  for (const frame of page.frames()) {
    if (/arvore/i.test(frame.name() + ' ' + frame.url())) return frame;
  }
  return null;
}

// Coleta os documentos a partir da árvore do processo, filtrando o lixo
// (nomes de setores, "Fechar", "Link para Acesso Direto", número do processo).
async function coletarDocumentos(page) {
  const arvore = acharArvore(page);
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
  const arvore = acharArvore(page);
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

// Tenta ler interessado/tipo/especificação a partir do texto das telas.
async function coletarMetadados(page) {
  let texto = '';
  for (const frame of page.frames()) {
    try {
      texto += '\n' + (await frame.evaluate(() => document.body ? document.body.innerText : ''));
    } catch { /* ignora */ }
  }
  const pegar = (re) => {
    const m = texto.match(re);
    return m ? m[1].trim().split('\n')[0].slice(0, 300) : null;
  };
  return {
    interessado: pegar(/Interessad[oa]s?:?\s*(.+)/i),
    tipo: pegar(/Tipo(?:\s+do\s+Processo)?:?\s*(.+)/i),
    especificacao: pegar(/Especifica[çc][ãa]o:?\s*(.+)/i),
  };
}

// Amostra de texto/campos de todos os quadros, para calibração.
async function coletarAmostra(page) {
  const partes = [];
  for (const frame of page.frames()) {
    try {
      const info = await frame.evaluate(() => {
        const txt = (document.body ? document.body.innerText : '').trim().slice(0, 1500);
        const links = Array.from(document.querySelectorAll('a'))
          .map((a) => (a.textContent || '').trim())
          .filter(Boolean)
          .slice(0, 40);
        return { txt, links };
      });
      if (info.txt || info.links.length) {
        partes.push(
          `--- quadro: ${frame.url().slice(0, 80)} ---\nTEXTO:\n${info.txt}\nLINKS:\n${info.links.join(' | ')}`
        );
      }
    } catch { /* ignora */ }
  }
  return partes.join('\n\n').slice(0, 8000);
}

// dados = { processoId, numeroSei }
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
      amostra: null,
    };
  }

  const browser = await abrirNavegador();
  let page = null;
  try {
    const auth = await autenticar(browser, cfg);
    page = auth.page;
    await abrirProcesso(page, auth.baseUrl, dados.numeroSei);

    const documentos = await coletarDocumentos(page);
    const meta = await coletarMetadados(page);
    const amostra = await coletarAmostra(page);
    const debug = await salvarDiagnostico(page, `debug-processo`);
    // Abre um documento e captura como o SEI mostra o conteúdo (calibração).
    const amostraDoc = await amostraDocumento(page);
    return { modo: 'sei', ...meta, documentos, amostra, amostraDoc, debug };
  } catch (e) {
    if (page && !e.debug) e.debug = await salvarDiagnostico(page, 'debug-processo-erro');
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}
