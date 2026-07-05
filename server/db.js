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
// Arquivo de despacho feito fora do sistema (anexado pelo perito)
garantirColuna('despachos', 'arquivo', 'arquivo TEXT');
// Conteúdo (texto) e arquivo baixado de cada documento do SEI
garantirColuna('documentos', 'conteudo', 'conteudo TEXT');
garantirColuna('documentos', 'arquivo', 'arquivo TEXT');
// Quando o conteúdo do processo foi buscado no SEI, e o PDF do processo
garantirColuna('processos', 'conteudo_em', 'conteudo_em TEXT');
garantirColuna('processos', 'pdf_processo', 'pdf_processo TEXT');
// Quando o processo foi distribuído a um perito (para contar o prazo)
garantirColuna('processos', 'distribuido_em', 'distribuido_em TEXT');
// PDF do despacho assinado digitalmente (ICP-Brasil A1)
garantirColuna('processos', 'pdf_assinado', 'pdf_assinado TEXT');
// Processos FÍSICOS (não tramitam no SEI): inclusão manual pelo operador
garantirColuna('processos', 'fisico', 'fisico INTEGER NOT NULL DEFAULT 0');
garantirColuna('processos', 'secretaria_destino', 'secretaria_destino TEXT');
garantirColuna('processos', 'remessa_id', 'remessa_id INTEGER');

// Remessas do mensageiro (processos físicos enviados às secretarias)
db.exec(`
CREATE TABLE IF NOT EXISTS remessas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  secretaria   TEXT NOT NULL,
  mensageiro   TEXT,
  criado_por   TEXT,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  retirada_em  TEXT
);`);
// Migração: remove a restrição antiga de papéis (que só aceitava
// admin/operador/perito) para permitir novos papéis (perito_admin, admin_master).
// Recria apenas as colunas ORIGINAIS; as demais são adicionadas logo abaixo
// por garantirColuna (por isso a migração vem ANTES delas).
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
      criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO usuarios_new (id, nome, email, senha_hash, papel, ativo, criado_em)
      SELECT id, nome, email, senha_hash, papel, ativo, criado_em FROM usuarios;
    DROP TABLE usuarios;
    ALTER TABLE usuarios_new RENAME TO usuarios;
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}

// Dados do servidor/perito (após a migração de papéis, para não serem perdidos)
garantirColuna('usuarios', 'cpf', 'cpf TEXT');
garantirColuna('usuarios', 'matricula', 'matricula TEXT');
garantirColuna('usuarios', 'crm', 'crm TEXT');
// Certificado digital ICP-Brasil A1 do servidor (arquivo .pfx + senha criptografada)
garantirColuna('usuarios', 'cert_arquivo', 'cert_arquivo TEXT');
garantirColuna('usuarios', 'cert_senha', 'cert_senha TEXT');

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
// Assinatura nativa do SEI (assina o despacho com a senha do SEI)
garantirColuna('sei_config', 'assinar', 'assinar INTEGER NOT NULL DEFAULT 1');
garantirColuna('sei_config', 'cargo', 'cargo TEXT');
// Gerar o PDF do processo inteiro ao buscar conteúdo (pesado). Padrão: não
// (arquivamos os metadados + documentos, que é mais leve).
garantirColuna('sei_config', 'gerar_pdf', 'gerar_pdf INTEGER NOT NULL DEFAULT 0');
// Data de entrada do processo na perícia (para prazos) e tipo da perícia
garantirColuna('processos', 'data_entrada', 'data_entrada TEXT');

// Servidor periciado (a pessoa dos processos) — vínculo com o processo
garantirColuna('processos', 'servidor_id', 'servidor_id INTEGER');

// Cadastro de servidores periciados + ficha funcional (base para PPP)
db.exec(`
CREATE TABLE IF NOT EXISTS servidores (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nome           TEXT NOT NULL,
  cpf            TEXT,
  matricula      TEXT,
  cargo          TEXT,
  funcao         TEXT,
  lotacao        TEXT,
  secretaria     TEXT,
  setor          TEXT,
  data_nascimento TEXT,
  sexo           TEXT,
  data_admissao  TEXT,
  vinculo        TEXT,
  atividades     TEXT,
  agentes_nocivos TEXT,
  observacoes    TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS afastamentos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  servidor_id  INTEGER NOT NULL REFERENCES servidores(id) ON DELETE CASCADE,
  processo_id  INTEGER REFERENCES processos(id) ON DELETE SET NULL,
  tipo         TEXT,
  cid          TEXT,
  cid2         TEXT,
  data_inicio  TEXT,
  data_fim     TEXT,
  dias         INTEGER,
  descricao    TEXT,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS prontuario_docs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  servidor_id  INTEGER NOT NULL REFERENCES servidores(id) ON DELETE CASCADE,
  tipo         TEXT,
  arquivo      TEXT NOT NULL,
  nome_orig    TEXT,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_afast_serv ON afastamentos(servidor_id);
CREATE INDEX IF NOT EXISTS idx_proc_serv ON processos(servidor_id);
`);

