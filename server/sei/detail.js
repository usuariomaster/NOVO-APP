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

// Coleta os documentos a partir da árvore do processo (quadro "árvore").
async function coletarDocumentos(page, numeroSei) {
  const docs = [];
  const vistos = new Set();
  for (const frame of page.frames()) {
    const ehArvore = /arvore/i.test(frame.name() + ' ' + frame.url());
    if (!ehArvore) continue;
    let itens = [];
    try {
      itens = await frame.$$eval('a', (els) =>
        els
          .map((el) => ({ t: (el.textContent || '').trim(), h: el.getAttribute('href') || '' }))
          .filter((x) => x.t)
      );
    } catch { /* ignora */ }
    for (const it of itens) {
      // Ignora o próprio processo e itens vazios/repetidos.
      if (!it.t || it.t === numeroSei || vistos.has(it.t)) continue;
      // Descarta rótulos genéricos da árvore.
      if (/^(consultar|gerar|incluir|processo)/i.test(it.t)) continue;
      vistos.add(it.t);
      docs.push({ numero: null, tipo: it.t, link_sei: it.h });
    }
  }
  return docs.slice(0, 200);
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

    const documentos = await coletarDocumentos(page, dados.numeroSei);
    const meta = await coletarMetadados(page);
    const amostra = await coletarAmostra(page);
    const debug = await salvarDiagnostico(page, `debug-processo`);
    return { modo: 'sei', ...meta, documentos, amostra, debug };
  } catch (e) {
    if (page && !e.debug) e.debug = await salvarDiagnostico(page, 'debug-processo-erro');
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}
