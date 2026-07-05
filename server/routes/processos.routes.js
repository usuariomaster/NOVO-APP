import { Router } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import db, { registrarHistorico, ehSimulacao, getConfig, setConfig } from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';
import { descriptografar } from '../sei/crypto.js';
import { lancarDespachoNoSei } from '../sei/writer.js';
import { detalharProcessoNoSei } from '../sei/detail.js';
import { htmlDespacho } from '../services/htmlDespacho.js';
import { htmlParaPdfAssinado } from '../services/assinarPdf.js';

// Monta a configuração do robô a partir da linha do banco (ou simulação).
function montarCfg(cfgRow) {
  if (!cfgRow) return { base_url: process.env.SEI_BASE_URL || '', tipo_documento: 'Despacho', nivel_acesso: 'publico' };
  return {
    base_url: cfgRow.base_url,
    orgao: cfgRow.orgao,
    unidade: cfgRow.unidade,
    usuario: cfgRow.usuario,
    senha: descriptografar(cfgRow.senha_cripto),
    tipo_documento: cfgRow.tipo_documento,
    nivel_acesso: cfgRow.nivel_acesso,
    unidade_destino: cfgRow.unidade_destino,
    assinar: cfgRow.assinar !== 0,
    cargo: cfgRow.cargo,
  };
}

const router = Router();
router.use(exigirLogin);

const DIR_DADOS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const DIR_COMPROVANTES = join(DIR_DADOS, 'comprovantes');
const DIR_DOCS = join(DIR_DADOS, 'documentos');
const DIR_SERVIDORES = join(DIR_DADOS, 'servidores');

const SELECT_PROC = `
  SELECT p.*, u.nome AS perito_nome
  FROM processos p
  LEFT JOIN usuarios u ON u.id = p.perito_id
`;

// Lista de processos, filtrada conforme o papel.
router.get('/', (req, res) => {
  const { status, q } = req.query;
  const where = [];
  const params = [];

  // Perito só enxerga os processos atribuídos a ele.
  if (['perito', 'perito_admin'].includes(req.usuario.papel)) {
    where.push('p.perito_id = ?');
    params.push(req.usuario.id);
  }
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(p.numero_sei LIKE ? OR p.interessado LIKE ? OR p.especificacao LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const sql = SELECT_PROC + (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY p.atualizado_em DESC';
  res.json(db.prepare(sql).all(...params));
});

// Resumo por status (para o painel).
router.get('/resumo', (req, res) => {
  let sql = 'SELECT status, COUNT(*) AS total FROM processos';
  const params = [];
  if (['perito', 'perito_admin'].includes(req.usuario.papel)) {
    sql += ' WHERE perito_id = ?';
    params.push(req.usuario.id);
  }
  sql += ' GROUP BY status';
  const linhas = db.prepare(sql).all(...params);
  const resumo = {};
  for (const l of linhas) resumo[l.status] = l.total;
  res.json(resumo);
});

// Configuração de prazos (dias para o farol verde/amarelo/vermelho).
router.get('/config-prazos', (req, res) => {
  res.json({
    prazo_dias: Number(getConfig('prazo_dias', '10')),
    atraso_dias: Number(getConfig('atraso_dias', '5')),
  });
});
router.post('/config-prazos', exigirPapel('admin'), (req, res) => {
  const { prazo_dias, atraso_dias } = req.body || {};
  if (prazo_dias != null) setConfig('prazo_dias', Math.max(0, parseInt(prazo_dias, 10) || 0));
  if (atraso_dias != null) setConfig('atraso_dias', Math.max(0, parseInt(atraso_dias, 10) || 0));
  res.json({
    prazo_dias: Number(getConfig('prazo_dias', '10')),
    atraso_dias: Number(getConfig('atraso_dias', '5')),
  });
});

// Detalhe de um processo (com documentos, despacho e histórico).
router.get('/:id', (req, res) => {
  const proc = db.prepare(SELECT_PROC + ' WHERE p.id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (['perito','perito_admin'].includes(req.usuario.papel) && proc.perito_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  proc.documentos = db.prepare('SELECT * FROM documentos WHERE processo_id = ?').all(proc.id);
  proc.despacho = db
    .prepare('SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1')
    .get(proc.id);
  proc.historico = db
    .prepare('SELECT * FROM historico WHERE processo_id = ? ORDER BY id DESC')
    .all(proc.id);
  res.json(proc);
});

// Atualiza prioridade / prazo (operador ou admin).
router.put('/:id', exigirPapel('operador', 'admin'), (req, res) => {
  const { prioridade, prazo, tipo, interessado, especificacao } = req.body || {};
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });

  db.prepare(
    `UPDATE processos SET
       prioridade = COALESCE(?, prioridade),
       prazo = COALESCE(?, prazo),
       tipo = COALESCE(?, tipo),
       interessado = COALESCE(?, interessado),
       especificacao = COALESCE(?, especificacao),
       atualizado_em = datetime('now')
     WHERE id = ?`
  ).run(prioridade ?? null, prazo ?? null, tipo ?? null, interessado ?? null, especificacao ?? null, req.params.id);
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'editado', detalhe: 'Dados/prioridade atualizados' });
  res.json({ ok: true });
});

