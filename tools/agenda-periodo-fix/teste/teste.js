const fs=require('fs');
// ---- DOM falso: 5 linhas, com 'Falta' e 'falta' escritos de jeitos diferentes
const linhas=[{s:'agendado'},{s:'Falta'},{s:'falta '},{s:'FALTOU'},{s:'atendido'}]
  .map(o=>({style:{display:''},getAttribute:k=>k==='data-status'?o.s:null}));
let saidaImpressa='';
const chips={};
global.document={querySelectorAll:()=>linhas};
global.window={open:()=>({document:{write:t=>{saidaImpressa+=t}}})};
global.console={log:(k,n)=>{chips[k]=n}};
eval(fs.readFileSync('periodo.js','utf8'));
const visiveis=()=>linhas.filter(t=>t.style.display!=='none').length;
const ok=b=>b?'OK':'FALHOU';
const R=[];

R.push(['1. typeof aplicarFiltroPeriodo', ok(typeof aplicarFiltroPeriodo==='function'), typeof aplicarFiltroPeriodo]);

const cru=fs.readFileSync('periodo.js','utf8').includes("write('<script>window.print();</script>')");
const php=fs.readFileSync('index.php','utf8');
const jsSolto=/<script>\s*[a-zA-Z{(]/.test(php);
R.push(['2. nada de codigo como texto', ok(!cru && !jsSolto), 'string </script> escapada; <script> inline vazio']);

aplicarFiltroPeriodo();
const contFalta=chips['faltou'];
filtrarPeriodoStatus('falta');
const depoisFiltro=visiveis();
filtrarPeriodoStatus('');
const depoisToggle=visiveis();
R.push(['3. chip filtra / volta a todos', ok(depoisFiltro===3 && depoisToggle===5), depoisFiltro+' visiveis filtrando, '+depoisToggle+' ao voltar']);
R.push(['4. chip Falta aparece e filtra', ok(contFalta===3), "contador 'faltou' = "+contFalta+" (Falta + falta + FALTOU somados)"]);

let erro=null;
try{ imprimirPeriodo(); exportarPeriodo(); }catch(e){ erro=e.message }
const fechaCerto=saidaImpressa.includes('<script>window.print();</script>');
R.push(['5. Exportar e Imprimir', ok(!erro && fechaCerto), erro?('erro: '+erro):'janela filha recebeu </script> literal correto']);

console.log=(...a)=>process.stdout.write(a.join(' ')+'\n');
for(const [n,s,d] of R) console.log(`[${s}] ${n} -> ${d}`);
process.exit(R.every(r=>r[1]==='OK')?0:1);
