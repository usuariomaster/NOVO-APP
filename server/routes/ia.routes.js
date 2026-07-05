// Rotas da IA embarcada: cofre de tokens (chave da Anthropic),
// extração da ficha funcional e geração de PPP/LTCAT/PCMSO por CBO.
import { Router } from 'express';
import db from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';
import {
  temChave, modeloAtual, guardarChave, definirModelo, testarChave,
  extrairFichaFuncional, extrairFichaDeArquivos, enriquecerPorCBO, sugerirDespacho,
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

// Extrai a ficha funcional -> campos do servidor (não salva).
// Aceita { texto } (colado) OU { arquivos:[{base64,mime}] } (OCR por imagem/PDF).
router.post('/extrair-ficha', exigirPapel('operador', 'admin', 'admin_master', 'perito', 'perito_admin'), async (req, res) => {
  const { texto, arquivos } = req.body || {};
  try {
    let out;
    if (Array.isArray(arquivos) && arquivos.length) {
      out = await extrairFichaDeArquivos(arquivos);
    } else if (texto && String(texto).trim().length >= 20) {
      out = await extrairFichaFuncional(texto);
    } else {
      return res.status(400).json({ erro: 'Cole o texto ou anexe uma imagem/PDF da ficha.' });
    }
    res.json({ campos: out.campos, temFicha: out.temFicha });
  } catch (e) {
    res.status(502).json({ erro: e.message });
  }
});

// Sugere a minuta do despacho do perito para um processo.
router.post('/despacho/:processoId', exigirPapel('perito', 'perito_admin', 'operador', 'admin', 'admin_master'), async (req, res) => {
  const p = db.prepare('SELECT * FROM processos WHERE id = ?').get(req.params.processoId);
  if (!p) return res.status(404).json({ erro: 'Processo não encontrado' });
  // Junta o texto dos documentos já lidos (se houver) como contexto.
  const docs = db.prepare("SELECT tipo, conteudo FROM documentos WHERE processo_id = ? AND conteudo IS NOT NULL AND conteudo <> ''").all(p.id);
  const contexto = docs.map((d) => `[${d.tipo || 'doc'}] ${d.conteudo}`).join('\n\n').slice(0, 6000);
  try {
    const r = await sugerirDespacho({
      numeroSei: p.numero_sei, interessado: p.interessado, assunto: p.especificacao, tipo: p.tipo,
      contexto, decisao: req.body?.decisao,
    });
    res.json(r);
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
