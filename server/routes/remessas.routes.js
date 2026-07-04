// Remessas do mensageiro: processos FÍSICOS conferidos que são enviados às
// secretarias por mensageiro, com relatório assinado e baixa por data de retirada.
import { Router } from 'express';
import db, { registrarHistorico } from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';

const router = Router();
router.use(exigirLogin);
router.use(exigirPapel('operador', 'admin'));

// Processos físicos conferidos, prontos para enviar (fora de remessa aberta).
router.get('/prontos', (req, res) => {
  const linhas = db.prepare(
    `SELECT p.id, p.numero_sei, p.interessado, p.especificacao, p.secretaria_destino, u.nome AS perito_nome
     FROM processos p LEFT JOIN usuarios u ON u.id = p.perito_id
     WHERE p.fisico = 1 AND p.status = 'conferido' AND p.remessa_id IS NULL
     ORDER BY p.secretaria_destino, p.numero_sei`
  ).all();
  res.json(linhas);
});

// Lista de remessas.
router.get('/', (req, res) => {
  const remessas = db.prepare('SELECT * FROM remessas ORDER BY id DESC').all();
  for (const r of remessas) {
    r.total = db.prepare('SELECT COUNT(*) AS c FROM processos WHERE remessa_id = ?').get(r.id).c;
  }
  res.json(remessas);
});

// Detalhe de uma remessa (com processos).
router.get('/:id', (req, res) => {
  const remessa = db.prepare('SELECT * FROM remessas WHERE id = ?').get(req.params.id);
  if (!remessa) return res.status(404).json({ erro: 'Remessa não encontrada' });
  remessa.processos = db.prepare(
    `SELECT id, numero_sei, interessado, especificacao FROM processos WHERE remessa_id = ? ORDER BY numero_sei`
  ).all(remessa.id);
  res.json(remessa);
});

// Cria uma remessa com os processos informados.
router.post('/', (req, res) => {
  const { secretaria, mensageiro, processo_ids } = req.body || {};
  if (!secretaria) return res.status(400).json({ erro: 'Informe a secretaria de destino' });
  if (!Array.isArray(processo_ids) || !processo_ids.length) {
    return res.status(400).json({ erro: 'Selecione ao menos um processo' });
  }
  const info = db.prepare('INSERT INTO remessas (secretaria, mensageiro, criado_por) VALUES (?, ?, ?)')
    .run(secretaria.trim(), (mensageiro || '').trim() || null, req.usuario.nome);
  const remessaId = info.lastInsertRowid;

  const vincular = db.prepare(`UPDATE processos SET remessa_id = ? WHERE id = ? AND fisico = 1 AND status = 'conferido' AND remessa_id IS NULL`);
  const tx = db.transaction((ids) => { for (const id of ids) vincular.run(remessaId, id); });
  tx(processo_ids);
  res.status(201).json({ id: remessaId });
});

// Relatório imprimível da remessa (com linha de assinatura do mensageiro).
router.get('/:id/relatorio', (req, res) => {
  const remessa = db.prepare('SELECT * FROM remessas WHERE id = ?').get(req.params.id);
  if (!remessa) return res.status(404).send('Remessa não encontrada');
  const procs = db.prepare(
    `SELECT numero_sei, interessado, especificacao FROM processos WHERE remessa_id = ? ORDER BY numero_sei`
  ).all(remessa.id);
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const linhas = procs.map((p, i) =>
    `<tr><td>${i + 1}</td><td>${esc(p.numero_sei)}</td><td>${esc(p.interessado || '—')}</td><td>${esc(p.especificacao || '—')}</td></tr>`
  ).join('');
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Remessa #${remessa.id}</title>
    <style>body{font-family:Arial,sans-serif;max-width:820px;margin:32px auto;padding:0 20px;color:#111}
    h1{font-size:18px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left}
    th{background:#eee}.cab{margin-bottom:16px}.ass{margin-top:60px;display:flex;justify-content:space-around;text-align:center}
    .linha{border-top:1px solid #000;width:260px;padding-top:6px}@media print{.noprint{display:none}}</style></head><body>
    <div class="cab"><h1>PERÍCIA / JUNTA MÉDICA — RELATÓRIO DE REMESSA #${remessa.id}</h1>
      <div><b>Secretaria de destino:</b> ${esc(remessa.secretaria)}</div>
      <div><b>Mensageiro:</b> ${esc(remessa.mensageiro || '____________________')}</div>
      <div><b>Data de emissão:</b> ${esc(remessa.criado_em)}</div>
      <div><b>Total de processos:</b> ${procs.length}</div>
    </div>
    <table><thead><tr><th>#</th><th>Processo</th><th>Interessado</th><th>Assunto</th></tr></thead><tbody>${linhas}</tbody></table>
    <div class="ass">
      <div class="linha">Operador (entrega)</div>
      <div class="linha">Mensageiro (recebimento)</div>
    </div>
    <div class="noprint" style="text-align:center;margin-top:32px"><button onclick="print()" style="padding:10px 20px;font-size:15px">🖨 Imprimir</button></div>
  </body></html>`);
});

// Registra a retirada pelo mensageiro: baixa os processos (encerrados na perícia).
router.post('/:id/retirada', (req, res) => {
  const { data, mensageiro } = req.body || {};
  const remessa = db.prepare('SELECT * FROM remessas WHERE id = ?').get(req.params.id);
  if (!remessa) return res.status(404).json({ erro: 'Remessa não encontrada' });
  if (remessa.retirada_em) return res.status(409).json({ erro: 'Esta remessa já foi retirada' });

  const dataRetirada = (data || '').trim() || new Date().toISOString().slice(0, 10);
  db.prepare('UPDATE remessas SET retirada_em = ?, mensageiro = COALESCE(?, mensageiro) WHERE id = ?')
    .run(dataRetirada, (mensageiro || '').trim() || null, remessa.id);

  const procs = db.prepare('SELECT * FROM processos WHERE remessa_id = ?').all(remessa.id);
  const encerrar = db.prepare(`UPDATE processos SET status = 'concluido', atualizado_em = datetime('now') WHERE id = ?`);
  const tx = db.transaction((lista) => {
    for (const p of lista) {
      encerrar.run(p.id);
      registrarHistorico({
        processoId: p.id, usuario: req.usuario, acao: 'encerrado_mensageiro',
        detalhe: `Retirado pelo mensageiro em ${dataRetirada} (remessa #${remessa.id}) — encerrado na perícia`,
      });
    }
  });
  tx(procs);
  res.json({ ok: true, encerrados: procs.length });
});

export default router;
