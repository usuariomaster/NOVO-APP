import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './db.js';
import { garantirSeed } from './seed.js';

import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import seiRoutes from './routes/sei.routes.js';
import processosRoutes from './routes/processos.routes.js';
import despachosRoutes from './routes/despachos.routes.js';
import remessasRoutes from './routes/remessas.routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cria o admin padrão na primeira execução.
garantirSeed();

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(
  session({
    secret: process.env.APP_SECRET || 'chave-padrao-insegura-troque-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usersRoutes);
app.use('/api/sei', seiRoutes);
app.use('/api/processos', processosRoutes);
app.use('/api/despachos', despachosRoutes);
app.use('/api/remessas', remessasRoutes);

// Front-end estático
app.use(express.static(join(__dirname, '..', 'public')));

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mock = String(process.env.SEI_MOCK ?? 'true').toLowerCase() === 'true';
  console.log(`\n  SisPerícia rodando em http://localhost:${PORT}`);
  console.log(`  Extração do SEI: ${mock ? 'MODO SIMULAÇÃO (dados de exemplo)' : 'SEI real'}`);
  console.log(`  Login inicial:  admin@pericia.local  /  admin123\n`);
});
