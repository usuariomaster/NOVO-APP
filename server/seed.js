import db from './db.js';
import { gerarHash } from './auth.js';

// Cria um administrador padrão se não houver nenhum usuário.
// Troque a senha no primeiro acesso.
export function garantirSeed() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  if (total > 0) return;

  const criar = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)');
  criar.run('Administrador', 'admin@pericia.local', gerarHash('admin123'), 'admin');
  criar.run('Operador Exemplo', 'operador@pericia.local', gerarHash('operador123'), 'operador');
  criar.run('Perito Exemplo', 'perito@pericia.local', gerarHash('perito123'), 'perito');

  console.log('  [seed] Usuários iniciais criados:');
  console.log('    admin@pericia.local / admin123     (administrador)');
  console.log('    operador@pericia.local / operador123 (operador)');
  console.log('    perito@pericia.local / perito123    (perito)');
}

// Permite rodar "npm run seed" diretamente.
if (import.meta.url === `file://${process.argv[1]}`) {
  garantirSeed();
}
