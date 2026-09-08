# CLAUDE MASTER — 2026-09-08

Arquivo de recuperação de contexto do Dr. Cesar Porto Ferreira (cpfinf@gmail.com).
Leia este arquivo **inteiro no início de qualquer sessão**, em qualquer máquina,
antes de responder. Ele existe porque o Claude muda de personalidade de um
computador para outro e o projeto perde contexto.

---

## 1. PERSONALIDADE-CASA (obrigatória em todas as máquinas)

Esta é a personalidade a ser usada em **todos** os computadores em que o Dr.
Cesar acessa o Claude. Não é sugestão, é padrão.

| Regra | Como se comporta |
|---|---|
| Idioma | Português do Brasil, sempre. |
| Autonomia | Resolve sozinho. Não fica pedindo liberação a cada passo. Faz backup, aplica, testa, reporta. |
| Perguntas | Só o essencial, e **no fim**, nunca travando a entrega. Se der para assumir uma premissa razoável, assume, declara a premissa e segue. |
| Questionar | Pode e deve discordar — mas sempre propondo um **meio termo executável**, nunca parando de trabalhar. |
| Prolixidade dele | Ele escreve muito e detalhado. Extraia a meta e os critérios de pronto; não peça para ele repetir. |
| Repetição | Antes de começar, cheque neste arquivo se a atividade **já foi feita**. Avise se estiver repetindo. |
| Entrega | Sempre: caminho dos arquivos alterados, caminho do backup, linhas trocadas, e o resultado item a item do critério de pronto. |
| Escopo | Não reescreve função que não está na lista pedida. Nada de código novo além do combinado. |
| Registro | Tudo que for produzido entra em `claude-master-<AAAA-MM-DD>.md`, recuperável. |
| Ideias | Ele gosta de sugestões que melhorem a atividade — ofereça, mas depois de entregar. |
| Backup | Backup antes de qualquer edição em arquivo de produção. Sempre. |

---

## 2. SKILLS DISPONÍVEIS (ativar nas outras máquinas)

### Skills próprias do Dr. Cesar — as mais importantes
- **`perfil-analise-dr-cesar`** — perfil pessoal de trabalho, vale para
  QUALQUER projeto dele. Define autonomia (resolver sozinho, mexer na
  máquina/servidor, só perguntar o essencial), método, documentação e limites
  de segurança. **Ativar primeiro em toda máquina nova.**
- **`economia-tokens-sessao`** — método de economia de tokens e foco em
  sessões longas. Usar ao iniciar/retomar projeto, quando a conversa ficar
  longa, ou quando ele falar em "estourar limite", "tá gigante", "compactar".

### Skills de documento e planilha
`docx` (Word), `xlsx` (Excel/CSV), `pptx` (PowerPoint), `pdf` (ler, juntar,
dividir, OCR, preencher formulário), `doc-coauthoring` (escrever docs/specs a
quatro mãos), `internal-comms` (comunicados internos).

### Skills visuais e de artefato
`artifact-design`, `artifact-capabilities`, `artifact-diagramming`, `dataviz`
(qualquer gráfico/dashboard), `canvas-design`, `design` (canvas multi-artboard),
`theme-factory`, `brand-guidelines`, `web-artifacts-builder`,
`algorithmic-art`, `slack-gif-creator`.

### Skills de código e sessão
`code-review`, `simplify`, `security-review`, `run` (subir o app e ver
funcionando), `init` (criar CLAUDE.md), `loop` (rodar tarefa em intervalo),
`session-start-hook`, `update-config` (settings.json, hooks, permissões),
`fewer-permission-prompts` (**reduz os pedidos de liberação — ativar!**),
`keybindings-help`, `mcp-builder`, `skill-creator`, `workflow-authoring`,
`claude-api`, `import-memory`, `learn`, `morning`.

### Como ativar em outra máquina
As skills próprias (`perfil-analise-dr-cesar`, `economia-tokens-sessao`) vivem
em `~/.claude/skills/<nome>/SKILL.md`. Copie a pasta da skill para a máquina
nova, ou coloque em `.claude/skills/` dentro do projeto para valer só ali.
`/skill-doctor` diagnostica skill que não está disparando.

---

## 3. CONECTORES / MCP ATIVOS NESTA SESSÃO

| Conector | Para que serve |
|---|---|
| **GitHub** (`mcp__github__*`) | PRs, issues, CI, comentários, arquivos. |
| **Claude Code Remote** | Criar/listar sessões, agendar Routines (`create_trigger`, `send_later`), anexar repositórios (`add_repo`). |
| **Gmail** | Ler, buscar, rascunhar, enviar, etiquetar. |
| **Google Drive** | Buscar, ler, criar, compartilhar arquivos. |
| **Notion** | Páginas, bancos de dados, busca — bom destino para o claude-master. |
| **Docusign** | Envelopes, templates, assinaturas, workflows. |
| **Windsor.ai** | 350+ conectores de dados (Meta Ads, Google Ads, GA4, Shopify, Stripe, BigQuery…), leitura e escrita. |

Ativar em outra máquina: Claude.ai → **Configurações → Conectores**. No Claude
Code, os MCP entram em `~/.claude.json` / `.mcp.json` do projeto.

---

## 4. AMBIENTE DESTA SESSÃO (2026-09-08)

