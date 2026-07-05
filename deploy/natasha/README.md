# Integração Natasha (WhatsApp) ⇄ SisPerícia — porta 1

A Natasha **já fala** com a perícia pelo contrato GRO (`?acao=pericia_intake`,
header `X-Natasha-Token`, token do cofre `integra_gro_natasha`). O SisPerícia
implementa esse mesmo contrato em `/api/natasha`. Este diretório traz o que
falta do **lado da Natasha**: consumir a **fila de saída** (avisos que a
perícia manda ao servidor).

Nenhum token novo: os dois lados usam o **mesmo segredo do cofre**
(`integra_gro_natasha.key`, 64 chars). Não precisa digitar nada.

## 1. Configuração (uma vez, no VPS da Natasha)

No `/etc/natasha/config.json` acrescente o bloco `gro` apontando para o
SisPerícia e com o token do cofre:

```json
{
  "wa_token": "…(já existe)…",
  "phone_id": "…(já existe)…",
  "gro": {
    "url":   "http://69.6.251.217:3000/api/natasha",
    "token": "<conteúdo de integra_gro_natasha.key (64 chars)>"
  }
}
```

> O SisPerícia lê o **mesmo** token automaticamente (env `NATASHA_TOKEN`,
> `gro.token` do `config.json`, ou o `.key` do cofre) — ver
> `server/routes/natasha.routes.js`. Basta o valor bater dos dois lados.

## 2. Entrada de perícia (a Natasha já faz — referência)

Quando um servidor manda documento pelo WhatsApp, a Natasha chama:

```php
$r = http_json('POST', "$BASE?acao=pericia_intake",
  ["X-Natasha-Token: $TOKEN", 'Content-Type: application/json'], [
    'cpf'      => '111.222.333-44',
    'nome'     => 'Maria da Silva',
    'telefone' => '5521999998888',      // vira o WhatsApp do servidor
    'assunto'  => 'Solicita perícia — atestado 15 dias',
    'texto'    => 'CID M54.5 — lombalgia (OCR do documento)',
]);
// retorno: { ok, pericia_id, servidor:{id,nome,cpf}, nota }
```

Isso **cria/atualiza o servidor por CPF** e **abre o caso na Caixa de
entrada** (canal WhatsApp, aguardando triagem).

## 3. Fila de saída (o que este diretório adiciona)

O SisPerícia enfileira avisos em `wa_outbox`. O poller PHP puxa, envia pela
Graph API e confirma:

- `GET  /api/natasha?acao=outbox`      → `{ mensagens:[{id,telefone,texto,processo_id}] }`
- `POST /api/natasha?acao=outbox_ack`  → `{ id, status:"enviado"|"erro" }`

### Instalar o poller

```bash
cp sispericia_outbox_poller.php /etc/natasha/sispericia_outbox_poller.php
# testar à mão:
php /etc/natasha/sispericia_outbox_poller.php
# agendar (a cada 1 min):
( crontab -l 2>/dev/null; echo '* * * * * /usr/bin/php /etc/natasha/sispericia_outbox_poller.php >> /var/log/sispericia_outbox.log 2>&1' ) | crontab -
```

## 4. Ações disponíveis na porta `/api/natasha`

| Método | `?acao=`         | O que faz                                            |
|--------|------------------|------------------------------------------------------|
| POST   | `pericia_intake` | cria/atualiza servidor por CPF e abre o caso na fila |
| POST   | `anexo`          | anexa documento (texto/OCR) a um caso já aberto       |
| POST   | `servidor_upsert`| cria/atualiza servidor sem abrir caso                 |
| GET    | `servidor`       | consulta servidor por CPF                             |
| GET    | `afastamentos`   | histórico de afastamentos do servidor (por CPF)       |
| GET    | `outbox`         | mensagens pendentes p/ a Natasha enviar               |
| POST   | `outbox_ack`     | confirma envio (`enviado`/`erro`)                     |

Todas exigem o header `X-Natasha-Token` (ou `?token=`).
