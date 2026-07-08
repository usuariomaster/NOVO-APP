# MedTran — Site institucional (clínica credenciada DETRAN)

Site institucional completo para a **MedTran**, clínica de **exames médicos e
psicológicos** para candidatos à CNH (credenciada DETRAN). Visual "psicodélico
premium": gradientes vibrantes, blobs animados, glassmorphism e animações de
scroll — feito em **HTML/CSS/JS puro, sem build**.

> Independente do sistema SisPerícia que vive na raiz deste repositório —
> tudo do site fica isolado em `sites-medtran/`.

## Páginas

| Arquivo               | Página            | Conteúdo                                                        |
|-----------------------|-------------------|----------------------------------------------------------------|
| `index.html`          | Início            | Hero com agendamento rápido, serviços, números, preços, depoimentos |
| `servicos.html`       | Serviços          | Exame médico, psicológico e cada tipo de habilitação (renovação, 1ª, categoria, EAR) |
| `como-funciona.html`  | Como funciona     | Passo a passo do agendamento ao laudo + FAQ                    |
| `sobre.html`          | A clínica         | História, valores, equipe e estrutura                          |
| `contato.html`        | Contato           | Formulário de agendamento, canais, horários e localização     |

## Estrutura

```
sites-medtran/
  index.html
  servicos.html
  como-funciona.html
  sobre.html
  contato.html
  css/style.css      # design system completo (tokens, componentes, responsivo)
  js/main.js         # header ao rolar, menu mobile, reveal, contadores, forms
```

## Como visualizar

É estático — basta abrir `index.html` no navegador. Para servir localmente
(recomendado, evita restrições de `file://`):

```bash
cd sites-medtran
python3 -m http.server 8080
# abra http://localhost:8080
```

## Personalização rápida

- **Cores / identidade:** variáveis no topo de `css/style.css` (bloco `:root`).
- **Telefone / WhatsApp:** procure por `5521900000000` e `2133330000` e troque
  pelos números reais (aparecem no header, rodapé, botão flutuante e CTAs).
- **Endereço, e-mail, CNPJ:** editáveis diretamente no rodapé de cada página e
  na página `contato.html`.
- **Preços:** seção `#precos` em `index.html`. São valores de referência —
  ajuste conforme a tabela oficial do DETRAN.
- **Formulários:** hoje têm envio simulado (`data-mock` em `js/main.js`, apenas
  feedback visual). Para receber de verdade, aponte o `action` do `<form>` para
  seu back-end, e-mail ou serviço de formulário.

## Observações

- Conteúdo (equipe, números, endereço) é **ilustrativo/demonstrativo** — troque
  pelos dados reais da clínica antes de publicar.
- Textos em português do Brasil, acessível (labels, `aria-*`, foco visível) e
  responsivo (desktop, tablet e mobile).
- Respeita `prefers-reduced-motion` para quem prefere menos animação.
- Fontes via Google Fonts (Space Grotesk / Poppins) por `<link>`.
