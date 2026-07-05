// ============================================================
// Documentos oficiais da Perícia (reproduzem os modelos reais):
//  - BIM (Boletim de Inspeção Médica) — formulário interno da perícia
//  - Comprovante ao servidor — resposta enviada ao servidor, com o
//    texto-padrão legal (Resolução 2.382/2024, reconsideração via SEMAT…)
// ============================================================
import { getConfig } from '../db.js';
import { timbreHTML, TIMBRE_CSS } from './timbre.js';

const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const dbr = (d) => { const m = String(d || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '____'); };
const chk = (v) => (v ? '☑' : '☐');

// Texto-padrão do comprovante (editável em configurações; default = modelo real).
export const OBS_PADRAO_DEFAULT = [
  'Os atestados fora do prazo e/ou padrão da RESOLUÇÃO 2.382/2024 e da portaria 034/2019 – SEMUS não serão considerados;',
  'Cabe ao servidor acompanhar diariamente o andamento do seu pedido;',
  'Caso o servidor não concorde com a decisão da perícia médica, deverá ser aberto um processo de reconsideração junto à Secretaria de Administração e Tecnologia - SEMAT, onde deverá ser anexado laudo médico completo conforme a RESOLUÇÃO 1.658/2002, 2.381/2024 e 2.382/2024; vale ressaltar que o servidor(a) permanecerá descoberto do abono de faltas durante o trâmite do processo;',
  'O agendamento de perícia médica presencial é EXCLUSIVAMENTE solicitado pelo perito médico e confirmado por mensagem de texto através do WhatsApp: (21) 96649-5532 (não responderemos ligação, SMS e áudio), ou do e-mail: periciamedica@novaiguacu.rj.gov.br;',
  'O horário dos agendamentos dos peritos médicos da Junta Médica Oficial é de 08h às 12h de segunda a sexta-feira. O setor administrativo funciona de 8h às 17h mediante agendamento prévio por WhatsApp ou e-mail.',
];
export function obsPadrao() {
  const t = getConfig('comprovante_obs');
  return t ? t.split('\n').filter(Boolean) : OBS_PADRAO_DEFAULT;
}

// "O funcionário deverá ser licenciado": SIM / NÃO / EXIGÊNCIA a partir da conclusão.
function decisao(a) {
  const c = String(a.conclusao || '').toLowerCase();
  if (/defer|conc|apto|sim/.test(c)) return 'SIM';
  if (/indefer|neg|inapto/.test(c)) return 'NAO';
  if (/exig|dilig/.test(c)) return 'EXIGENCIA';
  return '';
}

