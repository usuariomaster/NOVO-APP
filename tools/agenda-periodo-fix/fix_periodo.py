#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_periodo.py — conserta o filtro do relatorio de periodo da agenda (cesar.ia).

Executa, em ordem, exatamente os 4 passos combinados:

  1. Backup obrigatorio  -> _bak/index.php.bak-<AAAAMMDD>-periodo
  2. Escapa o </script> que esta DENTRO de string JS  -> <\\/script>
     (nao toca no </script> que fecha o bloco de verdade)
  3. Cria normSt(s) e aplica em 3 pontos: cont[st], tr.getAttribute('data-status')
     e filtrarPeriodoStatus(); troca 'falta' -> 'faltou' no array ordem;
     remove o mapa alias.
  4. Move o bloco (imprimirPeriodo, exportarPeriodo, STATUS_PT, STATUS_COR,
     aplicarFiltroPeriodo, filtrarPeriodoStatus, chipPeriodo, renderPeriodoOverlay)
     para agenda/periodo.js, incluido por UMA linha antes do </body>.

Nada de codigo novo alem disso. Nenhuma funcao fora da lista e reescrita.

USO (dentro da pasta agenda/ do prontuario):
    python3 fix_periodo.py                 # aplica
    python3 fix_periodo.py --dry-run       # so mostra o que faria
    python3 fix_periodo.py --file index.php --out periodo.js

