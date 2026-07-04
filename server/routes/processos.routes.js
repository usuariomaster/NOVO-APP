import { Router } from 'express';
import db, { registrarHistorico } from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';

const router = Router();
router.use(exigirLogin);

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
  if (req.usuario.papel === 'perito') {
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
  if (req.usuario.papel === 'perito') {
    sql += ' WHERE perito_id = ?';
    params.push(req.usuario.id);
  }
  sql += ' GROUP BY status';
  const linhas = db.prepare(sql).all(...params);
  const resumo = {};
  for (const l of linhas) resumo[l.status] = l.total;
  res.json(resumo);
});

// Detalhe de um processo (com documentos, despacho e histórico).
router.get('/:id', (req, res) => {
  const proc = db.prepare(SELECT_PROC + ' WHERE p.id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (req.usuario.papel === 'perito' && proc.perito_id !== req.usuario.id) {
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

// Distribui o processo para um perito (operador ou admin).
router.post('/:id/distribuir', exigirPapel('operador', 'admin'), (req, res) => {
  const { perito_id } = req.body || {};
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });

  const perito = db.prepare(`SELECT * FROM usuarios WHERE id = ? AND papel = 'perito' AND ativo = 1`).get(perito_id);
  if (!perito) return res.status(400).json({ erro: 'Perito inválido' });
  if (!['em_controle', 'distribuido', 'devolvido'].includes(proc.status)) {
    return res.status(409).json({ erro: `Não é possível distribuir um processo com status "${proc.status}"` });
  }

  db.prepare(
    `UPDATE processos SET perito_id = ?, operador_id = ?, status = 'distribuido', atualizado_em = datetime('now') WHERE id = ?`
  ).run(perito_id, req.usuario.id, req.params.id);
  registrarHistorico({
    processoId: proc.id,
    usuario: req.usuario,
    acao: 'distribuido',
    detalhe: `Distribuído para ${perito.nome}`,
  });
  res.json({ ok: true });
});

// Envia a resposta de volta ao SEI (operador ou admin).
router.post('/:id/enviar-sei', exigirPapel('operador', 'admin'), (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (proc.status !== 'conferido') {
    return res.status(409).json({ erro: 'O despacho precisa estar conferido/aprovado antes de enviar ao SEI' });
  }
  // Observação: o lançamento efetivo do despacho no SEI é feito pelo
  // operador na tela do SEI (o robô oficial de escrita depende de
  // integração liberada pelo órgão). Aqui registramos o envio.
  db.prepare(`UPDATE processos SET status = 'enviado_sei', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'enviado_sei', detalhe: 'Resposta devolvida ao SEI' });
  res.json({ ok: true });
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
