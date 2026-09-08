# Conserto do filtro de período da agenda (cesar.ia / prontuário)

## Por que isto está aqui e não aplicado direto

A sessão remota do Claude só enxerga o repositório `usuariomaster/NOVO-APP`
(app Node: `server/` + `public/`). O prontuário com `agenda/index.php` está na
sua máquina/VPS, fora do alcance desta sessão. Então o conserto foi entregue
como script que executa os 4 passos exatamente como especificados — você roda
uma linha na pasta certa e está feito.

## Como rodar

```bash
cd /caminho/do/prontuario/agenda
python3 fix_periodo.py --dry-run   # mostra o que vai fazer, não grava nada
python3 fix_periodo.py             # aplica (backup automático antes)
```

Desfazer: `cp _bak/index.php.bak-<AAAAMMDD>-periodo index.php`

## O que o script faz, passo a passo

| Passo | Ação |
|---|---|
| 1 | Backup obrigatório em `_bak/index.php.bak-<AAAAMMDD>-periodo` |
| 2 | Escapa `</script>` que está **dentro de string/comentário JS** → `<\/script>`. O `</script>` que fecha o bloco de verdade fica intacto. |
| 3 | Cria `normSt(s)`; aplica em `cont[st]`, em `tr.getAttribute('data-status')` e no `filtrarPeriodoStatus()`; troca `'falta'` → `'faltou'` no array `ordem`; remove o mapa `alias` e seus usos. |
| 4 | Move as 8 declarações para `periodo.js` e insere **uma** linha antes do `</body>`, no mesmo padrão do `feriados.js`. |

Declarações movidas: `imprimirPeriodo`, `exportarPeriodo`, `STATUS_PT`,
`STATUS_COR`, `aplicarFiltroPeriodo`, `filtrarPeriodoStatus`, `chipPeriodo`,
`renderPeriodoOverlay`. Nenhuma função fora dessa lista é reescrita.

### Como o passo 2 distingue os dois `</script>`

Mini-scanner de estado do JS (string `'`, `"`, `` ` ``, comentário `//` e
`/* */`). Um `</script>` encontrado **em estado de string ou comentário** é
falso e vira `<\/script>`; um encontrado em estado neutro é o fechamento real
do bloco e não é tocado. Nada de regex cega sobre o arquivo inteiro.

### Segurança

O script **aborta sem gravar** se: não achar `index.php`, não achar as 8
declarações num mesmo `<script>`, ou não achar `</body>`. É idempotente —
rodar duas vezes não duplica a linha do `periodo.js` nem re-escapa nada.
Ao final roda `php -l` se o PHP estiver instalado.

## Teste

`teste/index.php.antes` reproduz o bug (`w.document.write('<script>…</script>')`
dentro de `imprimirPeriodo`, mapa `alias`, `'falta'` no array `ordem`).
`teste/teste.js` verifica os 5 critérios de pronto com DOM falso em Node.

```bash
cd teste && cp index.php.antes index.php
python3 ../fix_periodo.py && node teste.js
```

Resultado em 2026-09-08 — 5/5:

```
[OK] 1. typeof aplicarFiltroPeriodo -> function
[OK] 2. nada de codigo como texto -> string </script> escapada; <script> inline vazio
[OK] 3. chip filtra / volta a todos -> 3 visiveis filtrando, 5 ao voltar
[OK] 4. chip Falta aparece e filtra -> contador 'faltou' = 3 (Falta + falta + FALTOU somados)
[OK] 5. Exportar e Imprimir -> janela filha recebeu </script> literal correto
```

## Depois de rodar no prontuário de verdade

1. Ctrl+Shift+R na tela do relatório de período (o `?v=` na tag já força, mas
   não custa).
2. Console: `typeof aplicarFiltroPeriodo` deve responder `"function"`.
3. Clicar no chip filtra e o contador muda; clicar de novo volta a todos.
4. O chip Falta aparece e filtra.
5. Exportar e Imprimir continuam funcionando.

Se o passo 4 do script abortar dizendo que faltaram declarações, é porque no
arquivo real elas estão escritas em outra forma (ex.: `window.chipPeriodo =`
com indentação diferente). Rode com `--dry-run`, me mande a mensagem de erro e
eu ajusto o padrão — sem mexer em nada fora da lista.
