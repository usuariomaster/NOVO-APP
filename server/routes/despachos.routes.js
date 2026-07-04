import { Router } from 'express';
import db, { registrarHistorico } from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';

const router = Router();
router.use(exigirLogin);

// Perito salva/atualiza o rascunho do despacho.
router.post('/processo/:id', exigirPapel('perito'), (req, res) => {
  const { texto, conclusao } = req.body || {};
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (proc.perito_id !== req.usuario.id) return res.status(403).json({ erro: 'Este processo não está com você' });
  if (!['distribuido', 'em_pericia', 'devolvido'].includes(proc.status)) {
    return res.status(409).json({ erro: `Não é possível despachar um processo com status "${proc.status}"` });
  }
  if (!texto || !texto.trim()) return res.status(400).json({ erro: 'Escreva o texto do despacho' });

  const existente = db.prepare(`SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1`).get(proc.id);
  // Reaproveita o rascunho/devolvido; senão cria um novo.
  if (existente && ['rascunho', 'devolvido'].includes(existente.status)) {
    db.prepare(
      `UPDATE despachos SET texto = ?, conclusao = ?, status = 'rascunho', atualizado_em = datetime('now') WHERE id = ?`
    ).run(texto.trim(), conclusao ?? null, existente.id);
  } else {
    db.prepare(
      `INSERT INTO despachos (processo_id, perito_id, texto, conclusao, status) VALUES (?, ?, ?, ?, 'rascunho')`
    ).run(proc.id, req.usuario.id, texto.trim(), conclusao ?? null);
  }

  if (proc.status === 'distribuido') {
    db.prepare(`UPDATE processos SET status = 'em_pericia', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  }
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'despacho_rascunho', detalhe: 'Rascunho de despacho salvo' });
  res.json({ ok: true });
});

// Perito finaliza e envia o despacho para conferência do operador.
router.post('/processo/:id/enviar', exigirPapel('perito'), (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (proc.perito_id !== req.usuario.id) return res.status(403).json({ erro: 'Este processo não está com você' });

  const despacho = db.prepare(`SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1`).get(proc.id);
  if (!despacho || !despacho.texto?.trim()) return res.status(400).json({ erro: 'Salve o despacho antes de enviar' });

  db.prepare(`UPDATE despachos SET status = 'enviado', atualizado_em = datetime('now') WHERE id = ?`).run(despacho.id);
  db.prepare(`UPDATE processos SET status = 'despachado', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'despachado', detalhe: 'Despacho enviado para conferência' });
  res.json({ ok: true });
});

// Operador aprova o despacho (fica pronto para envio ao SEI).
router.post('/processo/:id/aprovar', exigirPapel('operador', 'admin'), (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (proc.status !== 'despachado') return res.status(409).json({ erro: 'Só é possível conferir um processo despachado' });

  const despacho = db.prepare(`SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1`).get(proc.id);
  if (despacho) db.prepare(`UPDATE despachos SET status = 'aprovado', atualizado_em = datetime('now') WHERE id = ?`).run(despacho.id);
  db.prepare(`UPDATE processos SET status = 'conferido', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'conferido', detalhe: 'Despacho conferido e aprovado' });
  res.json({ ok: true });
});

// Operador devolve o despacho ao perito para ajustes.
router.post('/processo/:id/devolver', exigirPapel('operador', 'admin'), (req, res) => {
  const { motivo } = req.body || {};
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (proc.status !== 'despachado') return res.status(409).json({ erro: 'Só é possível devolver um processo despachado' });

  const despacho = db.prepare(`SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1`).get(proc.id);
  if (despacho) {
    db.prepare(
      `UPDATE despachos SET status = 'devolvido', motivo_devolucao = ?, atualizado_em = datetime('now') WHERE id = ?`
    ).run(motivo ?? null, despacho.id);
  }
  db.prepare(`UPDATE processos SET status = 'devolvido', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  registrarHistorico({
    processoId: proc.id,
    usuario: req.usuario,
    acao: 'devolvido',
    detalhe: motivo ? `Devolvido ao perito: ${motivo}` : 'Devolvido ao perito',
  });
  res.json({ ok: true });
});

export default router;
