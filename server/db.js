import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'sispericia.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ------------------------------------------------------------
// Schema
// ------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL,
  papel       TEXT NOT NULL CHECK (papel IN ('admin','operador','perito')),
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Configuração de acesso ao SEI por unidade (credenciais criptografadas)
CREATE TABLE IF NOT EXISTS sei_config (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  apelido        TEXT NOT NULL,            -- ex.: "Perícia - Unidade 110001126"
  base_url       TEXT NOT NULL,
  orgao          TEXT,
  unidade        TEXT,                     -- infra_unidade_atual
  usuario        TEXT NOT NULL,
  senha_cripto   TEXT NOT NULL,            -- AES-256-GCM
  padrao         INTEGER NOT NULL DEFAULT 0,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS processos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_sei     TEXT NOT NULL UNIQUE,
  tipo           TEXT,
  interessado    TEXT,
  especificacao  TEXT,
  data_autuacao  TEXT,
  unidade_origem TEXT,
  link_sei       TEXT,
  prioridade     TEXT NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  prazo          TEXT,
  status         TEXT NOT NULL DEFAULT 'novo'
                 CHECK (status IN ('novo','em_controle','distribuido','em_pericia','despachado','devolvido','conferido','enviado_sei','concluido')),
  perito_id      INTEGER REFERENCES usuarios(id),
  operador_id    INTEGER REFERENCES usuarios(id),
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documentos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  processo_id  INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  numero       TEXT,
  tipo         TEXT,
  data         TEXT,
  link_sei     TEXT
);

CREATE TABLE IF NOT EXISTS despachos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  processo_id  INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  perito_id    INTEGER REFERENCES usuarios(id),
  texto        TEXT NOT NULL,
  conclusao    TEXT,                       -- ex.: "deferido", "indeferido", "diligência"
  status       TEXT NOT NULL DEFAULT 'rascunho'
               CHECK (status IN ('rascunho','enviado','devolvido','aprovado')),
  motivo_devolucao TEXT,                   -- preenchido pelo operador ao rejeitar
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trilha de auditoria: quem fez o quê e quando
CREATE TABLE IF NOT EXISTS historico (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  processo_id  INTEGER REFERENCES processos(id) ON DELETE CASCADE,
  usuario_id   INTEGER REFERENCES usuarios(id),
  usuario_nome TEXT,
  acao         TEXT NOT NULL,
  detalhe      TEXT,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proc_status ON processos(status);
CREATE INDEX IF NOT EXISTS idx_proc_perito ON processos(perito_id);
CREATE INDEX IF NOT EXISTS idx_hist_proc ON historico(processo_id);
`);

// Configurações gerais (chave/valor) — ex.: modo simulação x SEI real
db.exec(`CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);

export function getConfig(chave, padrao = null) {
  const r = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave);
  return r ? r.valor : padrao;
}
export function setConfig(chave, valor) {
  db.prepare(
    `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  ).run(chave, String(valor));
}
// true = usa dados de exemplo; false = acessa o SEI real.
// A variável de ambiente SEI_MOCK, se definida, tem prioridade.
export function ehSimulacao() {
  const env = process.env.SEI_MOCK;
  if (env !== undefined && env !== '') return String(env).toLowerCase() === 'true';
  return getConfig('modo_simulacao', '1') === '1';
}

// ------------------------------------------------------------
// Migrações incrementais (adiciona colunas se ainda não existem)
// ------------------------------------------------------------
function garantirColuna(tabela, nome, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all();
  if (!cols.some((c) => c.name === nome)) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${ddl}`);
  }
}
// Comprovante (print) do lançamento automático do despacho no SEI
garantirColuna('despachos', 'comprovante', 'comprovante TEXT');
// Conteúdo (texto) e arquivo baixado de cada documento do SEI
garantirColuna('documentos', 'conteudo', 'conteudo TEXT');
garantirColuna('documentos', 'arquivo', 'arquivo TEXT');
// Quando o conteúdo do processo foi buscado no SEI, e o PDF do processo
garantirColuna('processos', 'conteudo_em', 'conteudo_em TEXT');
garantirColuna('processos', 'pdf_processo', 'pdf_processo TEXT');
// Dados do servidor/perito
garantirColuna('usuarios', 'cpf', 'cpf TEXT');
garantirColuna('usuarios', 'matricula', 'matricula TEXT');
garantirColuna('usuarios', 'crm', 'crm TEXT');

// Migração: remove a restrição antiga de papéis (que só aceitava
// admin/operador/perito) para permitir novos papéis (perito_admin, admin_master).
const usuariosSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get()?.sql || '';
if (/papel\s+TEXT\s+NOT\s+NULL\s+CHECK/i.test(usuariosSql)) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;
    CREATE TABLE usuarios_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nome        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      senha_hash  TEXT NOT NULL,
      papel       TEXT NOT NULL,
      ativo       INTEGER NOT NULL DEFAULT 1,
      criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
      cpf         TEXT,
      matricula   TEXT,
      crm         TEXT
    );
    INSERT INTO usuarios_new (id, nome, email, senha_hash, papel, ativo, criado_em, cpf, matricula, crm)
      SELECT id, nome, email, senha_hash, papel, ativo, criado_em, cpf, matricula, crm FROM usuarios;
    DROP TABLE usuarios;
    ALTER TABLE usuarios_new RENAME TO usuarios;
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}

// Documentos do servidor (CRM, diploma, título, portaria de nomeação, etc.)
db.exec(`
CREATE TABLE IF NOT EXISTS servidor_documentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  arquivo     TEXT NOT NULL,
  nome_orig   TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Configuração da escrita automática no SEI
garantirColuna('sei_config', 'escrita', 'escrita INTEGER NOT NULL DEFAULT 1');
garantirColuna('sei_config', 'tipo_documento', "tipo_documento TEXT NOT NULL DEFAULT 'Despacho'");
garantirColuna('sei_config', 'nivel_acesso', "nivel_acesso TEXT NOT NULL DEFAULT 'publico'");
garantirColuna('sei_config', 'unidade_destino', 'unidade_destino TEXT');

export function registrarHistorico({ processoId, usuario, acao, detalhe }) {
  db.prepare(
    `INSERT INTO historico (processo_id, usuario_id, usuario_nome, acao, detalhe)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    processoId ?? null,
    usuario?.id ?? null,
    usuario?.nome ?? null,
    acao,
    detalhe ?? null
  );
}

export default db;
