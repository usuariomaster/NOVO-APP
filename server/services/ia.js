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
// content, quando informado, substitui prompt (usado para visão: blocos
// de imagem/documento + texto).
export async function chamarClaude({ system, prompt, content, maxTokens = 1500, json = false }) {
  const chave = lerChave();
  const corpo = {
    model: modeloAtual(),
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: content || prompt }],
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
  'uf_ende', 'cep', 'complemento', 'telefone', 'celular', 'email', 'observacoes',
];

const SYSTEM_FICHA =
  'Você extrai dados de fichas funcionais de servidores públicos (RH da Prefeitura de Nova Iguaçu). ' +
  'Devolva SOMENTE um objeto JSON, sem comentários. Use exatamente as chaves pedidas. ' +
  'Datas no formato AAAA-MM-DD. Se um campo não existir, use string vazia. Não invente dados.';
const INSTRUCAO_FICHA =
  `Extraia os dados do servidor e devolva um JSON com estas chaves:\n` +
  CAMPOS_FICHA.join(', ') +
  `\n\nFONTES no processo (leia TODAS): a FICHA FUNCIONAL (Dados Cadastrais do Funcionário / RH), ` +
  `o HOLERITE (contracheque), a IDENTIDADE (RG) e principalmente os DESPACHOS (texto corrido do RH/SEMAD). ` +
  `Cruze tudo: CPF e RG da identidade; matrícula, cargo e lotação do holerite/ficha/despacho. ` +
  `Os DESPACHOS geralmente trazem em texto: nome, cargo, lotação/secretaria, "matrícula nº ...", ` +
  `"Portaria nº ...", data de publicação, data de exercício/posse — use-os para preencher os campos. ` +
  `Mapeamento: "Unidade de Trabalho"=unidade_trabalho, ` +
  `"Classificação Funcional"=classificacao_funcional (também pode preencher "cargo"/"funcao"), ` +
  `"Secretaria/lotado na"=secretaria (também lotacao), "Portaria nº"=num_portaria, ` +
  `"Data da Posse"=data_posse, "exercício em"=data_exercicio, "Identidade"=identidade. ` +
  `IMPORTANTE: a "matrícula" é um número curto do servidor (ex.: "76/707.347-1"), NUNCA o número do processo. ` +
  `Preencha "observacoes" com um resumo em 1-3 frases da nomeação/portaria/lotação/exercício encontrados no despacho. ` +
  `Inclua a chave booleana "tem_ficha_funcional": true se houver a ficha de Dados Cadastrais do Funcionário. ` +
  `Inclua também a chave "afastamentos": uma lista (pode ser vazia) de licenças/afastamentos/ocorrências citados nos ` +
  `despachos, cada item com { "tipo": "ex.: Licença para tratar de assuntos particulares", "data_inicio": "AAAA-MM-DD", ` +
  `"data_fim": "AAAA-MM-DD", "cid": "se houver", "conclusao": "a DECISÃO do despacho: Deferido/Indeferido/Diligência/Apto/Inapto ` +
  `— use Deferido quando o texto diz concedeu/deferido/autorizado; Indeferido quando nega/indefere; vazio se não houver decisão", ` +
  `"descricao": "base legal, ex.: Portaria SEMAD nº 1.324/025" }. Não invente datas nem decisões.`;

// Um valor com cara de NÚMERO DE PROCESSO SEI (ex.: 20708202031.001315/2026-82).
function pareceNumeroProcesso(v) {
  const s = String(v || '');
  return /\/\s*(19|20)\d{2}\s*-\s*\d/.test(s) || /\d{5,}\.\d{4,}\/\d{4}/.test(s) || s.replace(/\D/g, '').length >= 14;
}

// Sanitiza os campos lidos para não gravar lixo — em especial impedir que o
// NÚMERO DO PROCESSO entre como matrícula/CPF (são coisas diferentes).
function limparFicha(obj, ctx = {}) {
  const proc = String(ctx.numeroSei || '');
  const procDigitos = proc.replace(/\D/g, '');
  const limpo = {};
  for (const c of CAMPOS_FICHA) {
    let v = obj[c];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    v = String(v).trim();
    // matrícula/identidade/CPF/NIT/PIS não podem ser o número do processo
    if (['matricula', 'cpf', 'identidade', 'nit', 'pis_pasep', 'titulo_eleitor'].includes(c)) {
      if (pareceNumeroProcesso(v)) continue;
      const dig = v.replace(/\D/g, '');
      if (procDigitos && dig && (dig === procDigitos || procDigitos.includes(dig) && dig.length >= 10)) continue;
      if (c === 'cpf' && dig.length && dig.length !== 11) { if (dig.length < 11) continue; }
    }
    limpo[c] = v;
  }
  return limpo;
}

// Instrução extra para o OCR não confundir o nº do processo com matrícula.
function avisoProcesso(numeroSei) {
  if (!numeroSei) return '';
  return `\n\nATENÇÃO: o número do PROCESSO SEI é "${numeroSei}". Ele NÃO é a matrícula nem o CPF. ` +
    `A matrícula do servidor é um campo próprio da ficha (rótulo "Matrícula"), geralmente com poucos dígitos; ` +
    `NÃO copie o número do processo para matrícula/CPF/identidade. Se não achar a matrícula na ficha, deixe vazio.`;
}