Se qualquer passo nao encontrar o que espera, o script ABORTA sem gravar nada
e diz exatamente o que nao bateu. Backup sempre antes de qualquer escrita.
"""

import argparse
import datetime
import os
import re
import shutil
import sys

FUNCS = [
    "imprimirPeriodo",
    "exportarPeriodo",
    "STATUS_PT",
    "STATUS_COR",
    "aplicarFiltroPeriodo",
    "filtrarPeriodoStatus",
    "chipPeriodo",
    "renderPeriodoOverlay",
]

NORMST = (
    "function normSt(s){\n"
    "  s = String(s == null ? '' : s).trim().toLowerCase();\n"
    "  return s === 'falta' ? 'faltou' : s;\n"
    "}\n"
)

log = []


def diga(msg):
    log.append(msg)
    print(msg)


def morra(msg):
    print("\n[ABORTADO] " + msg, file=sys.stderr)
    print("Nada foi gravado.", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------- passo 2 ----

def blocos_script(src):
    """Devolve [(ini_conteudo, fim_conteudo_aprox)] de cada <script ...> ... </script>."""
    out = []
    for m in re.finditer(r"<script\b[^>]*>", src, re.I):
        ini = m.end()
        f = re.search(r"</script\s*>", src[ini:], re.I)
        fim = ini + f.start() if f else len(src)
        out.append((ini, fim))
    return out


def escapar_script_em_string(src):
    """
    Varre o JS de cada bloco <script> com um mini-scanner de estado
    (string ' " `, comentario // e /* */) e escapa APENAS os </script>
    encontrados dentro desses estados. O </script> real fica intacto.
    """
    trocas = []
    i = 0
    n = len(src)
    saida = []
    dentro_script = False
    estado = None       # None | "'" | '"' | '`' | 'linha' | 'bloco'
    linha_atual = 1

    while i < n:
        c = src[i]
        if c == "\n":
            linha_atual += 1

        if not dentro_script:
            m = re.match(r"<script\b[^>]*>", src[i:], re.I)
            if m:
                saida.append(src[i:i + m.end()])
                i += m.end()
                dentro_script = True
                estado = None
                continue
            saida.append(c)
            i += 1
            continue

        # ---- dentro de um bloco <script> ----
        if estado in ("'", '"', "`"):
            if c == "\\":
                saida.append(src[i:i + 2])
                i += 2
                continue
            if c == estado:
                estado = None
                saida.append(c)
                i += 1
                continue
            if src[i:i + 9].lower() == "</script>":
                saida.append("<\\/script>")
                trocas.append((linha_atual, "dentro de string %s" % estado))
                i += 9
                continue
            saida.append(c)
            i += 1
            continue

        if estado == "linha":
            if c == "\n":
                estado = None
            if src[i:i + 9].lower() == "</script>" and estado == "linha":
                saida.append("<\\/script>")
                trocas.append((linha_atual, "dentro de comentario //"))
                i += 9
                continue
            saida.append(c)
            i += 1
            continue

        if estado == "bloco":
            if src[i:i + 2] == "*/":
                estado = None
                saida.append("*/")
                i += 2
                continue
            if src[i:i + 9].lower() == "</script>":
                saida.append("<\\/script>")
                trocas.append((linha_atual, "dentro de comentario /* */"))
                i += 9
                continue
            saida.append(c)
            i += 1
            continue

        # estado neutro (codigo)
        if src[i:i + 2] == "//":
            estado = "linha"
            saida.append("//")
            i += 2
            continue
        if src[i:i + 2] == "/*":
            estado = "bloco"
            saida.append("/*")
            i += 2
            continue
        if c in ("'", '"', "`"):
            estado = c
            saida.append(c)
            i += 1
            continue
        if src[i:i + 9].lower() == "</script>":
            # este e o </script> de verdade: fecha o bloco, nao mexe
            saida.append(src[i:i + 9])
            i += 9
            dentro_script = False
            estado = None
            continue
        saida.append(c)
        i += 1

    return "".join(saida), trocas


# ------------------------------------------------------------ passos 3 e 4 ---

def acha_bloco(js):
    """
    Acha o range [ini, fim) que cobre as declaracoes das FUNCS dentro do JS,
    usando balanceamento de chaves a partir da primeira ate a ultima.
    """
    achadas = {}
    for nome in FUNCS:
        pats = [
            r"(?m)^[ \t]*function\s+%s\s*\(" % re.escape(nome),
            r"(?m)^[ \t]*(?:const|let|var)\s+%s\b" % re.escape(nome),
            r"(?m)^[ \t]*window\.%s\s*=" % re.escape(nome),
        ]
        for p in pats:
            m = re.search(p, js)
            if m:
                achadas[nome] = m.start()
                break
    faltando = [f for f in FUNCS if f not in achadas]
    if faltando:
        return None, faltando, achadas
    ini = min(achadas.values())
    ultima = max(achadas.values())
    fim = fim_declaracao(js, ultima)
    return (ini, fim), [], achadas


def fim_declaracao(js, pos):
    """
    Fim da declaracao que comeca em pos.
    Balanceia { [ ( saltando strings e comentarios. So encerra quando a
    profundidade volta a zero fechando um } ou ] (o ) da lista de parametros
    nao encerra nada) e o proximo token nao continua a expressao, ou quando
    encontra um ; na profundidade zero. Consome o ; final.
    """
    i = pos
    n = len(js)
    prof = 0
    abriu = False
    estado = None
    while i < n:
        c = js[i]
        if estado in ("'", '"', "`"):
            if c == "\\":
                i += 2
                continue
            if c == estado:
                estado = None
            i += 1
            continue
        if estado == "linha":
            if c == "\n":
                estado = None
            i += 1
            continue
        if estado == "bloco":
            if js[i:i + 2] == "*/":
                estado = None
                i += 2
                continue
            i += 1
            continue
        if js[i:i + 2] == "//":
            estado = "linha"
            i += 2
            continue
        if js[i:i + 2] == "/*":
            estado = "bloco"
            i += 2
            continue
        if c in ("'", '"', "`"):
            estado = c
            i += 1
            continue
        if c in "{[(":
            prof += 1
            abriu = True
            i += 1
            continue
        if c in "}])":
            prof -= 1
            i += 1
            if prof == 0 and abriu and c in "}]":
                j = i
                while j < n and js[j] in " \t\r":
                    j += 1
                if j < n and js[j] == ";":
                    return j + 1
                # se a expressao continua (chamada, cadeia, arrow), nao encerra
                if j < n and (js[j] in "(.)," or js[j:j + 2] == "=>"):
                    continue
                return i
            continue
        if c == ";" and prof == 0 and abriu:
            return i + 1
        if c == "\n" and prof == 0 and not abriu:
            return i + 1
        i += 1
    return n


def aplicar_normst(bloco):
    """Passo 3, aplicado apenas dentro do bloco que vai para periodo.js."""
    mudou = []

    # 3.1 cont[st] -> cont[normSt(st)]
    novo, k = re.subn(r"\bcont\[\s*st\s*\]", "cont[normSt(st)]", bloco)
    if k:
        bloco = novo
        mudou.append("cont[st] -> cont[normSt(st)]  (%dx)" % k)

    # 3.2 getAttribute('data-status') -> normSt(getAttribute('data-status'))
    pat = re.compile(r"(?<!normSt\()((?:\w+\.)*getAttribute\(\s*['\"]data-status['\"]\s*\))")
    novo, k = re.subn(pat, r"normSt(\1)", bloco)
    if k:
        bloco = novo
        mudou.append("getAttribute('data-status') -> normSt(...)  (%dx)" % k)

    # 3.3 normaliza o argumento de filtrarPeriodoStatus
    m = re.search(r"function\s+filtrarPeriodoStatus\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{", bloco)
    if m:
        arg = m.group(1)
        if ("%s = normSt(%s)" % (arg, arg)) not in bloco:
            bloco = bloco[:m.end()] + "\n  %s = normSt(%s);" % (arg, arg) + bloco[m.end():]
            mudou.append("filtrarPeriodoStatus(%s): normalizado com normSt" % arg)
    else:
        m2 = re.search(r"(?:const|let|var)\s+filtrarPeriodoStatus\s*=\s*(?:function\s*)?\(\s*([A-Za-z_$][\w$]*)\s*\)\s*(?:=>\s*)?\{", bloco)
        if m2:
            arg = m2.group(1)
            if ("%s = normSt(%s)" % (arg, arg)) not in bloco:
                bloco = bloco[:m2.end()] + "\n  %s = normSt(%s);" % (arg, arg) + bloco[m2.end():]
                mudou.append("filtrarPeriodoStatus(%s): normalizado com normSt" % arg)

    # 3.4 array ordem: 'falta' -> 'faltou'
    def _ordem(m):
        return m.group(1) + re.sub(r"(['\"])falta\1", r"\1faltou\1", m.group(2)) + m.group(3)

    novo, k = re.subn(r"((?:const|let|var)\s+ordem\s*=\s*\[)([^\]]*)(\])", _ordem, bloco)
    if k and novo != bloco:
        bloco = novo
        mudou.append("array ordem: 'falta' -> 'faltou'")

    # 3.5 remove o mapa alias
    novo, k = re.subn(r"(?m)^[ \t]*(?:const|let|var)\s+alias\s*=\s*\{[^}]*\}\s*;?[ \t]*\r?\n", "", bloco)
    if k:
        bloco = novo
        mudou.append("mapa alias removido (%dx)" % k)
    novo, k = re.subn(r"\balias\[\s*([^\]]+?)\s*\]\s*\|\|\s*", "", bloco)
    if k:
        bloco = novo
        mudou.append("usos de alias[...] || removidos (%dx)" % k)

    if "function normSt(" not in bloco:
        bloco = NORMST + "\n" + bloco
        mudou.append("normSt(s) criada no topo de periodo.js")

    return bloco, mudou


# ---------------------------------------------------------------------- main -

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="index.php")
    ap.add_argument("--out", default="periodo.js")
    ap.add_argument("--bakdir", default="_bak")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if not os.path.isfile(a.file):
        morra("nao achei %s. Rode este script dentro da pasta agenda/ do prontuario."
              % a.file)

    src = open(a.file, encoding="utf-8", errors="surrogateescape").read()
    original = src

    # ---- passo 1: backup
    hoje = datetime.date.today().strftime("%Y%m%d")
    bak = os.path.join(a.bakdir, "%s.bak-%s-periodo" % (os.path.basename(a.file), hoje))
    if not a.dry_run:
        os.makedirs(a.bakdir, exist_ok=True)
        shutil.copy2(a.file, bak)
    diga("[1] backup: %s" % bak + ("  (dry-run: nao gravado)" if a.dry_run else ""))

    # ---- passo 2: </script> dentro de string
    src, trocas = escapar_script_em_string(src)
    if trocas:
        for ln, onde in trocas:
            diga("[2] linha %d: </script> -> <\\/script>   (%s)" % (ln, onde))
    else:
        diga("[2] nenhum </script> dentro de string/comentario "
             "(ja corrigido antes, ou o problema esta em outro arquivo)")

    # ---- passos 3 e 4: recortar o bloco
    blocos = blocos_script(src)
    if not blocos:
        morra("nenhum bloco <script> encontrado em %s" % a.file)

    alvo = None
    for (ini, fim) in blocos:
        js = src[ini:fim]
        rng, faltando, achadas = acha_bloco(js)
        if rng:
            alvo = (ini, fim, rng, achadas)
            break
    if not alvo:
        morra("nao achei as 8 declaracoes juntas em um mesmo <script>. "
              "Faltaram: %s. Rode com --dry-run e confira os nomes." % ", ".join(faltando))

    ini, fim, (b0, b1), achadas = alvo
    js = src[ini:fim]
    bloco = js[b0:b1]

    ordem_txt = ", ".join(sorted(achadas, key=lambda k: achadas[k]))
    diga("[4] bloco recortado do <script>: %d caracteres, na ordem: %s"
         % (len(bloco), ordem_txt))

    bloco, mudou = aplicar_normst(bloco)
    for m in mudou:
        diga("[3] %s" % m)

    # remove o bloco do PHP e injeta a linha antes do </body>
    novo_js = js[:b0] + js[b1:]
    src = src[:ini] + novo_js + src[fim:]

    tag = '<script src="periodo.js?v=%s"></script>' % hoje
    if "periodo.js" in src:
        diga("[4] periodo.js ja estava incluido; linha nao duplicada")
    else:
        m = re.search(r"</body\s*>", src, re.I)
        if not m:
            morra("nao achei </body> para inserir a linha do periodo.js")
        src = src[:m.start()] + tag + "\n" + src[m.start():]
        diga("[4] inserido antes do </body>: %s" % tag)

    if a.dry_run:
        diga("\n(dry-run) nada gravado. %s ficaria com %d caracteres; %s com %d."
             % (a.file, len(src), a.out, len(bloco)))
        return

    if src == original and os.path.exists(a.out):
        diga("\nNada a fazer: ja estava corrigido.")
        return

    open(a.out, "w", encoding="utf-8").write(bloco.strip() + "\n")
    open(a.file, "w", encoding="utf-8", errors="surrogateescape").write(src)
    diga("[ok] gravados: %s e %s" % (a.file, a.out))

    if shutil.which("php"):
        rc = os.system("php -l %s" % a.file)
        diga("[ok] php -l: %s" % ("passou" if rc == 0 else "FALHOU — restaure %s" % bak))

    print("\nSe algo saiu errado:  cp %s %s" % (bak, a.file))


if __name__ == "__main__":
    main()
