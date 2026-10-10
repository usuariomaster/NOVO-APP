// Motor ÚNICO de datas de afastamento (porte do inc/afastamentos.php do cesar.ia — mesmas regras).
// 10/10/2026 — ordem do Dr. Cesar: controle de datas e afastamentos preciso e sem erros.
//  1. Primeiro afastamento da cadeia = LICENÇA INICIAL (começa na data pedida).
//  2. Atestado com início até o dia seguinte ao último dia do anterior = PRORROGAÇÃO; começa
//     SEMPRE no 1º dia após o último dia do anterior. Ex.: 30 d desde 01/10 (até 30/10) + atestado
//     de 26/10 por 30 d = 31/10 a 29/11.
//  3. Início até 60 dias após o último dia = PRORROGAÇÃO TARDIA (Decreto 5545 [conferir texto]);
//     começa na data pedida, os dias sem atestado ficam descobertos e a contagem ininterrupta zera.
//  4. Mais de 60 dias = nova LICENÇA INICIAL.
//  5. Só concedidos contam (negado/indeferido/exigência/diligência ficam fora da cadeia).
//  6. Cadeias separadas: saúde do próprio × doença em pessoa da família.

export const TARDIA_MAX = 60;
const DIA = 86400000;
const ms = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
export const somaDias = (d, n) => ymd(ms(d) + n * DIA);
export const difDias = (a, b) => Math.round((ms(b) - ms(a)) / DIA); // b - a

const ehData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
const tipoDe = (a) => (/fam/i.test(`${a.tipo || ''} ${a.natureza || ''}`) ? 'familia' : 'proprio');
const contaDe = (a) => !/neg|indef|exig|dilig/i.test(String(a.conclusao || a.situacao || ''));

export function calcular(lista) {
  const rows = (lista || []).filter((a) => ehData(a.data_inicio)).map((a) => {
    const ini = a.data_inicio.slice(0, 10);
    let dias = parseInt(a.dias, 10);
    if (!(dias > 0) && ehData(a.data_fim)) dias = difDias(ini, a.data_fim.slice(0, 10)) + 1;
    return { ...a, _tipo: tipoDe(a), _pedido: ini, _dias: dias > 0 ? dias : 1, _conta: contaDe(a) };
  });
  rows.sort((x, y) => (x._tipo + x._pedido + String(x.id).padStart(10, '0')).localeCompare(y._tipo + y._pedido + String(y.id).padStart(10, '0')));
  const est = {};
  return rows.map((r) => {
    const st = est[r._tipo];
    let cls, ini, ant, interv;
    if (!st) { cls = 'INICIAL'; ini = r._pedido; ant = 0; interv = null; }
    else {
      const dist = difDias(st.fim, r._pedido);
      if (dist <= 1) { cls = 'PRORROGACAO'; ini = somaDias(st.fim, 1); ant = st.cadeia; interv = 0; }
      else if (dist <= TARDIA_MAX) { cls = 'PRORROGACAO_TARDIA'; ini = r._pedido; ant = 0; interv = dist - 1; }
      else { cls = 'INICIAL'; ini = r._pedido; ant = 0; interv = dist - 1; }
    }
    const fim = somaDias(ini, r._dias - 1);
    if (r._conta) est[r._tipo] = { fim, cadeia: ant + r._dias };
    return { id: r.id, tipo: r._tipo, pedido: r._pedido, inicio: ini, fim, dias: r._dias, classificacao: cls,
      intervalo: interv, ininterrupto_anterior: ant, ininterrupto_total: ant + r._dias, conta: r._conta, cid: r.cid || '', conclusao: r.conclusao || '' };
  });
}

export function resumo(cadeia, tipo, hoje = new Date().toISOString().slice(0, 10)) {
  const v = cadeia.filter((r) => r.tipo === tipo && r.conta);
  if (!v.length) return { n: 0, total: 0 };
  const u = v[v.length - 1];
  const dist = difDias(u.fim, hoje);
  const situacao = dist <= 0 ? 'EM LICENÇA' : dist <= 1 ? 'PRORROGAÇÃO NORMAL ATÉ HOJE'
    : dist <= TARDIA_MAX ? 'DESCOBERTO — CABE PRORROGAÇÃO TARDIA' : 'PRAZO DE PRORROGAÇÃO ENCERRADO';
  return { n: v.length, total: v.reduce((t, r) => t + r.dias, 0), ultimo_fim: u.fim, ininterrupto: u.ininterrupto_total,
    prorrogacao_normal_inicia: somaDias(u.fim, 1), tardia_ate: somaDias(u.fim, TARDIA_MAX), situacao };
}

export const rotulo = (c) => ({ INICIAL: 'Licença inicial', PRORROGACAO: 'Prorrogação', PRORROGACAO_TARDIA: 'Prorrogação tardia' }[c] || c);
