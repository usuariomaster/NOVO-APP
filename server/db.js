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
// Gerar o PDF do processo inteiro ao buscar conteúdo — LIGADO por padrão,
// para permitir consultar/imprimir/arquivar o processo.
garantirColuna('sei_config', 'gerar_pdf', 'gerar_pdf INTEGER NOT NULL DEFAULT 1');
// Migração única: liga o PDF nas configurações já existentes (antes era 0).
if (getConfig('gerar_pdf_padrao_on') !== '1') {
  try { db.prepare('UPDATE sei_config SET gerar_pdf = 1').run(); } catch { /* ignora */ }
  setConfig('gerar_pdf_padrao_on', '1');
}
// Data de entrada do processo na perícia (para prazos) e tipo da perícia
garantirColuna('processos', 'data_entrada', 'data_entrada TEXT');
// Canal de entrada (as 3 portas): 'sei' | 'fisico' | 'whatsapp'
garantirColuna('processos', 'canal', "canal TEXT NOT NULL DEFAULT 'sei'");
// Triado: 1 quando o operador já identificou/classificou e mandou pra fila
garantirColuna('processos', 'triado', 'triado INTEGER NOT NULL DEFAULT 0');
// Situação da ficha funcional lida por OCR: 'ok' | 'ausente' | null (não tentado)
garantirColuna('processos', 'ficha_status', 'ficha_status TEXT');
// Data em que o processo foi encaminhado/recebido na perícia (lida do SEI)
garantirColuna('processos', 'data_encaminhado', 'data_encaminhado TEXT');
// Arquivamento do processo (encerrado/guardado no prontuário do servidor)
garantirColuna('processos', 'arquivado', 'arquivado INTEGER NOT NULL DEFAULT 0');
garantirColuna('processos', 'arquivado_em', 'arquivado_em TEXT');

// Ocorrências / BIM (Boletim de Inspeção Médica): cada perícia de um servidor.
// Reaproveita a tabela afastamentos, acrescentando data da perícia, conclusão
// e o perito responsável, para virar um boletim individualizado por processo.
garantirColuna('afastamentos', 'data_pericia', 'data_pericia TEXT');
garantirColuna('afastamentos', 'conclusao', 'conclusao TEXT');
garantirColuna('afastamentos', 'perito', 'perito TEXT');
garantirColuna('afastamentos', 'bim_numero', 'bim_numero TEXT');

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

