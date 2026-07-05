// HTML do despacho (usado para impressão e para gerar o PDF assinado).
import { timbreHTML, TIMBRE_CSS } from './timbre.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function htmlDespacho(proc, d, { assinado } = {}) {
  const rodape = assinado
    ? `<div class="ass"><p style="font-size:12px;color:#555">Documento assinado digitalmente (ICP-Brasil) por <b>${esc(proc.perito_nome || 'Perito')}</b>.</p></div>`
    : `<div class="ass"><div class="linha">${esc(proc.perito_nome || 'Perito')}</div></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Despacho ${esc(proc.numero_sei)}</title>
    <style>body{font-family:Georgia,'Times New Roman',serif;color:#111;line-height:1.5;margin:40px}
    h1{font-size:16px;text-align:center;margin:0 0 18px}${TIMBRE_CSS}
    .meta{font-size:14px;margin:16px 0;border:1px solid #ccc;padding:12px;border-radius:6px}
    .meta b{display:inline-block;width:130px}.corpo{white-space:pre-wrap;margin:24px 0;text-align:justify}
    .ass{margin-top:70px;text-align:center}.linha{border-top:1px solid #000;width:280px;margin:0 auto;padding-top:6px}
    @media print{.noprint{display:none}body{margin:0}}</style></head><body>
    ${timbreHTML('Perícia Médica / Junta Médica')}
    <h1>DESPACHO PERICIAL</h1>
    <div class="meta">
      <div><b>Processo:</b> ${esc(proc.numero_sei)}${proc.fisico ? ' (físico)' : ''}</div>
      <div><b>Interessado:</b> ${esc(proc.interessado || '—')}</div>
      <div><b>Assunto:</b> ${esc(proc.especificacao || proc.tipo || '—')}</div>
      <div><b>Perito:</b> ${esc(proc.perito_nome || '—')}</div>
      <div><b>Conclusão:</b> ${esc(d?.conclusao || '—')}</div>
    </div>
    <div class="corpo">${esc(d?.texto || '(sem texto de despacho)')}</div>
    ${rodape}
    <div class="noprint" style="text-align:center;margin-top:32px"><button onclick="print()" style="padding:10px 20px;font-size:15px">🖨 Imprimir</button></div>
  </body></html>`;
}
