// Junta Médica: avaliação colegiada + laudo RAI (Relatório de Avaliação de
// Incapacidade). Reúne o dossiê do servidor (afastamentos, processos) e a
// composição de peritos.
import { Router } from 'express';
import db from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';
import { htmlRAI } from '../services/documentosPericia.js';

const router = Router();
router.use(exigirLogin);

const CAMPOS = ['servidor_id', 'processo_id', 'tipo', 'data_reuniao', 'prontuario_atual',
  'prontuario_anterior', 'medico_assistente', 'crm_assistente', 'cids', 'relatorio', 'conclusao'];

// Peritos cadastrados (para compor a junta).
router.get('/peritos', (req, res) => {
  const linhas = db.prepare(
    `SELECT id, nome, crm FROM usuarios WHERE papel IN ('perito','perito_admin') AND ativo = 1 ORDER BY nome`
  ).all();
  res.json(linhas);
});

// Lista de juntas (com nome do servidor).
router.get('/', (req, res) => {
  const st = req.query.status;
  const linhas = db.prepare(
    `SELECT j.*, s.nome AS servidor_nome, p.numero_sei AS processo_numero
     FROM juntas j LEFT JOIN servidores s ON s.id = j.servidor_id
     LEFT JOIN processos p ON p.id = j.processo_id
     ${st ? 'WHERE j.status = ?' : ''}
     ORDER BY CASE j.status WHEN 'aberta' THEN 0 ELSE 1 END, j.id DESC`
  ).all(...(st ? [st] : []));
  res.json(linhas);
});

// Detalhe da junta + dossiê do servidor.
router.get('/:id', (req, res) => {
  const j = db.prepare('SELECT * FROM juntas WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ erro: 'Junta não encontrada' });
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(j.servidor_id);
  const dossie = {
    afastamentos: db.prepare('SELECT * FROM afastamentos WHERE servidor_id = ? ORDER BY data_inicio DESC, id DESC').all(j.servidor_id),
    processos: db.prepare('SELECT id, numero_sei, tipo, especificacao, status FROM processos WHERE servidor_id = ? ORDER BY id DESC').all(j.servidor_id),
    documentos: db.prepare('SELECT id, tipo, nome_orig FROM prontuario_docs WHERE servidor_id = ? ORDER BY id DESC').all(j.servidor_id),
  };
  let peritos = [];
  try { peritos = JSON.parse(j.peritos || '[]'); } catch { peritos = []; }
  res.json({ ...j, peritos, servidor: s, dossie });
});

// Cria a junta (a partir de um servidor).
router.post('/', exigirPapel('operador', 'admin', 'admin_master', 'perito', 'perito_admin'), (req, res) => {
  const b = req.body || {};
  if (!b.servidor_id) return res.status(400).json({ erro: 'Informe o servidor' });
  const cols = CAMPOS.filter((c) => b[c] !== undefined);
  const peritos = Array.isArray(b.peritos) ? JSON.stringify(b.peritos) : (b.peritos || '[]');
  const info = db.prepare(
    `INSERT INTO juntas (${cols.join(',')}${cols.length ? ',' : ''} peritos, criado_por)
     VALUES (${cols.map(() => '?').join(',')}${cols.length ? ',' : ''} ?, ?)`
  ).run(...cols.map((c) => b[c] || null), peritos, req.usuario.nome);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Atualiza a junta (relatório, conclusão, composição, status).
router.put('/:id', exigirPapel('operador', 'admin', 'admin_master', 'perito', 'perito_admin'), (req, res) => {
  const j = db.prepare('SELECT * FROM juntas WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ erro: 'Junta não encontrada' });
  const b = req.body || {};
  const cols = CAMPOS.filter((c) => b[c] !== undefined);
  const sets = cols.map((c) => `${c} = ?`);
  const vals = cols.map((c) => b[c] || null);
  if (b.peritos !== undefined) { sets.push('peritos = ?'); vals.push(Array.isArray(b.peritos) ? JSON.stringify(b.peritos) : b.peritos); }
  if (b.status === 'concluida') { sets.push("status = 'concluida'", "concluida_em = datetime('now')"); }
  else if (b.status === 'aberta') { sets.push("status = 'aberta'", 'concluida_em = NULL'); }
  if (sets.length) db.prepare(`UPDATE juntas SET ${sets.join(', ')} WHERE id = ?`).run(...vals, j.id);
  res.json({ ok: true });
});

router.delete('/:id', exigirPapel('operador', 'admin', 'admin_master'), (req, res) => {
  db.prepare('DELETE FROM juntas WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Laudo RAI imprimível (com timbre).
router.get('/:id/laudo', (req, res) => {
  const j = db.prepare('SELECT * FROM juntas WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).send('Junta não encontrada');
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(j.servidor_id);
  if (!s) return res.status(404).send('Servidor não encontrado');
  const proc = j.processo_id ? db.prepare('SELECT numero_sei FROM processos WHERE id = ?').get(j.processo_id) : null;
  const dossie = {
    afastamentos: db.prepare('SELECT * FROM afastamentos WHERE servidor_id = ? ORDER BY data_inicio').all(j.servidor_id),
    processos: db.prepare('SELECT numero_sei, tipo, especificacao, status FROM processos WHERE servidor_id = ?').all(j.servidor_id),
  };
  res.set('Content-Type', 'text/html; charset=utf-8').send(htmlRAI({ ...j, processo_numero: proc?.numero_sei }, s, dossie));
});

export default router;
