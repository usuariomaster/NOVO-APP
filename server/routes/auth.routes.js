import { Router } from 'express';
import db from '../db.js';
import { verificarSenha, exigirLogin } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!usuario || !usuario.ativo || !verificarSenha(senha, usuario.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
  }
  req.session.usuarioId = usuario.id;
  res.json({ id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', exigirLogin, (req, res) => {
  res.json(req.usuario);
});

export default router;
