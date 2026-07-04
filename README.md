# SisPerícia — Sistema de Despachos da Perícia

Sistema web para a perícia dar despachos em processos vindos do **SEI de Nova
Iguaçu**. Ele extrai os processos do SEI, monta um **controle de processos**, o
**operador** distribui para o **perito**, o perito **despacha** e devolve, o
operador **confere** e **envia a resposta de volta ao SEI**.

## Fluxo

```
SEI ──(robô extrai)──▶ Em controle ──(operador distribui)──▶ Distribuído
   ──(perito despacha)──▶ A conferir ──(operador confere)──┬─ Aprovado ─▶ (robô LANÇA no SEI) ─▶ Enviado ─▶ Concluído
                                                           └─ Devolvido ─▶ (volta ao perito)
```

## Perfis

| Perfil        | O que faz                                                             |
|---------------|----------------------------------------------------------------------|
| **admin**     | Cadastra usuários e as credenciais de acesso ao SEI                   |
| **operador**  | Extrai do SEI, controla, distribui aos peritos, confere e envia ao SEI |
| **perito**    | Vê os processos atribuídos a ele e redige os despachos               |

## Como rodar

Requisitos: **Node.js 18.17+**.

```bash
npm install          # instala dependências e cria os usuários iniciais
npm start            # inicia em http://localhost:3000
```

Acesse **http://localhost:3000** e entre com um dos usuários criados
automaticamente (troque as senhas depois):

| E-mail                   | Senha        | Perfil    |
|--------------------------|--------------|-----------|
| admin@pericia.local      | admin123     | admin     |
| operador@pericia.local   | operador123  | operador  |
| perito@pericia.local     | perito123    | perito    |

## Extração do SEI

Aquele link do SEI (`controlador.php?...infra_hash=...`) é uma **sessão
autenticada** — só abre para quem já está logado na unidade. Por isso o robô
faz o **login** com usuário/senha e navega até o *Controle de Processos*.

O sistema já vem em **modo simulação** (`SEI_MOCK=true`), que devolve processos
de exemplo para você testar tudo de ponta a ponta **sem credenciais**.

Para usar o **SEI real**:

1. Copie `.env.example` para `.env`.
2. Ajuste `SEI_BASE_URL` e coloque `SEI_MOCK=false`.
3. Instale o navegador do robô: `npx playwright install chromium`.
4. Entre como **admin → Configuração do SEI** e cadastre o usuário/senha da
   unidade (a senha é guardada **criptografada**). Informe a `unidade`
   (`infra_unidade_atual`, ex.: `110001126`) e o `órgão`, se o login pedir.
5. Como **operador**, clique em **Extrair do SEI**.

> Os seletores de login/lista seguem o padrão do SEI 4.x
> (`server/sei/scraper.js`). Se a instalação de Nova Iguaçu tiver layout
> diferente, ajuste os seletores nesse arquivo — o restante do sistema não muda.

## Configuração (`.env`)

| Variável        | Padrão                                          | Descrição                                   |
|-----------------|-------------------------------------------------|---------------------------------------------|
| `PORT`          | `3000`                                          | Porta do servidor                           |
| `APP_SECRET`    | *(troque!)*                                     | Segredo de sessão e criptografia de senhas  |
| `SEI_BASE_URL`  | `https://sei.novaiguacu.rj.gov.br/sei`          | URL base do SEI                             |
| `SEI_MOCK`      | `true`                                          | `true` = dados de exemplo; `false` = SEI real |
| `SEI_HEADFUL`   | `false`                                         | `true` abre o navegador do robô com janela  |

## Lançamento automático do despacho no SEI (sem web service)

Depois que o operador **aprova** o despacho, o botão **Enviar resposta ao SEI**
aciona o **robô de escrita** (`server/sei/writer.js`), que **não depende do web
service oficial nem do TI do município**: ele automatiza a própria tela do SEI,
como a operadora faria à mão —

1. faz **login** no SEI;
2. abre o processo pelo número (pesquisa rápida);
3. clica em **Incluir Documento** e escolhe o tipo **Despacho**;
4. define o **nível de acesso** e salva o formulário;
5. escreve o texto do despacho no editor e **salva**;
6. (opcional) **envia o processo** para a unidade de destino configurada.

A cada lançamento é gerado um **comprovante em imagem** (guardado em
`data/comprovantes/`), acessível pelo botão *Ver comprovante* na tela do
processo. Tudo fica na **trilha de auditoria**.

O tipo de documento, o nível de acesso e a unidade de destino são definidos em
**Configuração do SEI**. Como cada órgão personaliza os tipos de documento e o
tema da tela, os seletores ficam centralizados em `SEL` (dentro de
`server/sei/scraper.js`) para ajuste fino. Recomenda-se a **primeira execução
com `SEI_HEADFUL=true`** (navegador visível) para conferir o passo a passo.

## Segurança e observações

- Senhas de usuários com **bcrypt**; credenciais do SEI com **AES-256-GCM**.
  As credenciais **nunca** são versionadas nem exibidas — ficam só no banco
  local, cadastradas pela tela de Configuração do SEI.
- O lançamento no SEI só ocorre após **conferência do operador**, e cada passo
  é registrado com comprovante para auditoria.
- Banco de dados **SQLite** em `data/sispericia.sqlite` (criado automaticamente).

## Estrutura

```
server/
  index.js              # servidor Express
  db.js                 # esquema SQLite + auditoria
  auth.js               # login, sessão e papéis
  seed.js               # usuários iniciais
  sei/
    scraper.js          # robô Playwright de extração (+ modo simulação)
    crypto.js           # criptografia das credenciais do SEI
  routes/               # auth, usuários, sei, processos, despachos
public/                 # front-end (HTML/CSS/JS, sem build)
```
