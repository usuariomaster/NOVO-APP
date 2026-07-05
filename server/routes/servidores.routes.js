// Cadastro de servidores periciados: ficha funcional, processos, afastamentos
// (com CID), prontuário (documentos) e base para o PPP.
import { Router } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import db, { ehSimulacao } from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';
import { descriptografar } from '../sei/crypto.js';
import { capturarFichaNoSei } from '../sei/detail.js';
import { extrairFichaDeArquivos } from '../services/ia.js';
import { timbreHTML, TIMBRE_CSS } from '../services/timbre.js';
import { htmlBIM, htmlComprovanteServidor } from '../services/documentosPericia.js';

const router = Router();
router.use(exigirLogin);
router.use(exigirPapel('operador', 'admin', 'admin_master', 'perito', 'perito_admin'));

const DIR_PRONT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'prontuarios');
const DIR_DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'documentos');

const CAMPOS = ['nome', 'cpf', 'matricula', 'cargo', 'funcao', 'lotacao', 'secretaria', 'setor',
  'data_nascimento', 'sexo', 'data_admissao', 'vinculo', 'atividades', 'agentes_nocivos', 'observacoes',
  // Ficha funcional completa (RH)
  'pai', 'mae', 'grau_instrucao', 'naturalidade', 'uf_naturalidade', 'nacionalidade', 'estado_civil',
  'identidade', 'identidade_emissao', 'identidade_orgao', 'titulo_eleitor', 'zona', 'secao',
  'ctps', 'ctps_serie', 'ctps_uf', 'nit', 'pis_pasep',
  'situacao', 'data_demissao', 'tipo_admissao', 'data_publicacao', 'num_portaria', 'data_concurso',
  'data_posse', 'data_exercicio', 'tipo_salario', 'regime_previdencia', 'carga_horaria', 'vinculo_empregaticio',
  'unidade_trabalho', 'classificacao_funcional', 'simbologia', 'cbo', 'cbo_mt',
  'endereco', 'numero_ende', 'bairro', 'municipio', 'uf_ende', 'cep', 'complemento', 'telefone', 'celular', 'email',
  'prontuario',
  // Gerados por IA
  'ppp_atividades', 'ltcat', 'pcmso'];

// Lista de servidores (com contagem de processos e afastamentos).
router.get('/', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const linhas = db.prepare(
    `SELECT s.id, s.nome, s.cpf, s.matricula, s.cargo, s.ficha_atualizada_em,
       (SELECT COUNT(*) FROM processos p WHERE p.servidor_id = s.id) AS n_processos,
       (SELECT COUNT(*) FROM afastamentos a WHERE a.servidor_id = s.id) AS n_afastamentos,
       (SELECT COUNT(*) FROM processos p WHERE p.servidor_id = s.id AND p.ficha_status = 'ausente') AS n_sem_ficha
     FROM servidores s
     ${q ? 'WHERE s.nome LIKE ? OR s.cpf LIKE ? OR s.matricula LIKE ?' : ''}
     ORDER BY s.nome`
  ).all(...(q ? [q, q, q] : []));
  res.json(linhas);
});

