// ============================================================
// Porta 1 — WhatsApp (Natasha). API server-to-server que a Natasha
// (VPS natasha.drcesarferreira.com.br) chama quando um servidor manda
// um documento pelo WhatsApp. Reproduz o contrato já usado pela Natasha
// com o sistema de perícia (GRO): ação na query (?acao=…), autenticação
// por header X-Natasha-Token, payload/retorno em JSON.
//
// Config na Natasha (/etc/natasha/config.json):
//   "gro": { "url": "http://SEU_HOST/api/natasha", "token": "<mesmo token>" }
// ============================================================
import { Router } from 'express';
import db, { getConfig } from '../db.js';

const router = Router();

// Token compartilhado: env NATASHA_TOKEN ou config 'natasha_token' (admin).
function tokenOk(req) {
  const esperado = process.env.NATASHA_TOKEN || getConfig('natasha_token') || '';
  const veio = req.get('X-Natasha-Token') || req.query.token || '';
  return esperado && veio && String(veio) === String(esperado);
}

router.use((req, res, next) => {
  if (!tokenOk(req)) return res.status(401).json({ ok: false, erro: 'token inválido' });
  next();
});

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Encontra/atualiza o servidor por CPF (cria se não existir).
function upsertServidor({ cpf, nome, data_nascimento, sexo, matriculas, lotacoes }) {
  const cpfLimpo = soDigitos(cpf);
  let s = cpfLimpo ? db.prepare(`SELECT * FROM servidores WHERE replace(replace(cpf,'.',''),'-','') = ?`).get(cpfLimpo) : null;
  if (!s && nome) s = db.prepare('SELECT * FROM servidores WHERE upper(nome) = upper(?)').get(String(nome).trim());
  const matr = Array.isArray(matriculas) ? matriculas.join(', ') : (matriculas || '');
  const lot = Array.isArray(lotacoes) ? lotacoes.join(', ') : (lotacoes || '');
  if (!s) {
    const info = db.prepare(
      `INSERT INTO servidores (nome, cpf, data_nascimento, sexo, matricula, secretaria) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(String(nome || '').trim() || 'Servidor (WhatsApp)', cpf || null, data_nascimento || null, sexo || null,
      matr || null, lot || null);
    s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(info.lastInsertRowid);
  } else {
    // completa apenas o que está vazio (não sobrescreve dado conferido)
    db.prepare(
      `UPDATE servidores SET
         nome = COALESCE(NULLIF(nome,''), ?), data_nascimento = COALESCE(data_nascimento, ?),
         sexo = COALESCE(sexo, ?), matricula = COALESCE(NULLIF(matricula,''), ?),
         secretaria = COALESCE(NULLIF(secretaria,''), ?)
       WHERE id = ?`
    ).run(nome || null, data_nascimento || null, sexo || null, matr || null, lot || null, s.id);
    s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(s.id);
  }
  return s;
}

// Consulta de servidor por CPF (para a Natasha responder "seus dados").
router.get('/', (req, res) => {
  const acao = req.query.acao;
  if (acao === 'servidor') {
    const s = db.prepare(`SELECT * FROM servidores WHERE replace(replace(cpf,'.',''),'-','') = ?`).get(soDigitos(req.query.cpf));
    if (!s) return res.json({ ok: false, erro: 'servidor não encontrado' });
    return res.json({ ok: true, servidor: { id: s.id, nome: s.nome, cpf: s.cpf, matricula: s.matricula, cargo: s.cargo, secretaria: s.secretaria } });
  }
  if (acao === 'afastamentos') {
    const s = db.prepare(`SELECT id FROM servidores WHERE replace(replace(cpf,'.',''),'-','') = ?`).get(soDigitos(req.query.cpf));
    if (!s) return res.json({ ok: false, erro: 'servidor não encontrado' });
    const af = db.prepare('SELECT tipo, cid, data_inicio, data_fim, dias, conclusao FROM afastamentos WHERE servidor_id = ? ORDER BY data_inicio DESC').all(s.id);
    return res.json({ ok: true, afastamentos: af });
  }
  res.json({ ok: true, servico: 'SisPerícia · porta WhatsApp (Natasha)', acoes: ['servidor', 'afastamentos', 'pericia_intake', 'anexo'] });
});

router.post('/', (req, res) => {
  const acao = req.query.acao;
  const b = req.body || {};

  // Entrada de perícia: cria/atualiza servidor e abre o caso na Caixa de entrada.
  if (acao === 'pericia_intake') {
    if (!b.cpf && !b.nome) return res.status(400).json({ ok: false, erro: 'informe cpf ou nome' });
    const s = upsertServidor(b);
    const ano = new Date().toISOString().slice(0, 4);
    const seq = db.prepare("SELECT COUNT(*) AS c FROM processos WHERE canal = 'whatsapp'").get().c + 1;
    const numero = `WA-${ano}-${String(seq).padStart(4, '0')}`;
    const info = db.prepare(
      `INSERT INTO processos (numero_sei, interessado, especificacao, unidade_origem, canal, fisico, status, triado, servidor_id, data_entrada)
       VALUES (?, ?, ?, 'WhatsApp (Natasha)', 'whatsapp', 1, 'em_controle', 0, ?, date('now'))`
    ).run(numero, s.nome, b.assunto || b.mensagem || 'Solicitação recebida por WhatsApp', s.id);
    const procId = info.lastInsertRowid;
    // Se veio texto/OCR, guarda como documento do processo.
    if (b.texto || b.ocr || b.documento) {
      db.prepare('INSERT INTO documentos (processo_id, tipo, conteudo) VALUES (?, ?, ?)')
        .run(procId, b.tipo_documento || 'Documento (WhatsApp/OCR)', String(b.texto || b.ocr || b.documento));
    }
    return res.json({ ok: true, pericia_id: procId, servidor: { id: s.id, nome: s.nome, cpf: s.cpf }, sinais: [], nota: 'caso aberto na caixa de entrada' });
  }

  // Anexa um documento (texto/OCR) a um caso já aberto.
  if (acao === 'anexo') {
    const pid = b.pericia_id || b.processo_id;
    const proc = pid ? db.prepare('SELECT id FROM processos WHERE id = ?').get(pid) : null;
    if (!proc) return res.status(404).json({ ok: false, erro: 'caso não encontrado' });
    db.prepare('INSERT INTO documentos (processo_id, tipo, conteudo) VALUES (?, ?, ?)')
      .run(proc.id, b.tipo || 'Anexo (WhatsApp/OCR)', String(b.texto || b.ocr || b.conteudo || ''));
    return res.json({ ok: true, pericia_id: proc.id });
  }

  // Upsert de servidor sem abrir caso.
  if (acao === 'servidor_upsert') {
    const s = upsertServidor(b);
    return res.json({ ok: true, servidor: { id: s.id, nome: s.nome, cpf: s.cpf } });
  }

  res.status(400).json({ ok: false, erro: 'ação desconhecida' });
});

export default router;
