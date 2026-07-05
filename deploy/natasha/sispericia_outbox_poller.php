<?php
// ============================================================
// SisPerícia · Poller da fila de saída (roda no VPS da Natasha)
// ------------------------------------------------------------
// A perícia (SisPerícia) enfileira mensagens que devem ser enviadas ao
// servidor pelo WhatsApp (ex.: "sua perícia foi concluída"). Este script
// PUXA essa fila e envia cada mensagem pela Graph API, depois CONFIRMA o
// envio (outbox_ack) para não reenviar.
//
// Não pede token novo: usa o MESMO segredo do cofre (integra_gro_natasha)
// que a Natasha já compartilha com a perícia (contrato GRO).
//
// Rode por cron, a cada 1 min:
//   * * * * * /usr/bin/php /etc/natasha/sispericia_outbox_poller.php >> /var/log/sispericia_outbox.log 2>&1
// ============================================================

// ---- 1) Configuração (mesmo /etc/natasha/config.json da Natasha) ----
$CFG_PATH = getenv('NATASHA_CONFIG') ?: '/etc/natasha/config.json';
$cfg = is_readable($CFG_PATH) ? json_decode(file_get_contents($CFG_PATH), true) : [];
if (!is_array($cfg)) $cfg = [];

// URL da API da perícia e token compartilhado (bloco "gro" do config).
$gro       = $cfg['gro'] ?? [];
$BASE      = rtrim($gro['url'] ?? getenv('SISPERICIA_URL') ?: 'http://69.6.251.217:3000/api/natasha', '/');
$TOKEN     = $gro['token'] ?? ($cfg['gro_token'] ?? ($cfg['integra']['gro_natasha'] ?? getenv('NATASHA_TOKEN') ?: ''));

// Fallback: lê o token direto do arquivo .key do cofre, se existir aqui.
if (!$TOKEN) {
  foreach (['/etc/natasha/integra_gro_natasha.key',
            '/home1/drcesarferreirac/cofre-ia/integra_gro_natasha.key',
            '/opt/cofre-ia/integra_gro_natasha.key'] as $k) {
    if (is_readable($k)) { $TOKEN = trim(file_get_contents($k)); if ($TOKEN) break; }
  }
}

// Credenciais do WhatsApp (Graph API) — já existentes na Natasha.
$WA_TOKEN  = $cfg['wa_token'] ?? getenv('WA_TOKEN') ?: '';
$PHONE_ID  = $cfg['phone_id'] ?? getenv('WA_PHONE_ID') ?: '';
$GRAPH_VER = $cfg['graph_version'] ?? 'v20.0';

function logline($m) { echo '[' . date('Y-m-d H:i:s') . "] $m\n"; }

if (!$TOKEN)    { logline('ERRO: token da perícia (cofre) não encontrado.'); exit(1); }
if (!$WA_TOKEN || !$PHONE_ID) { logline('ERRO: wa_token/phone_id ausentes no config.'); exit(1); }

// ---- 2) Helper HTTP ----
function http_json($method, $url, $headers = [], $body = null) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 20,
    CURLOPT_HTTPHEADER     => $headers,
  ]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);
  return [$code, $resp, $err];
}

// ---- 3) Puxa a fila de saída da perícia ----
list($code, $resp) = http_json('GET', "$BASE?acao=outbox", ["X-Natasha-Token: $TOKEN"]);
if ($code !== 200) { logline("ERRO ao ler outbox (HTTP $code): $resp"); exit(1); }
$data = json_decode($resp, true);
$msgs = $data['mensagens'] ?? [];
if (!$msgs) { logline('Nada na fila.'); exit(0); }

logline(count($msgs) . ' mensagem(ns) na fila.');

// ---- 4) Envia cada mensagem e confirma (ack) ----
foreach ($msgs as $m) {
  $id   = $m['id'];
  $to   = preg_replace('/\D/', '', $m['telefone'] ?? '');
  $text = $m['texto'] ?? '';
  if (!$to || !$text) { ack($BASE, $TOKEN, $id, 'erro'); logline("msg $id sem telefone/texto — marcada erro."); continue; }

  $payload = [
    'messaging_product' => 'whatsapp',
    'to'                => $to,
    'type'              => 'text',
    'text'              => ['body' => $text],
  ];
  list($wc, $wr, $we) = http_json(
    'POST',
    "https://graph.facebook.com/$GRAPH_VER/$PHONE_ID/messages",
    ["Authorization: Bearer $WA_TOKEN", 'Content-Type: application/json'],
    $payload
  );
  if ($wc >= 200 && $wc < 300) {
    ack($BASE, $TOKEN, $id, 'enviado');
    logline("msg $id enviada para $to.");
  } else {
    ack($BASE, $TOKEN, $id, 'erro');
    logline("msg $id FALHOU (HTTP $wc): " . substr($wr ?: $we, 0, 200));
  }
}

// Confirma o envio (ou erro) de volta na perícia, para não reenviar.
function ack($base, $token, $id, $status) {
  http_json('POST', "$base?acao=outbox_ack",
    ["X-Natasha-Token: $token", 'Content-Type: application/json'],
    ['id' => $id, 'status' => $status]);
}