// true/false do campo tem_ficha_funcional (default true quando veio conteúdo).
function leuFicha(obj, campos) {
  if (typeof obj.tem_ficha_funcional === 'boolean') return obj.tem_ficha_funcional;
  // heurística: considera que tem ficha se leu campos tipicamente da ficha.
  return ['matricula', 'cargo', 'classificacao_funcional', 'data_admissao', 'data_posse', 'lotacao'].some((c) => campos[c]);
}

// Normaliza a lista de afastamentos lida (descarta itens sem datas).
function lerAfastamentos(obj) {
  const arr = Array.isArray(obj.afastamentos) ? obj.afastamentos : [];
  const isData = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '').trim());
  return arr
    .map((a) => ({
      tipo: String(a.tipo || '').trim() || null,
      cid: String(a.cid || '').trim() || null,
      conclusao: String(a.conclusao || '').trim() || null,
      data_inicio: isData(a.data_inicio) ? a.data_inicio.trim() : null,
      data_fim: isData(a.data_fim) ? a.data_fim.trim() : null,
      descricao: String(a.descricao || '').trim() || null,
    }))
    .filter((a) => a.data_inicio || a.tipo);
}

// A partir de TEXTO colado. Retorna { campos, temFicha }.
export async function extrairFichaFuncional(texto, ctx = {}) {
  const prompt = `${INSTRUCAO_FICHA}${avisoProcesso(ctx.numeroSei)}\n\nFICHA FUNCIONAL:\n"""${String(texto).slice(0, 12000)}"""`;
  const obj = await chamarClaude({ system: SYSTEM_FICHA, prompt, maxTokens: 2000, json: true });
  const campos = limparFicha(obj, ctx);
  return { campos, temFicha: leuFicha(obj, campos), afastamentos: lerAfastamentos(obj) };
}

// A partir de ARQUIVO (imagem ou PDF) — OCR pela visão do Claude.
// arquivos = [{ base64, mime }] (uma ou mais páginas/imagens). ctx.numeroSei
// evita que o robô confunda o número do processo com a matrícula.
export async function extrairFichaDeArquivos(arquivos, ctx = {}) {
  const blocos = [];
  for (const a of arquivos.slice(0, 8)) {
    const mime = String(a.mime || '').toLowerCase();
    const data = String(a.base64 || '').includes(',') ? a.base64.split(',')[1] : a.base64;
    if (!data) continue;
    if (mime.includes('pdf')) {
      blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    } else {
      const mt = /jpe?g/.test(mime) ? 'image/jpeg' : /webp/.test(mime) ? 'image/webp' : /gif/.test(mime) ? 'image/gif' : 'image/png';
      blocos.push({ type: 'image', source: { type: 'base64', media_type: mt, data } });
    }
  }
  if (!blocos.length) throw new Error('Nenhuma imagem/PDF válido para OCR.');
  blocos.push({ type: 'text', text:
    `${INSTRUCAO_FICHA}${avisoProcesso(ctx.numeroSei)}\n\nLeia a(s) imagem(ns)/documento acima. ` +
    `Só preencha um campo se ele estiver REALMENTE visível como ficha funcional (Dados Cadastrais do Funcionário). ` +
    `Se a imagem não for uma ficha funcional, devolva um JSON vazio {}. Devolva SOMENTE o JSON.` });
  const obj = await chamarClaude({ system: SYSTEM_FICHA, content: blocos, maxTokens: 2000, json: true });
  const campos = limparFicha(obj, ctx);
  return { campos, temFicha: leuFicha(obj, campos), afastamentos: lerAfastamentos(obj) };
}

// ---- Sugere o texto do DESPACHO MÉDICO (decisão do perito) ----
// Estilo formal do serviço público (como os despachos reais da perícia):
// análise técnica, fundamentação normativa, decisão. É SUGESTÃO — o
// julgamento médico é do perito, que revisa e edita.
export async function sugerirDespacho({ numeroSei, interessado, assunto, tipo, contexto, decisao }) {
  const system =
    'Você é assistente de um médico perito da Junta Médica Oficial de Nova Iguaçu. ' +
    'Redige MINUTAS de despacho pericial em linguagem formal do serviço público, técnica e objetiva, ' +
    'fundamentando quando cabível nas normas usuais (Resolução CFM 2.382/2024, IN e portarias da SEMUS/SEMAT). ' +
    'NÃO invente diagnósticos, CID, datas ou fatos que não estejam no contexto; quando faltar dado, use lacuna ' +
    'genérica (ex.: "conforme atestado apresentado"). A decisão final é do perito. Devolva SOMENTE um JSON.';
  const prompt =
    `Processo: ${numeroSei || '—'}\nServidor: ${interessado || '—'}\nAssunto: ${assunto || tipo || '—'}\n` +
    `Direção pretendida pelo perito: ${decisao || '(não informada — sugira a mais provável e sinalize)'}\n` +
    `Contexto/documentos (se houver):\n"""${String(contexto || '').slice(0, 6000)}"""\n\n` +
    `Escreva a minuta e devolva um JSON:\n{\n` +
    `  "texto": "o corpo do despacho, em texto corrido, pronto para o perito revisar e assinar",\n` +
    `  "conclusao": "uma palavra/expressão: Deferido | Indeferido | Em exigência | Diligência"\n}`;
  const obj = await chamarClaude({ system, prompt, maxTokens: 1500, json: true });
  return { texto: String(obj.texto || '').trim(), conclusao: String(obj.conclusao || '').trim() };
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