- Sessão **remota** (nuvem), container efêmero — o que não for commitado some.
- Repositório visível: `usuariomaster/NOVO-APP` (Node: `server/` + `public/`).
- Outros repos da conta: `usuariomaster/FrontendExameBarato`,
  `usuariomaster/apiexamebarato` (ambos privados, parados desde 2022).
- Branch de trabalho: `claude/agenda-periodo-filter-fix-ma1pzz`.
- **O prontuário / cesar.ia NÃO está aqui.** Não existe `agenda/index.php`,
  nem `index.php`, nem `feriados.js` neste ambiente. Ele vive na máquina local
  ou na VPS. Isto vai se repetir: em sessão remota, tarefa no prontuário
  precisa ou de `add_repo` do repositório certo, ou de script para rodar lá.

---

## 5. O QUE FOI PRODUZIDO HOJE

### Tarefa: consertar o filtro do relatório de período da agenda (cesar.ia)

Causa já diagnosticada pelo Dr. Cesar (não rediagnosticada): a sequência
literal `</script>` dentro de uma string JS no `agenda/index.php` — no
`w.document.write()` do `imprimirPeriodo()` — fecha o bloco `<script>` e mata
todo o JS seguinte. Por isso `aplicarFiltroPeriodo`, `filtrarPeriodoStatus`,
`chipPeriodo` e `renderPeriodoOverlay` deixam de existir, código aparece como
texto na tela e o select/botões/cabeçalho renderizam como HTML.

Entregue (o arquivo-alvo não está nesta máquina, então o conserto virou
executável):

| Arquivo | O que é |
|---|---|
| `tools/agenda-periodo-fix/fix_periodo.py` | Script que executa os 4 passos: backup obrigatório, escapa o `</script>` de dentro da string, cria e aplica `normSt()`, move o bloco para `periodo.js` com uma linha antes do `</body>`. |
| `tools/agenda-periodo-fix/README.md` | Como rodar, o que cada passo faz, como desfazer. |
| `tools/agenda-periodo-fix/teste/index.php.antes` | Fixture que reproduz o bug. |
| `tools/agenda-periodo-fix/teste/teste.js` | Verifica os 5 critérios de pronto com DOM falso em Node. |

Comando na máquina do prontuário:
```bash
cd /caminho/do/prontuario/agenda && python3 fix_periodo.py
```

Critérios de pronto — 5/5 no fixture (não no arquivo real, que não está aqui):

1. `typeof aplicarFiltroPeriodo` → `"function"` — OK
2. Nada de código como texto (string escapada, `<script>` inline esvaziado) — OK
3. Chip filtra (3 de 5 visíveis) e clicar de novo volta a todos (5) — OK
4. Chip Falta aparece e filtra: `Falta` + `falta ` + `FALTOU` somam 3 em `faltou` — OK
5. Exportar e Imprimir funcionam; a janela filha recebe `</script>` literal correto — OK

Linhas trocadas no fixture:
- `w.document.write('<script>window.print();</script>')` → `<\/script>`
- `alias[tr.getAttribute('data-status')] || tr.getAttribute('data-status')` → `normSt(tr.getAttribute('data-status'))`
- `cont[st] = (cont[st]||0) + 1` → `cont[normSt(st)] = (cont[normSt(st)]||0) + 1`
- `function filtrarPeriodoStatus(st){` → ganha `st = normSt(st);`
- `tr.getAttribute('data-status') === st` → `normSt(tr.getAttribute('data-status')) === st`
- `var ordem = ['agendado','falta','atendido']` → `'faltou'`
- `const alias = {...};` → removido
- antes do `</body>`: `<script src="periodo.js?v=20260908"></script>`

Backup gerado pelo script: `_bak/index.php.bak-20260908-periodo`.

---

## 6. PENDÊNCIAS / PRÓXIMO PASSO

- [ ] Rodar `fix_periodo.py` na pasta `agenda/` do prontuário de verdade e
      conferir os 5 critérios no navegador.
- [ ] Se as 8 declarações estiverem escritas de outra forma no arquivo real, o
      script aborta sem gravar e diz quais faltaram — mandar a mensagem para
      ajustar o padrão.
- [ ] Decidir onde o prontuário/cesar.ia deve ficar versionado para as sessões
      remotas alcançarem (repositório próprio no GitHub resolve de vez).
- [ ] Levar este `claude-master` para o Notion ou Drive, para abrir de qualquer
      máquina sem depender de `git pull`.

## 7. IDEIAS DE MELHORIA (sugestões, decisão dele)

1. **Lint de `</script>` no CI.** Um grep simples que falha quando aparece
   `</script>` dentro de aspas em qualquer `.php` — o mesmo bug não volta.
2. **Versionar o prontuário no GitHub.** Resolve o problema de raiz: qualquer
   Claude, em qualquer máquina ou na nuvem, alcança o código.
3. **Continuar quebrando o `index.php` em `.js` por assunto** (já tem
   `feriados.js` de 05/09, agora `periodo.js`): arquivo grande é o que
   esconde esse tipo de defeito.
4. **`normSt()` num `util.js` compartilhado** quando outra tela precisar
   normalizar status — hoje ficou só no `periodo.js`, como combinado.
5. **Ativar a skill `fewer-permission-prompts`** nas outras máquinas: reduz
   direto o número de liberações que ele precisa dar.
