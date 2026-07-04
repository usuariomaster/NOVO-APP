import { Router } from 'express';
import db from '../db.js';
import { exigirLogin, exigirPapel, gerarHash } from '../auth.js';

const router = Router();
router.use(exigirLogin);

// Lista de peritos — usada pelo operador para distribuir.
router.get('/peritos', (req, res) => {
  const peritos = db
    .prepare(`SELECT id, nome, email FROM usuarios WHERE papel = 'perito' AND ativo = 1 ORDER BY nome`)
    .all();
  res.json(peritos);
});

// Gestão de usuários (somente admin)
router.get('/', exigirPapel('admin'), (req, res) => {
  const usuarios = db
    .prepare('SELECT id, nome, email, papel, ativo, criado_em FROM usuarios ORDER BY nome')
    .all();
  res.json(usuarios);
});

router.post('/', exigirPapel('admin'), (req, res) => {
  const { nome, email, senha, papel } = req.body || {};
  if (!nome || !email || !senha || !papel) {
    return res.status(400).json({ erro: 'Informe nome, e-mail, senha e papel' });
  }
  if (!['admin', 'operador', 'perito'].includes(papel)) {
    return res.status(400).json({ erro: 'Papel inválido' });
  }
  try {
    const info = db
      .prepare('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)')
      .run(nome.trim(), String(email).toLowerCase().trim(), gerarHash(senha), papel);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ erro: 'E-mail já cadastrado' });
    throw e;
  }
});

router.put('/:id', exigirPapel('admin'), (req, res) => {
  const { nome, papel, ativo, senha } = req.body || {};
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

  db.prepare(
    `UPDATE usuarios SET
       nome = COALESCE(?, nome),
       papel = COALESCE(?, papel),
       ativo = COALESCE(?, ativo),
       senha_hash = COALESCE(?, senha_hash)
     WHERE id = ?`
  ).run(
    nome ?? null,
    papel ?? null,
    ativo === undefined ? null : ativo ? 1 : 0,
    senha ? gerarHash(senha) : null,
    req.params.id
  );
  res.json({ ok: true });
});

export default router;