// ---- BIM (Boletim de Inspeção Médica) — layout do formulário oficial ----
export function htmlBIM(s, a, proc) {
  const nat = String(a.natureza || '').toLowerCase();
  const dec = decisao(a);
  const box = (label, on) => `${chk(on)} ${label}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>BIM ${esc(a.bim_numero || a.id)} — ${esc(s.nome)}</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px;line-height:1.45}
    ${TIMBRE_CSS} h1{font-size:15px;text-align:center;margin:0 0 12px}
    table{width:100%;border-collapse:collapse;margin:6px 0}td{border:1px solid #444;padding:6px 8px;vertical-align:top}
    .lbl{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.03em;display:block;margin-bottom:2px}
    .sec{background:#eef2f4;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    .opts{display:flex;flex-wrap:wrap;gap:6px 18px} .rel{min-height:60px}
    .ass{margin-top:54px;text-align:center}.linha{border-top:1px solid #000;width:300px;margin:0 auto;padding-top:6px}
    .foot{margin-top:26px;text-align:center;font-size:11px;color:#444;border-top:1px solid #ccc;padding-top:8px}
    @media print{.noprint{display:none}body{margin:10mm}}</style></head><body>
    ${timbreHTML('Secretaria Municipal de Saúde — SEMUS · Serviço de Perícia Médica')}
    <h1>BOLETIM DE INSPEÇÃO MÉDICA (BIM)</h1>
    <table>
      <tr><td><span class="lbl">Prontuário nº</span>${esc(s.prontuario || '—')}</td>
          <td><span class="lbl">Data</span>${dbr(a.data_pericia || a.criado_em)}</td>
          <td><span class="lbl">BIM anterior nº</span>${esc(a.bim_anterior || '—')}</td>
          <td><span class="lbl">BIM nº</span>${esc(a.bim_numero || a.id)}</td></tr>
      <tr><td colspan="4"><span class="lbl">Nome do servidor</span><b>${esc(s.nome)}</b></td></tr>
      <tr><td colspan="2"><span class="lbl">Cargo</span>${esc(s.cargo)}</td>
          <td><span class="lbl">Matrícula</span>${esc(s.matricula)}</td>
          <td><span class="lbl">CPF</span>${esc(s.cpf)}</td></tr>
      <tr><td colspan="2"><span class="lbl">Lotação</span>${esc(s.secretaria || s.lotacao)}</td>
          <td colspan="2"><span class="lbl">Local de trabalho</span>${esc(s.unidade_trabalho || s.setor)}</td></tr>
    </table>
    <table>
      <tr><td class="sec" colspan="2">Observações de interesse da perícia</td></tr>
      <tr><td>${box('Readaptação', /readapt/.test(nat))} &nbsp;&nbsp; ${box('Reconsideração', /reconsider/.test(nat))} &nbsp;&nbsp; ${box('Aposentadoria por incapacidade', /aposent|invalid|incapac/.test(nat))}</td>
          <td><span class="lbl">Processo nº</span>${esc(proc?.numero_sei || '—')}</td></tr>
    </table>
    <table>
      <tr><td class="sec">Parecer médico pericial</td></tr>
      <tr><td><div class="opts">
        ${box('Licença inicial', /inicial/.test(nat))}
        ${box('Prorrogação', /prorrog/.test(nat))}
        ${box('Alta', /alta/.test(nat))}
        ${box('Aposentadoria por invalidez', /invalid|aposent/.test(nat))}
      </div></td></tr>
      <tr><td><div class="opts">
        ${box('Do próprio', /pr[oó]prio/i.test(a.beneficiario || ''))}
        ${box('De pessoa da família', /famil/i.test(a.beneficiario || ''))}
        &nbsp;&nbsp;|&nbsp;&nbsp;
        ${box('Com remuneração', /com/i.test(a.remunerado || ''))}
        ${box('Sem remuneração', /sem/i.test(a.remunerado || ''))}
      </div></td></tr>
      <tr><td>
        <span class="lbl">Licença ininterrupta anterior de</span>${a.licenca_anterior_dias ?? '____'} dias &nbsp;&nbsp;·&nbsp;&nbsp;
        <span class="lbl" style="display:inline">Prazo da licença atual</span> de ${dbr(a.data_inicio)} à ${dbr(a.data_fim)} — total ${a.dias ?? '____'} dias
      </td></tr>
    </table>
    <table>
      <tr><td class="sec">Relatório do comprovante a ser enviado ao servidor</td></tr>
      <tr><td>O funcionário deverá ser licenciado:
        ${box('SIM', dec === 'SIM')} &nbsp; ${box('NÃO', dec === 'NAO')} &nbsp; ${box('EXIGÊNCIA', dec === 'EXIGENCIA')}</td></tr>
      <tr><td class="rel">${esc(a.descricao || '')}</td></tr>
    </table>
    <div class="ass"><div class="linha">${esc(a.perito || 'Médico Perito')}</div></div>
    <div class="foot">Prefeitura da Cidade de Nova Iguaçu · Secretaria Municipal de Saúde - SEMUS · Serviço de Perícia Médica Municipal · Junta Médica Oficial</div>
    <div class="noprint" style="text-align:center;margin-top:24px"><button onclick="print()" style="padding:10px 22px;font-size:15px">🖨 Imprimir BIM</button></div>
  </body></html>`;
}

