import { Router } from 'express';
import db from '../db.js';
import { verificarSenha, gerarHash, exigirLogin } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!usuario || !usuario.ativo || !verificarSenha(senha, usuario.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
  }
  req.session.usuarioId = usuario.id;
  res.json({
    id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel,
    senha_padrao: verificarSenha('admin123', usuario.senha_hash),
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', exigirLogin, (req, res) => {
  // Sinaliza se a conta ainda usa a senha padrão de fábrica (admin123),
  // para o painel avisar que é preciso trocar no primeiro acesso.
  const row = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  const senha_padrao = !!row && verificarSenha('admin123', row.senha_hash);
  res.json({ ...req.usuario, senha_padrao });
});

// Troca da própria senha (qualquer usuário logado).
router.post('/trocar-senha', exigirLogin, (req, res) => {
  const { senha_atual, nova_senha } = req.body || {};
  if (!senha_atual || !nova_senha) return res.status(400).json({ erro: 'Informe a senha atual e a nova senha' });
  if (String(nova_senha).length < 6) return res.status(400).json({ erro: 'A nova senha deve ter ao menos 6 caracteres' });
  const row = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!row || !verificarSenha(senha_atual, row.senha_hash)) {
    return res.status(401).json({ erro: 'Senha atual incorreta' });
  }
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(gerarHash(nova_senha), req.usuario.id);
  res.json({ ok: true });
});

export default router;
