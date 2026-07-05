// Padrões pessoais de despacho do perito (textos que ele reutiliza).
import { Router } from 'express';
import db from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';

const router = Router();
router.use(exigirLogin);
router.use(exigirPapel('perito', 'perito_admin', 'admin', 'admin_master', 'operador'));

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT id, titulo, texto FROM padroes WHERE usuario_id = ? ORDER BY titulo').all(req.usuario.id));
});

router.post('/', (req, res) => {
  const { titulo, texto } = req.body || {};
  if (!titulo || !texto) return res.status(400).json({ erro: 'Informe título e texto' });
  const info = db.prepare('INSERT INTO padroes (usuario_id, titulo, texto) VALUES (?, ?, ?)')
    .run(req.usuario.id, titulo.trim(), texto);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM padroes WHERE id = ? AND usuario_id = ?').run(req.params.id, req.usuario.id);
  res.json({ ok: true });
});

export default router;