// Cria um processo FÍSICO (não-SEI) manualmente (operador ou admin).
router.post('/fisico', exigirPapel('operador', 'admin'), (req, res) => {
  const { numero_sei, interessado, especificacao, tipo, secretaria_destino, prioridade, prazo } = req.body || {};
  if (!interessado && !especificacao && !numero_sei) {
    return res.status(400).json({ erro: 'Informe ao menos o interessado/servidor ou o assunto' });
  }
  // Gera um número interno se não informado.
  let numero = (numero_sei || '').trim();
  if (!numero) {
    const ano = new Date().toISOString().slice(0, 4);
    const n = db.prepare(`SELECT COUNT(*) AS c FROM processos WHERE fisico = 1`).get().c + 1;
    numero = `FIS-${ano}-${String(n).padStart(4, '0')}`;
  }
  if (db.prepare('SELECT id FROM processos WHERE numero_sei = ?').get(numero)) {
    return res.status(409).json({ erro: 'Já existe um processo com esse número' });
  }
  const info = db.prepare(
    `INSERT INTO processos (numero_sei, tipo, interessado, especificacao, unidade_origem, secretaria_destino,
       prioridade, prazo, fisico, status, operador_id)
     VALUES (?, ?, ?, ?, 'Perícia (físico)', ?, ?, ?, 1, 'em_controle', ?)`
  ).run(
    numero, tipo || null, interessado || null, especificacao || null, secretaria_destino || null,
    prioridade || 'normal', prazo || null, req.usuario.id
  );
  registrarHistorico({ processoId: info.lastInsertRowid, usuario: req.usuario, acao: 'incluido_fisico', detalhe: 'Processo físico incluído manualmente' });
  res.status(201).json({ id: info.lastInsertRowid, numero_sei: numero });
});

// Página imprimível do despacho (abre no navegador para imprimir/anexar).
router.get('/:id/despacho-impressao', (req, res) => {
  const proc = db.prepare(SELECT_PROC + ' WHERE p.id = ?').get(req.params.id);
  if (!proc) return res.status(404).send('Processo não encontrado');
  const d = db.prepare('SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1').get(proc.id);
  res.set('Content-Type', 'text/html; charset=utf-8').send(htmlDespacho(proc, d));
});

