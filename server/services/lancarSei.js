// Serviço compartilhado: lança o despacho no SEI (usado pelo operador e
// pelo perito administrador que tramita direto).
import db, { ehSimulacao } from '../db.js';
import { descriptografar } from '../sei/crypto.js';
import { lancarDespachoNoSei } from '../sei/writer.js';

function montarCfg(cfgRow) {
  if (!cfgRow) return { base_url: process.env.SEI_BASE_URL || '', tipo_documento: 'Despacho', nivel_acesso: 'publico' };
  return {
    base_url: cfgRow.base_url,
    orgao: cfgRow.orgao,
    unidade: cfgRow.unidade,
    usuario: cfgRow.usuario,
    senha: descriptografar(cfgRow.senha_cripto),
    tipo_documento: cfgRow.tipo_documento,
    nivel_acesso: cfgRow.nivel_acesso,
    unidade_destino: cfgRow.unidade_destino,
    assinar: cfgRow.assinar !== 0,
    cargo: cfgRow.cargo,
  };
}

// Lança o despacho no SEI. Retorna { modo, comprovante, passos }.
// Lança exceção (com .comprovante/.passos) em caso de falha.
export async function lancarNoSei(proc, despacho) {
  const cfgRow = db.prepare('SELECT * FROM sei_config ORDER BY padrao DESC, id LIMIT 1').get();
  const mock = ehSimulacao();
  if (!cfgRow && !mock) throw new Error('Cadastre a configuração do SEI primeiro.');
  return lancarDespachoNoSei(
    montarCfg(cfgRow),
    { processoId: proc.id, numeroSei: proc.numero_sei, texto: despacho.texto, conclusao: despacho.conclusao },
    mock
  );
}
