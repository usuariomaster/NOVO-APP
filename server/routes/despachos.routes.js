import { Router } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import db, { registrarHistorico } from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';
import { lancarNoSei } from '../services/lancarSei.js';

const router = Router();
router.use(exigirLogin);

const DIR_DESPACHOS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'despachos');

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
  if (!despacho || (!despacho.texto?.trim() && !despacho.arquivo)) {
    return res.status(400).json({ erro: 'Escreva ou anexe o despacho antes de enviar' });
  }

  db.prepare(`UPDATE despachos SET status = 'enviado', atualizado_em = datetime('now') WHERE id = ?`).run(despacho.id);
  db.prepare(`UPDATE processos SET status = 'despachado', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'despachado', detalhe: 'Despacho enviado para conferência' });
  res.json({ ok: true });
});

// Perito anexa um despacho feito FORA do sistema (PDF/imagem, ex.: assinado à mão).
// Corpo: { nome_orig, dados_base64, conclusao }
router.post('/processo/:id/upload', exigirPapel('perito'), (req, res) => {
  const { nome_orig, dados_base64, conclusao } = req.body || {};
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (proc.perito_id !== req.usuario.id) return res.status(403).json({ erro: 'Este processo não está com você' });
  if (!['distribuido', 'em_pericia', 'devolvido'].includes(proc.status)) {
    return res.status(409).json({ erro: `Não é possível anexar despacho com status "${proc.status}"` });
  }
  if (!dados_base64) return res.status(400).json({ erro: 'Escolha o arquivo do despacho' });

  const dir = join(DIR_DESPACHOS, `proc-${proc.id}`);
  mkdirSync(dir, { recursive: true });
  const base = String(dados_base64).includes(',') ? String(dados_base64).split(',')[1] : String(dados_base64);
  const buf = Buffer.from(base, 'base64');
  if (buf.length > 30 * 1024 * 1024) return res.status(413).json({ erro: 'Arquivo muito grande (máx. 30MB)' });
  const ext = (nome_orig && nome_orig.includes('.')) ? nome_orig.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 5) : 'pdf';
  const arquivo = `despacho-${Date.now()}.${ext}`;
  writeFileSync(join(dir, arquivo), buf);

  const existente = db.prepare(`SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1`).get(proc.id);
  if (existente && ['rascunho', 'devolvido'].includes(existente.status)) {
    db.prepare(`UPDATE despachos SET arquivo = ?, conclusao = COALESCE(?, conclusao), status = 'rascunho', atualizado_em = datetime('now') WHERE id = ?`)
      .run(arquivo, conclusao ?? null, existente.id);
  } else {
    db.prepare(`INSERT INTO despachos (processo_id, perito_id, texto, conclusao, arquivo, status) VALUES (?, ?, ?, ?, ?, 'rascunho')`)
      .run(proc.id, req.usuario.id, 'Despacho anexado (feito fora do sistema).', conclusao ?? null, arquivo);
  }
  if (proc.status === 'distribuido') {
    db.prepare(`UPDATE processos SET status = 'em_pericia', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  }
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'despacho_anexado', detalhe: 'Despacho externo anexado' });
  res.json({ ok: true });
});

// Serve o arquivo de despacho anexado.
router.get('/processo/:id/arquivo', (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (['perito', 'perito_admin'].includes(req.usuario.papel) && proc.perito_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  const despacho = db.prepare(`SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1`).get(proc.id);
  if (!despacho?.arquivo) return res.status(404).json({ erro: 'Sem arquivo de despacho' });
  const nome = String(despacho.arquivo).replace(/[^a-zA-Z0-9._-]/g, '');
  const caminho = join(DIR_DESPACHOS, `proc-${proc.id}`, nome);
  if (!existsSync(caminho)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
  res.sendFile(caminho);
});

// Perito Administrador / Master: tramita o despacho DIRETO ao SEI (sem conferência).
router.post('/processo/:id/tramitar-sei', exigirPapel('perito_admin', 'admin', 'admin_master'), async (req, res) => {
  const proc = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.id);
  if (!proc) return res.status(404).json({ erro: 'Processo não encontrado' });
  if (req.usuario.papel === 'perito_admin' && proc.perito_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Este processo não está com você' });
  }
  const despacho = db.prepare(`SELECT * FROM despachos WHERE processo_id = ? ORDER BY id DESC LIMIT 1`).get(proc.id);
  if (!despacho || !despacho.texto?.trim()) {
    return res.status(400).json({ erro: 'Salve o texto do despacho antes de tramitar ao SEI (anexo em PDF ainda não é lançado automaticamente).' });
  }

  let r;
  try {
    r = await lancarNoSei(proc, despacho);
  } catch (e) {
    registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'erro_envio_sei', detalhe: e.message });
    return res.status(502).json({ erro: e.message, comprovante: e.comprovante || null });
  }
  db.prepare(`UPDATE despachos SET status = 'aprovado', comprovante = ?, atualizado_em = datetime('now') WHERE id = ?`).run(r.comprovante || null, despacho.id);
  db.prepare(`UPDATE processos SET status = 'enviado_sei', atualizado_em = datetime('now') WHERE id = ?`).run(proc.id);
  registrarHistorico({ processoId: proc.id, usuario: req.usuario, acao: 'enviado_sei', detalhe: `Tramitado direto ao SEI pelo perito (${r.modo})` });
  res.json({ ok: true, modo: r.modo, comprovante: r.comprovante });
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