// Assina o despacho digitalmente (ICP-Brasil A1) com o certificado do perito.
router.post('/:id/assinar-pdf', exigirPapel('perito', 'operador', 'admin'), async (req, res) => {
  const proc = db.prepare(SELECT_PROC + ' WHERE p.id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (['perito', 'perito_admin'].includes(req.usuario.papel) && proc.perito_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Este processo não está com você' });
  }
  const d = db.prepare('SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1').get(proc.id);
  if (!d || !d.texto?.trim()) return res.status(400).json({ erro: 'Salve o texto do despacho antes de assinar' });

  // Certificado do perito responsável.
  const perito = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(proc.perito_id);
  if (!perito?.cert_arquivo || !perito?.cert_senha) {
    return res.status(400).json({ erro: 'O perito não tem certificado A1 cadastrado (Usuários → Ficha → Certificado).' });
  }
  const certPath = join(DIR_SERVIDORES, String(perito.id), String(perito.cert_arquivo).replace(/[^a-zA-Z0-9._-]/g, ''));
  if (!existsSync(certPath)) return res.status(400).json({ erro: 'Arquivo do certificado não encontrado' });

  try {
    const html = htmlDespacho(proc, d, { assinado: true });
    const certBuf = readFileSync(certPath);
    const senha = descriptografar(perito.cert_senha);
    const assinado = await htmlParaPdfAssinado(html, certBuf, senha, {
      nome: perito.nome, motivo: `Despacho — processo ${proc.numero_sei}`,
    });
    const dir = join(DIR_DOCS, `proc-${proc.id}`);
    mkdirSync(dir, { recursive: true });
    const nome = `despacho-assinado.pdf`;
    writeFileSync(join(dir, nome), assinado);
    db.prepare(`UPDATE processos SET pdf_assinado = ? WHERE id = ?`).run(nome, proc.id);
    registrarHistorico({
      processoId: proc.id, usuario: req.usuario, acao: 'despacho_assinado',
      detalhe: `Despacho assinado digitalmente (ICP-Brasil A1) por ${perito.nome}`,
    });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: `Falha ao assinar: ${e.message}` });
  }
});

// Serve o PDF do despacho assinado.
router.get('/:id/despacho-assinado', (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (['perito', 'perito_admin'].includes(req.usuario.papel) && proc.perito_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  if (!proc.pdf_assinado) return res.status(404).json({ erro: 'Despacho ainda não assinado' });
  const nome = String(proc.pdf_assinado).replace(/[^a-zA-Z0-9._-]/g, '');
  const caminho = join(DIR_DOCS, `proc-${proc.id}`, nome);
  if (!existsSync(caminho)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
  res.sendFile(caminho);
});

// Exclui um processo (operador ou admin). Remove documentos, despachos e histórico.
router.delete('/:id', exigirPapel('operador', 'admin'), (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  db.prepare('DELETE FROM processos WHERE id = ?').run(proc.id);
  res.json({ ok: true });
});

// Distribui o processo para um perito (operador ou admin).
router.post('/:id/distribuir', exigirPapel('operador', 'admin'), (req, res) => {
  const { perito_id } = req.body || {};
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });

  const perito = db.prepare(`SELECT * FROM usuarios WHERE id = ? AND papel LIKE 'perito%' AND ativo = 1`).get(perito_id);
  if (!perito) return res.status(400).json({ erro: 'Perito inválido' });
  if (!['em_controle', 'distribuido', 'devolvido'].includes(proc.status)) {
    return res.status(409).json({ erro: `Não é possível distribuir um processo com status "${proc.status}"` });
  }

  db.prepare(
    `UPDATE processos SET perito_id = ?, operador_id = ?, status = 'distribuido',
       distribuido_em = datetime('now'), atualizado_em = datetime('now') WHERE id = ?`
  ).run(perito_id, req.usuario.id, req.params.id);
  registrarHistorico({
    processoId: proc.id,
    usuario: req.usuario,
    acao: 'distribuido',
    detalhe: `Distribuído para ${perito.nome}`,
  });
  res.json({ ok: true });
});