// Ficha completa do servidor (dashboard).
router.get('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ erro: 'Servidor não encontrado' });
  s.processos = db.prepare(
    `SELECT id, numero_sei, tipo, especificacao, status, fisico, data_entrada, data_encaminhado, data_autuacao, arquivado, pdf_processo
     FROM processos WHERE servidor_id = ? ORDER BY arquivado, id DESC`
  ).all(s.id);
  s.afastamentos = db.prepare('SELECT * FROM afastamentos WHERE servidor_id = ? ORDER BY data_inicio DESC, id DESC').all(s.id);
  s.documentos = db.prepare('SELECT id, tipo, nome_orig, criado_em FROM prontuario_docs WHERE servidor_id = ? ORDER BY id DESC').all(s.id);
  // total de dias afastado
  s.total_dias_afastado = s.afastamentos.reduce((t, a) => t + (a.dias || 0), 0);
  res.json(s);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ erro: 'Informe o nome' });
  const cols = CAMPOS.filter((c) => b[c] !== undefined);
  const info = db.prepare(
    `INSERT INTO servidores (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map((c) => b[c] || null));
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ erro: 'Servidor não encontrado' });
  const b = req.body || {};
  const cols = CAMPOS.filter((c) => b[c] !== undefined);
  if (cols.length) {
    // Marca quando a ficha funcional foi atualizada (para o alerta de revisão).
    const mexeuFicha = cols.some((c) => !['ppp_atividades', 'ltcat', 'pcmso', 'observacoes'].includes(c));
    const extra = mexeuFicha ? ", ficha_atualizada_em = datetime('now')" : '';
    db.prepare(`UPDATE servidores SET ${cols.map((c) => `${c} = ?`).join(', ')}${extra} WHERE id = ?`)
      .run(...cols.map((c) => b[c] || null), s.id);
  }
  res.json({ ok: true });
});

router.delete('/:id', exigirPapel('operador', 'admin', 'admin_master'), (req, res) => {
  db.prepare('DELETE FROM servidores WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 🤖 Busca a ficha funcional AUTOMÁTICA no SEI: abre o processo do servidor,
// tira print dos documentos com cara de ficha, roda OCR (IA) e preenche.
router.post('/:id/buscar-ficha-sei', exigirPapel('operador', 'admin', 'admin_master', 'perito', 'perito_admin'), async (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ erro: 'Servidor não encontrado' });

  // Escolhe um processo do servidor no SEI (não físico, com número).
  const proc = db.prepare(
    `SELECT * FROM processos WHERE servidor_id = ? AND fisico = 0 AND numero_sei IS NOT NULL
     ${req.body?.processo_id ? 'AND id = ?' : ''} ORDER BY id DESC LIMIT 1`
  ).get(...(req.body?.processo_id ? [s.id, req.body.processo_id] : [s.id]));
  if (!proc) return res.status(400).json({ erro: 'Este servidor não tem processo do SEI para buscar a ficha.' });

  const mock = ehSimulacao();
  const cfgRow = db.prepare('SELECT * FROM sei_config ORDER BY padrao DESC, id LIMIT 1').get();
  if (!cfgRow && !mock) return res.status(400).json({ erro: 'Cadastre a configuração do SEI primeiro.' });
  const cfg = cfgRow ? {
    base_url: cfgRow.base_url, orgao: cfgRow.orgao, unidade: cfgRow.unidade,
    usuario: cfgRow.usuario, senha: descriptografar(cfgRow.senha_cripto),
  } : { base_url: process.env.SEI_BASE_URL || '' };

  // Fonte preferida: o PDF do processo já arquivado (páginas reais). Se não
  // existir, captura as imagens da ficha ao vivo no SEI.
  let arquivos = [];
  let origem = '';
  if (proc.pdf_processo) {
    const pdfPath = join(DIR_DOCS, `proc-${proc.id}`, proc.pdf_processo);
    if (existsSync(pdfPath)) { try { arquivos = [{ base64: readFileSync(pdfPath).toString('base64'), mime: 'application/pdf' }]; origem = 'PDF do processo'; } catch { /* */ } }
  }
  if (!arquivos.length) {
    try {
      const cap = await capturarFichaNoSei(cfg, { numeroSei: proc.numero_sei }, mock);
      arquivos = (cap.imagens || []).map((b) => ({ base64: b, mime: 'image/png' }));
      origem = 'imagens do SEI';
      if (!arquivos.length) return res.status(502).json({ erro: `Não encontrei a ficha no processo. ${cap.motivo || ''}`.trim() });
    } catch (e) {
      return res.status(502).json({ erro: `Erro ao abrir o processo no SEI: ${e.message}`, debug: e.debug || null });
    }
  }

  let campos, temFicha, afastamentos;
  try {
    ({ campos, temFicha, afastamentos } = await extrairFichaDeArquivos(arquivos, { numeroSei: proc.numero_sei }));
  } catch (e) {
    const msg = /não configurada/i.test(e.message) ? 'Configure a chave da IA em "Configuração da IA".' : e.message;
    return res.status(502).json({ erro: `OCR falhou: ${msg}` });
  }

  // Marca no processo se a ficha funcional estava presente (flag no dashboard).
  db.prepare('UPDATE processos SET ficha_status = ? WHERE id = ?').run(temFicha === false ? 'ausente' : 'ok', proc.id);

  // Preenche APENAS os campos que estão vazios no cadastro (não sobrescreve o
  // que já foi conferido). Retorna também tudo que a IA leu, para a tela.
  const cols = CAMPOS.filter((c) => campos[c] !== undefined && campos[c] !== '');
  const aGravar = cols.filter((c) => !s[c] || String(s[c]).trim() === '');
  if (aGravar.length) {
    db.prepare(`UPDATE servidores SET ${aGravar.map((c) => `${c} = ?`).join(', ')}, ficha_atualizada_em = datetime('now') WHERE id = ?`)
      .run(...aGravar.map((c) => campos[c]), s.id);
  }
  // Registra afastamentos/licenças citados nos despachos (sem duplicar).
  let nAfast = 0;
  const existeAf = db.prepare("SELECT id FROM afastamentos WHERE servidor_id = ? AND IFNULL(data_inicio,'') = ? AND IFNULL(tipo,'') = ?");
  for (const a of (afastamentos || [])) {
    if (existeAf.get(s.id, a.data_inicio || '', a.tipo || '')) continue;
    let dias = null;
    if (a.data_inicio && a.data_fim) { const di = new Date(a.data_inicio), df = new Date(a.data_fim); if (!isNaN(di) && !isNaN(df)) dias = Math.max(0, Math.round((df - di) / 86400000) + 1); }
    db.prepare('INSERT INTO afastamentos (servidor_id, processo_id, tipo, cid, conclusao, data_inicio, data_fim, dias, descricao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.id, proc.id, a.tipo || null, a.cid || null, a.conclusao || null, a.data_inicio || null, a.data_fim || null, dias, a.descricao || null);
    nAfast++;
  }
  res.json({ ok: true, campos, preenchidos: aGravar.length, lidos: cols.length, origem, temFicha, afastamentos: nAfast });
});

// ---- Ocorrências / BIM (Boletim de Inspeção Médica), com CID ----
router.post('/:id/afastamentos', (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ erro: 'Servidor não encontrado' });
  const { tipo, cid, cid2, data_inicio, data_fim, dias, descricao, processo_id,
    data_pericia, conclusao, perito, bim_numero,
    natureza, beneficiario, remunerado, bim_anterior, licenca_anterior_dias } = req.body || {};
  // calcula dias se não informado
  let d = dias ? parseInt(dias, 10) : null;
  if (!d && data_inicio && data_fim) {
    const di = new Date(data_inicio), df = new Date(data_fim);
    if (!isNaN(di) && !isNaN(df)) d = Math.max(0, Math.round((df - di) / 86400000) + 1);
  }
  const info = db.prepare(
    `INSERT INTO afastamentos (servidor_id, processo_id, tipo, cid, cid2, data_inicio, data_fim, dias, descricao,
       data_pericia, conclusao, perito, bim_numero, natureza, beneficiario, remunerado, bim_anterior, licenca_anterior_dias)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(s.id, processo_id || null, tipo || null, cid || null, cid2 || null, data_inicio || null, data_fim || null, d,
    descricao || null, data_pericia || null, conclusao || null, perito || null, bim_numero || null,
    natureza || null, beneficiario || null, remunerado || null, bim_anterior || null,
    licenca_anterior_dias ? parseInt(licenca_anterior_dias, 10) : null);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Atualiza uma ocorrência/BIM.
router.put('/:id/afastamentos/:aid', (req, res) => {
  const campos = ['tipo', 'cid', 'cid2', 'data_inicio', 'data_fim', 'dias', 'descricao', 'processo_id', 'data_pericia', 'conclusao', 'perito', 'bim_numero', 'natureza', 'beneficiario', 'remunerado', 'bim_anterior', 'licenca_anterior_dias'];
  const b = req.body || {};
  const cols = campos.filter((c) => b[c] !== undefined);
  if (cols.length) {
    db.prepare(`UPDATE afastamentos SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND servidor_id = ?`)
      .run(...cols.map((c) => b[c] || null), req.params.aid, req.params.id);
  }
  res.json({ ok: true });
});

router.delete('/:id/afastamentos/:aid', (req, res) => {
  db.prepare('DELETE FROM afastamentos WHERE id = ? AND servidor_id = ?').run(req.params.aid, req.params.id);
  res.json({ ok: true });
});

// BIM (Boletim de Inspeção Médica) — formulário oficial imprimível.
router.get('/:id/bim/:aid', (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  const a = db.prepare('SELECT * FROM afastamentos WHERE id = ? AND servidor_id = ?').get(req.params.aid, req.params.id);
  if (!s || !a) return res.status(404).send('Boletim não encontrado');
  const proc = a.processo_id ? db.prepare('SELECT numero_sei FROM processos WHERE id = ?').get(a.processo_id) : null;
  res.set('Content-Type', 'text/html; charset=utf-8').send(htmlBIM(s, a, proc));
});

// Comprovante ao servidor (resposta oficial com o texto-padrão).
router.get('/:id/comprovante/:aid', (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  const a = db.prepare('SELECT * FROM afastamentos WHERE id = ? AND servidor_id = ?').get(req.params.aid, req.params.id);
  if (!s || !a) return res.status(404).send('Comprovante não encontrado');
  const proc = a.processo_id ? db.prepare('SELECT numero_sei FROM processos WHERE id = ?').get(a.processo_id) : null;
  res.set('Content-Type', 'text/html; charset=utf-8').send(htmlComprovanteServidor(s, a, proc));
});

// ---- Prontuário (documentos médicos) ----
router.post('/:id/documentos', (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ erro: 'Servidor não encontrado' });
  const { tipo, nome_orig, dados_base64 } = req.body || {};
  if (!tipo || !dados_base64) return res.status(400).json({ erro: 'Informe o tipo e o arquivo' });
  const dir = join(DIR_PRONT, String(s.id));
  mkdirSync(dir, { recursive: true });
  const base = String(dados_base64).includes(',') ? String(dados_base64).split(',')[1] : String(dados_base64);
  const buf = Buffer.from(base, 'base64');
  if (buf.length > 30 * 1024 * 1024) return res.status(413).json({ erro: 'Arquivo muito grande (máx. 30MB)' });
  const ext = (nome_orig && nome_orig.includes('.')) ? nome_orig.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 5) : 'bin';
  const arquivo = `pront-${Date.now()}.${ext}`;
  writeFileSync(join(dir, arquivo), buf);
  const info = db.prepare('INSERT INTO prontuario_docs (servidor_id, tipo, arquivo, nome_orig) VALUES (?, ?, ?, ?)')
    .run(s.id, String(tipo).trim(), arquivo, nome_orig || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/:id/documentos/:docId', (req, res) => {
  const doc = db.prepare('SELECT * FROM prontuario_docs WHERE id = ? AND servidor_id = ?').get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ erro: 'Documento não encontrado' });
  const nome = String(doc.arquivo).replace(/[^a-zA-Z0-9._-]/g, '');
  const caminho = join(DIR_PRONT, String(req.params.id), nome);
  if (!existsSync(caminho)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
  res.sendFile(caminho);
});

