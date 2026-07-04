import bcrypt from 'bcryptjs';
import db from './db.js';

export function verificarSenha(senha, hash) {
  return bcrypt.compareSync(senha, hash);
}

export function gerarHash(senha) {
  return bcrypt.hashSync(senha, 10);
}

// Middleware: exige usuário logado.
export function exigirLogin(req, res, next) {
  if (!req.session?.usuarioId) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }
  const usuario = db
    .prepare('SELECT id, nome, email, papel, ativo FROM usuarios WHERE id = ?')
    .get(req.session.usuarioId);
  if (!usuario || !usuario.ativo) {
    req.session.destroy(() => {});
    return res.status(401).json({ erro: 'Sessão inválida' });
  }
  req.usuario = usuario;
  next();
}

// Middleware: exige um dos papéis informados.
export function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (!req.usuario || !papeis.includes(req.usuario.papel)) {
      return res.status(403).json({ erro: 'Sem permissão para esta ação' });
    }
    next();
  };
}