// ---- Comprovante ao servidor (resposta oficial, com o texto-padrão) ----
export function htmlComprovanteServidor(s, a, proc) {
  const nat = String(a.natureza || '').toLowerCase();
  const dec = decisao(a);
  const box = (label, on) => `${chk(on)} ${label}`;
  const obs = obsPadrao().map((p) => `<li>${esc(p)}</li>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Comprovante — ${esc(s.nome)}</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px;line-height:1.5}
    ${TIMBRE_CSS} h1{font-size:15px;text-align:center;margin:0 0 14px}
    table{width:100%;border-collapse:collapse;margin:6px 0}td{border:1px solid #444;padding:6px 8px}
    .lbl{font-size:10px;color:#555;text-transform:uppercase;display:block;margin-bottom:2px}
    .opts{display:flex;flex-wrap:wrap;gap:6px 16px} ol{font-size:11.5px;color:#333;margin:12px 0 0;padding-left:18px}
    ol li{margin-bottom:6px;text-align:justify} .ass{margin-top:44px;text-align:center}.linha{border-top:1px solid #000;width:320px;margin:0 auto;padding-top:6px}
    @media print{.noprint{display:none}body{margin:10mm}}</style></head><body>
    ${timbreHTML('Perícia Médica — Comprovante ao Servidor')}
    <h1>COMPROVANTE DE PERÍCIA MÉDICA</h1>
    <table>
      <tr><td><span class="lbl">Data</span>${dbr(a.data_pericia || a.criado_em)}</td>
          <td><span class="lbl">BIM</span>${esc(a.bim_numero || a.id)}</td>
          <td><div class="opts">${box('Licença inicial', /inicial/.test(nat))} ${box('Prorrogação', /prorrog/.test(nat))}</div></td></tr>
      <tr><td colspan="2"><span class="lbl">Nome do servidor</span><b>${esc(s.nome)}</b></td>
          <td><span class="lbl">Matrícula</span>${esc(s.matricula)}</td></tr>
      <tr><td><span class="lbl">CPF</span>${esc(s.cpf)}</td>
          <td><span class="lbl">Cargo</span>${esc(s.cargo)}</td>
          <td><span class="lbl">Lotação / local</span>${esc(s.secretaria || s.lotacao)} · ${esc(s.unidade_trabalho || '')}</td></tr>
      <tr><td colspan="3"><div class="opts">
        <b>Licença:</b> ${box('Próprio', /pr[oó]prio/i.test(a.beneficiario || ''))} ${box('Acompanhar familiar', /famil/i.test(a.beneficiario || ''))}
        &nbsp;|&nbsp; <b>Remunerado:</b> ${box('SIM', /com/i.test(a.remunerado || ''))} ${box('NÃO', /sem/i.test(a.remunerado || ''))}
      </div></td></tr>
      <tr><td colspan="3"><div class="opts" style="font-weight:700">
        ${box('CONCEDIDO', dec === 'SIM')} &nbsp; ${box('NEGADO', dec === 'NAO')} &nbsp; ${box('EM EXIGÊNCIA', dec === 'EXIGENCIA')}
      </div></td></tr>
      <tr><td colspan="3"><span class="lbl">Observações complementares</span>${esc(a.descricao || (proc ? 'Resposta ao processo SEI ' + proc.numero_sei : '—'))}</td></tr>
      <tr><td colspan="2"><span class="lbl">Prazo da licença</span>${dbr(a.data_inicio)} a ${dbr(a.data_fim)}</td>
          <td><span class="lbl">Total de dias</span>${a.dias ?? '—'}</td></tr>
    </table>
    <ol>${obs}</ol>
    <div class="ass"><div class="linha">Perícia Médica — Junta Médica Oficial</div></div>
    <div class="noprint" style="text-align:center;margin-top:24px"><button onclick="print()" style="padding:10px 22px;font-size:15px">🖨 Imprimir comprovante</button></div>
  </body></html>`;
}
