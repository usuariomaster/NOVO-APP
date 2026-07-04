# SisPerícia — Sistema de Despachos da Perícia

Sistema web para a perícia dar despachos em processos vindos do **SEI de Nova
Iguaçu**. Ele extrai os processos do SEI, monta um **controle de processos**, o
**operador** distribui para o **perito**, o perito **despacha** e devolve, o
operador **confere** e **envia a resposta de volta ao SEI**.

## Fluxo

```
SEI ──(robô extrai)──▶ Em controle ──(operador distribui)──▶ Distribuído
   ──(perito despacha)──▶ A conferir ──(operador confere)──┬─ Aprovado ─▶ Enviado ao SEI ─▶ Concluído
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

## Segurança e observações

- Senhas de usuários com **bcrypt**; credenciais do SEI com **AES-256-GCM**.
- O **lançamento** do despacho de volta no SEI é feito pelo operador na tela do
  SEI; o sistema registra o envio e mantém a trilha de auditoria. A escrita
  automática no SEI depende da integração oficial liberada pelo órgão e pode
  ser adicionada depois.
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