router.delete('/:id/documentos/:docId', (req, res) => {
  db.prepare('DELETE FROM prontuario_docs WHERE id = ? AND servidor_id = ?').run(req.params.docId, req.params.id);
  res.json({ ok: true });
});

// ---- PPP / relatório (dados consolidados, imprimível) ----
router.get('/:id/ppp', (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).send('Servidor não encontrado');
  const afast = db.prepare('SELECT * FROM afastamentos WHERE servidor_id = ? ORDER BY data_inicio').all(s.id);
  const procs = db.prepare('SELECT numero_sei, tipo, especificacao, status FROM processos WHERE servidor_id = ?').all(s.id);
  const esc = (x) => String(x ?? '—').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const linhaAf = afast.map((a) =>
    `<tr><td>${esc(a.data_inicio)}</td><td>${esc(a.data_fim)}</td><td>${esc(a.dias)}</td><td>${esc(a.cid)}${a.cid2 ? '/' + esc(a.cid2) : ''}</td><td>${esc(a.tipo)}</td></tr>`
  ).join('');
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Ficha / PPP — ${esc(s.nome)}</title>
    <style>body{font-family:Arial,sans-serif;max-width:820px;margin:28px auto;padding:0 20px;color:#111}
    h1{font-size:17px;text-align:center}h2{font-size:15px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:24px}
    table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #999;padding:5px 7px;font-size:12px;text-align:left}
    th{background:#eee}dl{display:grid;grid-template-columns:180px 1fr;gap:4px 10px;font-size:13px}dt{color:#555}
    ${TIMBRE_CSS}
    @media print{.noprint{display:none}}</style></head><body>
    ${timbreHTML('Perícia Médica — Ficha Funcional / PPP')}
    <h1>FICHA FUNCIONAL / DADOS PARA PPP</h1>
    <h2>Servidor</h2>
    <dl>
      <dt>Nome</dt><dd>${esc(s.nome)}</dd><dt>CPF</dt><dd>${esc(s.cpf)}</dd>
      <dt>Matrícula</dt><dd>${esc(s.matricula)}</dd><dt>Cargo</dt><dd>${esc(s.cargo)}</dd>
      <dt>Função</dt><dd>${esc(s.funcao)}</dd><dt>Lotação/Secretaria</dt><dd>${esc(s.lotacao)} ${esc(s.secretaria)}</dd>
      <dt>Setor</dt><dd>${esc(s.setor)}</dd><dt>Admissão</dt><dd>${esc(s.data_admissao)}</dd>
      <dt>Atividades</dt><dd>${esc(s.atividades)}</dd><dt>Agentes nocivos</dt><dd>${esc(s.agentes_nocivos)}</dd>
    </dl>
    <h2>Afastamentos</h2>
    <table><thead><tr><th>Início</th><th>Fim</th><th>Dias</th><th>CID</th><th>Tipo</th></tr></thead>
      <tbody>${linhaAf || '<tr><td colspan="5">Nenhum registrado</td></tr>'}</tbody></table>
    <p><b>Total de dias afastado:</b> ${afast.reduce((t, a) => t + (a.dias || 0), 0)}</p>
    <h2>Processos na perícia</h2>
    <table><thead><tr><th>Processo</th><th>Tipo</th><th>Assunto</th><th>Status</th></tr></thead>
      <tbody>${procs.map((p) => `<tr><td>${esc(p.numero_sei)}</td><td>${esc(p.tipo)}</td><td>${esc(p.especificacao)}</td><td>${esc(p.status)}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}</tbody></table>
    <div class="noprint" style="text-align:center;margin-top:24px"><button onclick="print()" style="padding:10px 20px">🖨 Imprimir</button></div>
  </body></html>`);
});

export default router;