// Busca o conteúdo do processo no SEI (documentos, interessado, tipo,
// especificação) abrindo o processo e lendo a tela.
router.post('/:id/detalhar-sei', exigirPapel('operador', 'admin'), async (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });

  const cfgRow = db.prepare('SELECT * FROM sei_config ORDER BY padrao DESC, id LIMIT 1').get();
  const mock = ehSimulacao();
  if (!cfgRow && !mock) return res.status(400).json({ erro: 'Cadastre a configuração do SEI primeiro.' });

  // Pasta própria do processo para arquivar os PDFs.
  const dirProc = join(DIR_DOCS, `proc-${proc.id}`);
  try { mkdirSync(dirProc, { recursive: true }); } catch { /* ignora */ }

  let r;
  try {
    r = await detalharProcessoNoSei(montarCfg(cfgRow), { processoId: proc.id, numeroSei: proc.numero_sei, dir: dirProc }, mock);
  } catch (e) {
    return res.status(502).json({ erro: e.message, debug: e.debug || null });
  }

  // Atualiza os dados do processo (só sobrescreve o que veio preenchido).
  db.prepare(
    `UPDATE processos SET
       tipo = COALESCE(?, tipo),
       interessado = COALESCE(?, interessado),
       especificacao = COALESCE(?, especificacao),
       pdf_processo = COALESCE(?, pdf_processo),
       conteudo_em = datetime('now'),
       atualizado_em = datetime('now')
     WHERE id = ?`
  ).run(r.tipo || null, r.interessado || null, r.especificacao || null, r.pdfProcesso || null, proc.id);

  // Substitui a lista de documentos (com conteúdo/arquivo).
  let comPdf = 0;
  let comTexto = 0;
  if (Array.isArray(r.documentos) && r.documentos.length) {
    db.prepare('DELETE FROM documentos WHERE processo_id = ?').run(proc.id);
    const ins = db.prepare(
      'INSERT INTO documentos (processo_id, numero, tipo, data, link_sei, conteudo, arquivo) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const tx = db.transaction((lista) => {
      for (const d of lista) {
        ins.run(proc.id, d.numero ?? null, d.tipo ?? null, d.data ?? null, d.link_sei ?? null, d.conteudo ?? null, d.arquivo ?? null);
        if (d.arquivo) comPdf++;
        if (d.conteudo) comTexto++;
      }
    });
    tx(r.documentos);
  }

  // Salva amostras em arquivo para calibração remota.
  try {
    if (r.amostra) writeFileSync(join(DIR_COMPROVANTES, 'debug-processo.txt'), r.amostra, 'utf8');
    if (r.amostraDoc) writeFileSync(join(DIR_COMPROVANTES, 'debug-documento.txt'), r.amostraDoc, 'utf8');
    if (r.amostraMeta) writeFileSync(join(DIR_COMPROVANTES, 'debug-metadados.txt'), r.amostraMeta, 'utf8');
  } catch { /* ignora */ }

  // Mantém apenas UMA ocorrência de "conteúdo buscado" no histórico
  // (evita entupir com um registro a cada clique).
  db.prepare(`DELETE FROM historico WHERE processo_id = ? AND acao = 'detalhado_sei'`).run(proc.id);
  registrarHistorico({
    processoId: proc.id,
    usuario: req.usuario,
    acao: 'detalhado_sei',
    detalhe: `Conteúdo atualizado do SEI${r.pdfProcesso ? ' (com PDF do processo)' : ''}`,
  });

  res.json({
    ok: true,
    modo: r.modo,
    documentos: Array.isArray(r.documentos) ? r.documentos.length : 0,
    pdfProcesso: r.pdfProcesso || null,
    comPdf,
    comTexto,
    interessado: r.interessado || null,
    tipo: r.tipo || null,
    especificacao: r.especificacao || null,
    amostra: r.amostra || null,
    amostraDoc: r.amostraDoc || null,
    amostraMeta: r.amostraMeta || null,
    debug: r.debug || null,
  });
});