// --- Ficha funcional completa do servidor (RH da Prefeitura) ---
// Todos os campos da tela "Dados Cadastrais do Funcionário" para
// alimentar o cadastro e servir de base ao PPP/LTCAT/PCMSO.
for (const [nome, ddl] of [
  // Dados pessoais
  ['pai', 'pai TEXT'], ['mae', 'mae TEXT'], ['grau_instrucao', 'grau_instrucao TEXT'],
  ['naturalidade', 'naturalidade TEXT'], ['uf_naturalidade', 'uf_naturalidade TEXT'],
  ['nacionalidade', 'nacionalidade TEXT'], ['estado_civil', 'estado_civil TEXT'],
  // Documentação
  ['identidade', 'identidade TEXT'], ['identidade_emissao', 'identidade_emissao TEXT'],
  ['identidade_orgao', 'identidade_orgao TEXT'], ['titulo_eleitor', 'titulo_eleitor TEXT'],
  ['zona', 'zona TEXT'], ['secao', 'secao TEXT'], ['ctps', 'ctps TEXT'],
  ['ctps_serie', 'ctps_serie TEXT'], ['ctps_uf', 'ctps_uf TEXT'],
  ['nit', 'nit TEXT'], ['pis_pasep', 'pis_pasep TEXT'],
  // Dados funcionais
  ['situacao', 'situacao TEXT'], ['data_demissao', 'data_demissao TEXT'],
  ['tipo_admissao', 'tipo_admissao TEXT'], ['data_publicacao', 'data_publicacao TEXT'],
  ['num_portaria', 'num_portaria TEXT'], ['data_concurso', 'data_concurso TEXT'],
  ['data_posse', 'data_posse TEXT'], ['data_exercicio', 'data_exercicio TEXT'],
  ['tipo_salario', 'tipo_salario TEXT'], ['regime_previdencia', 'regime_previdencia TEXT'],
  ['carga_horaria', 'carga_horaria TEXT'], ['vinculo_empregaticio', 'vinculo_empregaticio TEXT'],
  ['unidade_trabalho', 'unidade_trabalho TEXT'], ['classificacao_funcional', 'classificacao_funcional TEXT'],
  ['simbologia', 'simbologia TEXT'], ['cbo', 'cbo TEXT'], ['cbo_mt', 'cbo_mt TEXT'],
  // Endereço/contato
  ['endereco', 'endereco TEXT'], ['numero_ende', 'numero_ende TEXT'], ['bairro', 'bairro TEXT'],
  ['municipio', 'municipio TEXT'], ['uf_ende', 'uf_ende TEXT'], ['cep', 'cep TEXT'],
  ['complemento', 'complemento TEXT'], ['telefone', 'telefone TEXT'], ['celular', 'celular TEXT'],
  ['email', 'email TEXT'],
  // Gerados por IA a partir do CBO (base para PPP/LTCAT/PCMSO)
  ['ppp_atividades', 'ppp_atividades TEXT'], ['ltcat', 'ltcat TEXT'], ['pcmso', 'pcmso TEXT'],
  ['ia_atualizado_em', 'ia_atualizado_em TEXT'], ['ficha_atualizada_em', 'ficha_atualizada_em TEXT'],
]) {
  garantirColuna('servidores', nome, ddl);
}

// Padrões pessoais de despacho do perito
db.exec(`
CREATE TABLE IF NOT EXISTS padroes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  texto       TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);`);

// Encontra ou cria o servidor (pessoa periciada) pelo nome/CPF e vincula ao processo.
export function vincularServidor(processoId, nome, cpf) {
  const nomeLimpo = String(nome || '').replace(/^REF\.?\s*/i, '').trim();
  if (!nomeLimpo) return null;
  let serv = cpf ? db.prepare('SELECT id FROM servidores WHERE cpf = ?').get(cpf) : null;
  if (!serv) serv = db.prepare('SELECT id FROM servidores WHERE upper(nome) = upper(?)').get(nomeLimpo);
  if (!serv) {
    const info = db.prepare('INSERT INTO servidores (nome, cpf) VALUES (?, ?)').run(nomeLimpo, cpf || null);
    serv = { id: info.lastInsertRowid };
  } else if (cpf) {
    db.prepare('UPDATE servidores SET cpf = COALESCE(cpf, ?) WHERE id = ?').run(cpf, serv.id);
  }
  if (processoId) db.prepare('UPDATE processos SET servidor_id = ? WHERE id = ?').run(serv.id, processoId);
  return serv.id;
}

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
