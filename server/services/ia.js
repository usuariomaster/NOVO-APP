// ============================================================
// IA embarcada (Claude / Anthropic)
//
// A chave da API fica guardada CRIPTOGRAFADA no "cofre de tokens"
// (tabela configuracoes, AES-256-GCM via crypto.js) — nunca em
// código nem em texto puro. O admin cadastra a chave em
// "Configuração da IA" e o sistema a usa para:
//   1) extrair a ficha funcional colada em texto -> campos do servidor;
//   2) gerar, a partir do CBO, as atividades para o PPP e os dados de
//      LTCAT (agentes nocivos) e PCMSO (controle médico ocupacional).
//
// Como o servidor roda no HostGator (internet direta), usamos o fetch
// global do Node para chamar api.anthropic.com.
// ============================================================
import { getConfig, setConfig } from '../db.js';
import { criptografar, descriptografar } from '../sei/crypto.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO_PADRAO = 'claude-sonnet-4-5-20250929';

// ---- Cofre de tokens ----
export function guardarChave(chave) {
  setConfig('ia_api_key_cripto', criptografar(String(chave).trim()));
}
export function definirModelo(modelo) {
  setConfig('ia_modelo', String(modelo || MODELO_PADRAO).trim());
}
export function temChave() {
  return !!getConfig('ia_api_key_cripto');
}
export function modeloAtual() {
  return getConfig('ia_modelo') || MODELO_PADRAO;
}
function lerChave() {
  const c = getConfig('ia_api_key_cripto');
  if (!c) throw new Error('Chave da IA não configurada. Cadastre em "Configuração da IA".');
  return descriptografar(c);
}

// ---- Chamada bruta ao Claude. Se json=true, tenta devolver objeto. ----
export async function chamarClaude({ system, prompt, maxTokens = 1500, json = false }) {
  const chave = lerChave();
  const corpo = {
    model: modeloAtual(),
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
  };
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Falha na IA (HTTP ${resp.status}): ${txt.slice(0, 300)}`);
  }
  const dados = await resp.json();
  const texto = (dados.content || []).map((b) => b.text || '').join('').trim();
  if (!json) return texto;
  // extrai o primeiro bloco JSON da resposta
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('A IA não devolveu JSON válido.');
  return JSON.parse(m[0]);
}

// Teste rápido de conectividade/chave.
export async function testarChave() {
  const r = await chamarClaude({ prompt: 'Responda apenas: OK', maxTokens: 10 });
  return { ok: /ok/i.test(r), resposta: r };
}

// ---- Extrai a ficha funcional (texto colado) em campos do servidor ----
const CAMPOS_FICHA = [
  'nome', 'cpf', 'matricula', 'pai', 'mae', 'grau_instrucao', 'naturalidade',
  'uf_naturalidade', 'nacionalidade', 'estado_civil', 'data_nascimento', 'sexo',
  'identidade', 'identidade_emissao', 'identidade_orgao', 'titulo_eleitor', 'zona',
  'secao', 'ctps', 'ctps_serie', 'ctps_uf', 'nit', 'pis_pasep', 'cargo', 'funcao',
  'data_admissao', 'situacao', 'data_demissao', 'tipo_admissao', 'data_publicacao',
  'num_portaria', 'vinculo', 'data_concurso', 'data_posse', 'data_exercicio',
  'tipo_salario', 'regime_previdencia', 'carga_horaria', 'vinculo_empregaticio',
  'secretaria', 'lotacao', 'setor', 'unidade_trabalho', 'classificacao_funcional',
  'simbologia', 'cbo', 'cbo_mt', 'endereco', 'numero_ende', 'bairro', 'municipio',
  'uf_ende', 'cep', 'complemento', 'telefone', 'celular', 'email',
];

export async function extrairFichaFuncional(texto) {
  const system =
    'Você extrai dados de fichas funcionais de servidores públicos (RH da Prefeitura de Nova Iguaçu). ' +
    'Devolva SOMENTE um objeto JSON, sem comentários. Use exatamente as chaves pedidas. ' +
    'Datas no formato AAAA-MM-DD. Se um campo não existir no texto, use string vazia. ' +
    'Não invente dados.';
  const prompt =
    `Extraia os campos abaixo desta ficha funcional e devolva um JSON com estas chaves:\n` +
    CAMPOS_FICHA.join(', ') +
    `\n\nObservações de mapeamento: "Unidade de Trabalho"=unidade_trabalho, ` +
    `"Classificação Funcional"=classificacao_funcional (também pode preencher "cargo"/"funcao"), ` +
    `"Secretaria"=secretaria (também lotacao), "Nº da Portaria"=num_portaria, ` +
    `"Data da Posse"=data_posse, "Data do Exercício"=data_exercicio, "Identidade"=identidade.\n\n` +
    `FICHA FUNCIONAL:\n"""${String(texto).slice(0, 12000)}"""`;
  const obj = await chamarClaude({ system, prompt, maxTokens: 2000, json: true });
  // mantém só as chaves conhecidas e não-vazias
  const limpo = {};
  for (const c of CAMPOS_FICHA) {
    const v = obj[c];
    if (v !== undefined && v !== null && String(v).trim() !== '') limpo[c] = String(v).trim();
  }
  return limpo;
}

// ---- Gera PPP/LTCAT/PCMSO a partir do CBO e das atividades ----
export async function enriquecerPorCBO({ cbo, cargo, atividades, secretaria, lotacao }) {
  const system =
    'Você é um perito em Medicina e Segurança do Trabalho no serviço público. ' +
    'Com base na Classificação Brasileira de Ocupações (CBO) e no cargo, descreva as atividades ' +
    'típicas e os elementos técnicos para PPP, LTCAT e PCMSO. Seja técnico, objetivo e realista; ' +
    'sinalize quando algo depende de laudo ambiental in loco. Devolva SOMENTE um objeto JSON.';
  const prompt =
    `Dados do servidor:\n- CBO: ${cbo || '(não informado)'}\n- Cargo/Classificação: ${cargo || ''}\n` +
    `- Atividades informadas: ${atividades || '(não informadas)'}\n- Secretaria/Lotação: ${secretaria || ''} ${lotacao || ''}\n\n` +
    `Devolva um JSON com as chaves:\n` +
    `{\n` +
    `  "ppp_atividades": "descrição das atividades habituais e permanentes do cargo (para o campo 14 do PPP), em texto corrido",\n` +
    `  "ltcat": "agentes nocivos (físicos, químicos, biológicos, ergonômicos) tipicamente associados ao cargo, com intensidade/técnica de medição esperada e se há exposição a insalubridade/periculosidade; indique quando exige laudo ambiental in loco",\n` +
    `  "pcmso": "riscos ocupacionais e exames médicos ocupacionais recomendados (admissional, periódico, retorno, mudança, demissional) e periodicidade para este cargo",\n` +
    `  "agentes_nocivos": "lista curta dos principais agentes nocivos, separada por vírgula"\n` +
    `}`;
  const obj = await chamarClaude({ system, prompt, maxTokens: 2000, json: true });
  return {
    ppp_atividades: String(obj.ppp_atividades || '').trim(),
    ltcat: String(obj.ltcat || '').trim(),
    pcmso: String(obj.pcmso || '').trim(),
    agentes_nocivos: String(obj.agentes_nocivos || '').trim(),
  };
}