// Limpa o "interessado" para extrair o NOME DA PESSOA. No SEI muitos processos
// vêm como "ASSENTAMENTO ... REF. NOME" ou "REF. NOME" — a pessoa é o que vem
// depois de REF./REFERENTE. Descarta strings que são claramente título de
// documento (sem pessoa). Retorna o nome limpo ou null.
export function limparNomeInteressado(bruto) {
  let s = String(bruto || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // pega o trecho após o último "REF." / "REFERENTE A" / "REFERENTE:"
  const m = s.match(/\bREF(?:ER[EÊ]NTE)?\.?\s*(?:A|AO|AOS|[AÀ]S)?\s*[:\-]?\s*(.+)$/i);
  if (m && m[1]) s = m[1].trim();
  // remove prefixos de tipo de documento que às vezes sobram
  s = s.replace(/^(ASSENTAMENTO|PRONTU[AÁ]RIO|FUNCIONAL|PROCESSO|REQUERIMENTO|DESPACHO|OF[IÍ]CIO|MEMORANDO|LAUDO|ATESTADO|CERTID[AÃ]O|EM|DE|DO|DA)\b[\s:.-]*/gi, '').trim();
  // separadores comuns (nome vem antes de vírgula/traço com matrícula, etc.)
  s = s.split(/[\n;|,]/)[0].trim();
  s = s.split(/\s[-–—]\s/)[0].trim();       // "NOME - MATRÍCULA 123" -> "NOME"
  s = s.replace(/\s+(MATR[IÍ]CULA|MAT|CPF|SIAPE)\b.*$/i, '').trim();
  if (s.length < 4 || s.length > 60) return null;
  // precisa parecer nome: só letras/espaços/pontos/hífen, com pelo menos 2 palavras
  if (!/^[A-Za-zÀ-ú.'\- ]+$/.test(s)) return null;
  if (s.split(/\s+/).filter((w) => w.length > 1).length < 2) return null;
  // ainda com cara de título de documento/andamento? descarta.
  if (/ASSENTAMENTO|PRONTU[AÁ]RIO|REQUERIMENTO|DESPACHO|OF[IÍ]CIO|MEMORANDO|CERTID[AÃ]O|PROCESSO\b|INFORMA[CÇ]|SOBRE\s+SERVIDOR|SERVIDOR\b|ANDAMENTO|ATRIBUI|NOTIFICA|COMUNICA|SOLICITA|ENCAMINHA|RELAT[OÓ]RIO|PARECER|MANIFESTA|\bSEI\b|CADASTR|FUNCIONAL/i.test(s)) return null;
  return s;
}

// Encontra ou cria o servidor (pessoa periciada) pelo nome/CPF e vincula ao processo.
export function vincularServidor(processoId, nome, cpf) {
  const nomeLimpo = limparNomeInteressado(nome);
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

// Correção única dos dados já existentes: limpa nomes de interessado antigos
// (assunto que virou "servidor" por engano) e reconstrói a lista de servidores
// a partir dos nomes limpos. Preserva servidores com dados manuais/OCR.
if (getConfig('interessados_limpos_v2') !== '1') {
  try {
    // 1) limpa o interessado dos processos
    const procs = db.prepare("SELECT id, interessado FROM processos WHERE interessado IS NOT NULL AND interessado <> ''").all();
    const updP = db.prepare('UPDATE processos SET interessado = ? WHERE id = ?');
    for (const p of procs) updP.run(limparNomeInteressado(p.interessado), p.id);
    // 2) remove servidores auto-criados (sem dados manuais, sem afastamentos/docs)
    db.prepare(
      `DELETE FROM servidores WHERE cpf IS NULL AND matricula IS NULL
         AND ficha_atualizada_em IS NULL AND ppp_atividades IS NULL
         AND (observacoes IS NULL OR observacoes = '')
         AND id NOT IN (SELECT servidor_id FROM afastamentos WHERE servidor_id IS NOT NULL)
         AND id NOT IN (SELECT servidor_id FROM prontuario_docs WHERE servidor_id IS NOT NULL)`
    ).run();
    // 3) desvincula processos cujo servidor foi removido
    db.prepare('UPDATE processos SET servidor_id = NULL WHERE servidor_id IS NOT NULL AND servidor_id NOT IN (SELECT id FROM servidores)').run();
    // 4) reconstrói servidores a partir do interessado já limpo
    const rebuild = db.prepare("SELECT id, interessado FROM processos WHERE interessado IS NOT NULL AND interessado <> '' AND servidor_id IS NULL").all();
    for (const p of rebuild) { try { vincularServidor(p.id, p.interessado, null); } catch { /* ignora */ } }
    setConfig('interessados_limpos_v2', '1');
  } catch { /* ignora */ }
}

// Um valor com cara de NÚMERO DE PROCESSO SEI (não pode ser matrícula/CPF).
export function pareceNumeroProcesso(v) {
  const s = String(v || '');
  return /\/\s*(19|20)\d{2}\s*-\s*\d/.test(s) || /\d{5,}\.\d{4,}\/\d{4}/.test(s) || s.replace(/\D/g, '').length >= 14;
}

// Correção única: apaga matrícula/CPF/identidade que foram gravados por engano
// com o NÚMERO DO PROCESSO (leituras antigas de OCR). Assim o próximo "Buscar
// conteúdo" preenche o valor certo (o campo volta a ficar vazio).
if (getConfig('matriculas_limpas_v1') !== '1') {
  try {
    const campos = ['matricula', 'cpf', 'identidade', 'nit', 'pis_pasep', 'titulo_eleitor'];
    const rows = db.prepare(`SELECT id, ${campos.join(', ')} FROM servidores`).all();
    const upd = db.prepare(`UPDATE servidores SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`);
    for (const r of rows) {
      let mudou = false;
      const vals = campos.map((c) => {
        if (r[c] && pareceNumeroProcesso(r[c])) { mudou = true; return null; }
        return r[c];
      });
      if (mudou) upd.run(...vals, r.id);
    }
    setConfig('matriculas_limpas_v1', '1');
  } catch { /* ignora */ }
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
