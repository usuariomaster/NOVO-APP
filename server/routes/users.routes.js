import { Router } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import db from '../db.js';
import { exigirLogin, exigirPapel, gerarHash } from '../auth.js';

const router = Router();
router.use(exigirLogin);

const DIR_SERVIDORES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'servidores');

// Lista de peritos — usada pelo operador para distribuir.
router.get('/peritos', (req, res) => {
  const peritos = db
    .prepare(`SELECT id, nome, email, crm FROM usuarios WHERE papel LIKE 'perito%' AND ativo = 1 ORDER BY nome`)
    .all();
  res.json(peritos);
});

// Gestão de usuários (somente admin)
router.get('/', exigirPapel('admin', 'admin_master'), (req, res) => {
  const usuarios = db
    .prepare('SELECT id, nome, email, papel, ativo, cpf, matricula, crm, criado_em FROM usuarios ORDER BY nome')
    .all();
  res.json(usuarios);
});

router.get('/:id', exigirPapel('admin', 'admin_master'), (req, res) => {
  const u = db.prepare('SELECT id, nome, email, papel, ativo, cpf, matricula, crm FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
  u.documentos = db.prepare('SELECT id, tipo, nome_orig, criado_em FROM servidor_documentos WHERE usuario_id = ? ORDER BY id DESC').all(u.id);
  res.json(u);
});

const PAPEIS = ['admin', 'admin_master', 'operador', 'perito', 'perito_admin'];

router.post('/', exigirPapel('admin', 'admin_master'), (req, res) => {
  const { nome, email, senha, papel, cpf, matricula, crm } = req.body || {};
  if (!nome || !email || !senha || !papel) {
    return res.status(400).json({ erro: 'Informe nome, e-mail, senha e papel' });
  }
  if (!PAPEIS.includes(papel)) return res.status(400).json({ erro: 'Papel inválido' });
  try {
    const info = db
      .prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, cpf, matricula, crm) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(nome.trim(), String(email).toLowerCase().trim(), gerarHash(senha), papel, cpf || null, matricula || null, crm || null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ erro: 'E-mail já cadastrado' });
    throw e;
  }
});

router.put('/:id', exigirPapel('admin', 'admin_master'), (req, res) => {
  const { nome, papel, ativo, senha, cpf, matricula, crm } = req.body || {};
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
  if (papel && !PAPEIS.includes(papel)) return res.status(400).json({ erro: 'Papel inválido' });

  db.prepare(
    `UPDATE usuarios SET
       nome = COALESCE(?, nome),
       papel = COALESCE(?, papel),
       ativo = COALESCE(?, ativo),
       senha_hash = COALESCE(?, senha_hash),
       cpf = COALESCE(?, cpf),
       matricula = COALESCE(?, matricula),
       crm = COALESCE(?, crm)
     WHERE id = ?`
  ).run(
    nome ?? null,
    papel ?? null,
    ativo === undefined ? null : ativo ? 1 : 0,
    senha ? gerarHash(senha) : null,
    cpf ?? null,
    matricula ?? null,
    crm ?? null,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', exigirPapel('admin', 'admin_master'), (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
  if (usuario.id === req.usuario.id) return res.status(400).json({ erro: 'Você não pode excluir a si mesmo' });
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Documentos do servidor (CRM, diploma, título, portaria, etc.) ----
// Upload por base64: { tipo, nome_orig, dados_base64 }
router.post('/:id/documentos', exigirPapel('admin', 'admin_master'), (req, res) => {
  const { tipo, nome_orig, dados_base64 } = req.body || {};
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
  if (!tipo || !dados_base64) return res.status(400).json({ erro: 'Informe o tipo do documento e o arquivo' });

  // Diretório próprio do servidor (criado automaticamente).
  const dir = join(DIR_SERVIDORES, String(usuario.id));
  mkdirSync(dir, { recursive: true });

  const base = String(dados_base64).includes(',') ? String(dados_base64).split(',')[1] : String(dados_base64);
  const buf = Buffer.from(base, 'base64');
  if (buf.length > 30 * 1024 * 1024) return res.status(413).json({ erro: 'Arquivo muito grande (máx. 30MB)' });

  const ext = (nome_orig && nome_orig.includes('.')) ? nome_orig.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 5) : 'bin';
  const arquivo = `doc-${Date.now()}.${ext}`;
  writeFileSync(join(dir, arquivo), buf);

  const info = db
    .prepare('INSERT INTO servidor_documentos (usuario_id, tipo, arquivo, nome_orig) VALUES (?, ?, ?, ?)')
    .run(usuario.id, String(tipo).trim(), arquivo, nome_orig || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/:id/documentos/:docId', (req, res) => {
  // Admin vê todos; o próprio usuário vê os seus.
  const ehAdmin = ['admin', 'admin_master'].includes(req.usuario.papel);
  if (!ehAdmin && String(req.usuario.id) !== String(req.params.id)) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  const doc = db.prepare('SELECT * FROM servidor_documentos WHERE id = ? AND usuario_id = ?').get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ erro: 'Documento não encontrado' });
  const nome = String(doc.arquivo).replace(/[^a-zA-Z0-9._-]/g, '');
  const caminho = join(DIR_SERVIDORES, String(req.params.id), nome);
  if (!existsSync(caminho)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
  res.sendFile(caminho);
});

router.delete('/:id/documentos/:docId', exigirPapel('admin', 'admin_master'), (req, res) => {
  db.prepare('DELETE FROM servidor_documentos WHERE id = ? AND usuario_id = ?').run(req.params.docId, req.params.id);
  res.json({ ok: true });
});

export default router;
