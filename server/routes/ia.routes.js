// Rotas da IA embarcada: cofre de tokens (chave da Anthropic),
// extração da ficha funcional e geração de PPP/LTCAT/PCMSO por CBO.
import { Router } from 'express';
import db from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';
import {
  temChave, modeloAtual, guardarChave, definirModelo, testarChave,
  extrairFichaFuncional, enriquecerPorCBO,
} from '../services/ia.js';

const router = Router();
router.use(exigirLogin);

// Status do cofre (qualquer usuário logado pode saber se a IA está ligada).
router.get('/status', (req, res) => {
  res.json({ configurado: temChave(), modelo: modeloAtual() });
});

// Cadastro/atualização da chave — somente admin/admin_master.
router.post('/config', exigirPapel('admin', 'admin_master'), (req, res) => {
  const { chave, modelo } = req.body || {};
  if (chave) guardarChave(chave);
  if (modelo) definirModelo(modelo);
  if (!chave && !temChave()) return res.status(400).json({ erro: 'Informe a chave da API.' });
  res.json({ configurado: temChave(), modelo: modeloAtual() });
});

router.post('/testar', exigirPapel('admin', 'admin_master'), async (req, res) => {
  try {
    const r = await testarChave();
    res.json(r);
  } catch (e) {
    res.status(502).json({ erro: e.message });
  }
});

// Extrai a ficha funcional colada em texto -> campos do servidor (não salva).
router.post('/extrair-ficha', exigirPapel('operador', 'admin', 'admin_master', 'perito', 'perito_admin'), async (req, res) => {
  const { texto } = req.body || {};
  if (!texto || String(texto).trim().length < 20) {
    return res.status(400).json({ erro: 'Cole o texto da ficha funcional.' });
  }
  try {
    const campos = await extrairFichaFuncional(texto);
    res.json({ campos });
  } catch (e) {
    res.status(502).json({ erro: e.message });
  }
});

// Gera PPP/LTCAT/PCMSO a partir do CBO e salva no servidor.
router.post('/servidor/:id/cbo', exigirPapel('operador', 'admin', 'admin_master', 'perito', 'perito_admin'), async (req, res) => {
  const s = db.prepare('SELECT * FROM servidores WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ erro: 'Servidor não encontrado' });
  const cbo = (req.body && req.body.cbo) || s.cbo;
  if (!cbo && !s.cargo && !s.classificacao_funcional) {
    return res.status(400).json({ erro: 'Informe o CBO ou o cargo do servidor antes de gerar.' });
  }
  try {
    const r = await enriquecerPorCBO({
      cbo,
      cargo: s.cargo || s.classificacao_funcional,
      atividades: s.atividades,
      secretaria: s.secretaria,
      lotacao: s.lotacao,
    });
    db.prepare(
      `UPDATE servidores SET ppp_atividades = ?, ltcat = ?, pcmso = ?,
         agentes_nocivos = COALESCE(NULLIF(agentes_nocivos, ''), ?),
         ia_atualizado_em = datetime('now') WHERE id = ?`
    ).run(r.ppp_atividades, r.ltcat, r.pcmso, r.agentes_nocivos, s.id);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(502).json({ erro: e.message });
  }
});

export default router;