// Baixa/serve o PDF do processo inteiro (para consulta/impressão/prontuário).
router.get('/:id/pdf', (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (['perito','perito_admin'].includes(req.usuario.papel) && proc.perito_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  if (!proc.pdf_processo) return res.status(404).json({ erro: 'PDF do processo ainda não gerado' });
  const nome = String(proc.pdf_processo).replace(/[^a-zA-Z0-9._-]/g, '');
  const caminho = join(DIR_DOCS, `proc-${proc.id}`, nome);
  if (!existsSync(caminho)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
  res.sendFile(caminho);
});

// Baixa/serve o PDF arquivado de um documento.
router.get('/:id/documento/:docId/arquivo', (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (['perito','perito_admin'].includes(req.usuario.papel) && proc.perito_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  const doc = db.prepare('SELECT * FROM documentos WHERE id = ? AND processo_id = ?').get(req.params.docId, proc.id);
  if (!doc?.arquivo) return res.status(404).json({ erro: 'Documento sem PDF arquivado' });
  const nome = String(doc.arquivo).replace(/[^a-zA-Z0-9._-]/g, '');
  const caminho = join(DIR_DOCS, `proc-${proc.id}`, nome);
  if (!existsSync(caminho)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
  res.sendFile(caminho);
});

// Envia a resposta de volta ao SEI (operador ou admin).
// O robô de escrita lança o despacho automaticamente na tela do SEI.
router.post('/:id/enviar-sei', exigirPapel('operador', 'admin'), async (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (proc.status !== 'conferido') {
    return res.status(409).json({ erro: 'O despacho precisa estar conferido/aprovado antes de enviar ao SEI' });
  }
  const despacho = db.prepare('SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1').get(proc.id);
  if (!despacho?.texto) return res.status(400).json({ erro: 'Não há despacho aprovado para lançar no SEI' });

  const cfgRow = db.prepare('SELECT * FROM sei_config ORDER BY padrao DESC, id LIMIT 1').get();
  const mock = ehSimulacao();
  if (!cfgRow && !mock) {
    return res.status(400).json({ erro: 'Cadastre a configuração do SEI antes de lançar o despacho.' });
  }
  if (cfgRow && cfgRow.escrita === 0 && !mock) {
    return res.status(409).json({ erro: 'A escrita automática está desativada nesta configuração do SEI.' });
  }

  const cfg = cfgRow
    ? {
        base_url: cfgRow.base_url,
        orgao: cfgRow.orgao,
        usuario: cfgRow.usuario,
        senha: descriptografar(cfgRow.senha_cripto),
        tipo_documento: cfgRow.tipo_documento,
        nivel_acesso: cfgRow.nivel_acesso,
        unidade_destino: cfgRow.unidade_destino,
      }
    : { base_url: process.env.SEI_BASE_URL || '', tipo_documento: 'Despacho', nivel_acesso: 'publico' };

  let resultado;
  try {
    resultado = await lancarDespachoNoSei(cfg, {
      processoId: proc.id,
      numeroSei: proc.numero_sei,
      texto: despacho.texto,
      conclusao: despacho.conclusao,
    }, mock);
  } catch (e) {
    registrarHistorico({
      processoId: proc.id,
      usuario: req.usuario,
      acao: 'erro_envio_sei',
      detalhe: e.message + (e.passos?.length ? ` (passos: ${e.passos.join(' → ')})` : ''),
    });
    return res.status(502).json({ erro: e.message, comprovante: e.comprovante || null });
  }

  db.prepare(`UPDATE despachos SET comprovante = ? WHERE id = ?`).run(resultado.comprovante || null, despacho.id);
  db.prepare(`UPDATE processos SET status = 'enviado_sei', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  registrarHistorico({
    processoId: proc.id,
    usuario: req.usuario,
    acao: 'enviado_sei',
    detalhe: `Despacho lançado no SEI (${resultado.modo}) — ${resultado.passos.join(' → ')}`,
  });
  res.json({ ok: true, modo: resultado.modo, comprovante: resultado.comprovante });
});

// Serve o comprovante (print) do lançamento — apenas logados.
router.get('/:id/comprovante', (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (['perito','perito_admin'].includes(req.usuario.papel) && proc.perito_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  const despacho = db.prepare('SELECT comprovante FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1').get(proc.id);
  if (!despacho?.comprovante) return res.status(404).json({ erro: 'Sem comprovante' });
  // Impede path traversal: só o nome do arquivo é usado.
  const nome = String(despacho.comprovante).replace(/[^a-zA-Z0-9._-]/g, '');
  res.sendFile(join(DIR_COMPROVANTES, nome));
});

// Conclui o processo (arquiva no controle).
router.post('/:id/concluir', exigirPapel('operador', 'admin'), (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  db.prepare(`UPDATE processos SET status = 'concluido', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'concluido', detalhe: 'Processo concluído' });
  res.json({ ok: true });
});

export default router;
