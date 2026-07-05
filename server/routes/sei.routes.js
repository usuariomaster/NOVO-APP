import { Router } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import db, { registrarHistorico, ehSimulacao, getConfig, setConfig, vincularServidor } from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';
import { criptografar, descriptografar } from '../sei/crypto.js';
import { extrairProcessos } from '../sei/scraper.js';

const router = Router();
router.use(exigirLogin);

const DIR_DIAG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'comprovantes');

// ---- Modo de operação (simulação x SEI real) ----
router.get('/modo', (req, res) => {
  res.json({ simulacao: ehSimulacao(), travadoPorEnv: process.env.SEI_MOCK !== undefined && process.env.SEI_MOCK !== '' });
});

router.post('/modo', exigirPapel('admin'), (req, res) => {
  const { simulacao } = req.body || {};
  setConfig('modo_simulacao', simulacao ? '1' : '0');
  res.json({ simulacao: ehSimulacao() });
});

// Serve um print/arquivo de diagnóstico do robô — somente admin.
router.get('/debug/:nome', exigirPapel('admin'), (req, res) => {
  const nome = String(req.params.nome).replace(/[^a-zA-Z0-9._-]/g, '');
  const caminho = join(DIR_DIAG, nome);
  if (!existsSync(caminho)) {
    return res.status(404).json({ erro: 'Diagnóstico ainda não gerado. Rode uma extração primeiro.' });
  }
  res.sendFile(caminho);
});

// ---- Configurações do SEI (credenciais) — somente admin ----
router.get('/config', exigirPapel('admin'), (req, res) => {
  const configs = db
    .prepare(
      `SELECT id, apelido, base_url, orgao, unidade, usuario, padrao,
              escrita, tipo_documento, nivel_acesso, unidade_destino, assinar, cargo, criado_em
       FROM sei_config ORDER BY padrao DESC, apelido`
    )
    .all();
  res.json(configs); // nunca devolve a senha
});

router.post('/config', exigirPapel('admin'), (req, res) => {
  const {
    apelido, base_url, orgao, unidade, usuario, senha, padrao,
    escrita, tipo_documento, nivel_acesso, unidade_destino, assinar, cargo, gerar_pdf,
  } = req.body || {};
  if (!apelido || !base_url || !usuario || !senha) {
    return res.status(400).json({ erro: 'Informe apelido, URL base, usuário e senha' });
  }
  if (padrao) db.prepare('UPDATE sei_config SET padrao = 0').run();
  const info = db
    .prepare(
      `INSERT INTO sei_config
         (apelido, base_url, orgao, unidade, usuario, senha_cripto, padrao,
          escrita, tipo_documento, nivel_acesso, unidade_destino, assinar, cargo, gerar_pdf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      apelido.trim(),
      base_url.replace(/\/+$/, ''),
      orgao || null,
      unidade || null,
      usuario.trim(),
      criptografar(senha),
      padrao ? 1 : 0,
      escrita === false ? 0 : 1,
      (tipo_documento || 'Despacho').trim(),
      (nivel_acesso || 'publico').trim(),
      unidade_destino || null,
      assinar === false ? 0 : 1,
      cargo || null,
      gerar_pdf ? 1 : 0
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/config/:id', exigirPapel('admin'), (req, res) => {
  db.prepare('DELETE FROM sei_config WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Extração de processos — operador ou admin ----
router.post('/extrair', exigirPapel('operador', 'admin'), async (req, res) => {
  const { config_id } = req.body || {};
  const cfgRow = config_id
    ? db.prepare('SELECT * FROM sei_config WHERE id = ?').get(config_id)
    : db.prepare('SELECT * FROM sei_config ORDER BY padrao DESC, id LIMIT 1').get();

  const mock = ehSimulacao();
  if (!cfgRow && !mock) {
    return res.status(400).json({ erro: 'Nenhuma configuração de SEI cadastrada. Cadastre em Configuração do SEI.' });
  }

  const cfg = cfgRow
    ? {
        apelido: cfgRow.apelido,
        base_url: cfgRow.base_url,
        orgao: cfgRow.orgao,
        unidade: cfgRow.unidade,
        usuario: cfgRow.usuario,
        senha: descriptografar(cfgRow.senha_cripto),
      }
    : { apelido: 'Simulação', base_url: process.env.SEI_BASE_URL || '' };

  let resultado;
  try {
    resultado = await extrairProcessos(cfg, mock);
  } catch (e) {
    return res.status(502).json({ erro: `Erro ao acessar o SEI: ${e.message}`, debug: e.debug || null });
  }

  // Persiste: insere novos, ignora já existentes (por numero_sei)
  const inserirProc = db.prepare(
    `INSERT INTO processos (numero_sei, tipo, interessado, especificacao, data_autuacao, unidade_origem, link_sei, status, operador_id, data_entrada)
     VALUES (@numero_sei, @tipo, @interessado, @especificacao, @data_autuacao, @unidade_origem, @link_sei, 'em_controle', @operador_id, date('now'))`
  );
  const inserirDoc = db.prepare(
    `INSERT INTO documentos (processo_id, numero, tipo, data, link_sei) VALUES (?, ?, ?, ?, ?)`
  );
  const existe = db.prepare('SELECT id FROM processos WHERE numero_sei = ?');

  let novos = 0;
  let ignorados = 0;
  let comNome = 0;
  const tx = db.transaction((lista) => {
    for (const p of lista) {
      if (p.interessado) comNome++;
      if (existe.get(p.numero_sei)) {
        ignorados++;
        continue;
      }
      const info = inserirProc.run({
        numero_sei: p.numero_sei,
        tipo: p.tipo ?? null,
        interessado: p.interessado ?? null,
        especificacao: p.especificacao ?? null,
        data_autuacao: p.data_autuacao ?? null,
        unidade_origem: p.unidade_origem ?? null,
        link_sei: p.link_sei ?? null,
        operador_id: req.usuario.id,
      });
      // Se o nome já veio na lista do SEI, cria/vincula o servidor de imediato.
      if (p.interessado) { try { vincularServidor(info.lastInsertRowid, p.interessado, null); } catch { /* ignora */ } }
      for (const d of p.documentos || []) {
        inserirDoc.run(info.lastInsertRowid, d.numero ?? null, d.tipo ?? null, d.data ?? null, d.link_sei ?? null);
      }
      registrarHistorico({
        processoId: info.lastInsertRowid,
        usuario: req.usuario,
        acao: 'extraido_sei',
        detalhe: `Importado do SEI (${resultado.modo})`,
      });
      novos++;
    }
  });
  tx(resultado.processos);

  res.json({
    modo: resultado.modo,
    total: resultado.processos.length,
    novos,
    ignorados,
    comNome,
    porUnidade: resultado.porUnidade || null,
    debug: resultado.debug || null,
    amostra: resultado.amostra || null,
    unidadesEncontradas: resultado.unidadesEncontradas || null,
    unidadesDebug: resultado.unidadesDebug || null,
    interessadosDebug: resultado.interessadosDebug || null,
  });
});

export default router;
