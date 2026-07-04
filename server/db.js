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
