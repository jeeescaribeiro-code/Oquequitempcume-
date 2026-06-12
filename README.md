# Oquequitempcume?

App local/online para montar receitas leves a partir da TACO.

## O que ja funciona

- Busca unica misturando TACO local, TBCA/USP online e Open Food Facts.
- Busca online de produtos de marca pelo Open Food Facts.
- Busca online de alimentos, preparacoes e marcas brasileiras pela TBCA/USP.
- Adicao de ingredientes por gramas.
- Calculo de calorias, proteinas, carboidratos, gorduras e fibras.
- Chatbot que reconhece ingredientes digitados e sugere correspondencias da TACO.
- Gerador demonstrativo de receita leve.
- Adaptador pronto para chamar uma IA open source por endpoint HTTP.

## Como abrir localmente

Abra o arquivo `index.html` no navegador.

## Como rodar com servidor local

Use Node.js:

```bash
node server.js
```

Depois acesse:

```txt
http://localhost:3000
```

Rodando pelo servidor, o app chama automaticamente `/api/chat`.

Tambem libera buscas online em:

```txt
/api/openfoodfacts/search?q=nescau
/api/tbca/search?q=nescau
```

## Fontes de dados

- TACO local: usada como fonte principal para ingredientes e alimentos comuns.
- TBCA/USP: usada online para alimentos, preparacoes, produtos brasileiros e algumas marcas. Os dados devem respeitar a licenca e a citacao da fonte indicadas pela propria TBCA.
- Open Food Facts: usada online para produtos industrializados, marcas e codigos de barras.
- USDA FoodData Central: endpoint opcional em `/api/usda/search`, exigindo `USDA_API_KEY`.

## Como conectar uma IA open source

### Opcao recomendada: Ollama local

1. Instale o Ollama.
2. Baixe um modelo:

```bash
ollama pull gemma3
```

Outras opcoes:

```bash
ollama pull llama3.1
ollama pull qwen2.5
ollama pull mistral
```

3. Rode o servidor com Ollama:

No Windows PowerShell:

```powershell
cd "C:\Users\jessi\OneDrive\Área de Trabalho\nut"
$env:AI_PROVIDER="ollama"
$env:OLLAMA_MODEL="gemma3"
& "C:\Users\jessi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

Depois acesse:

```txt
http://localhost:3000
```

Quando clicar em "Gerar receita com seleção atual", o app chama:

```txt
/api/chat -> Ollama -> modelo local
```

### Opcao com endpoint externo

Edite `config.js` para chamar um endpoint direto:

```js
window.NUTRI_AI_CONFIG = {
  endpoint: "https://seu-space.hf.space/api/chat",
  provider: "huggingface-space",
};
```

O endpoint deve aceitar `POST` com JSON e retornar um destes campos:

```json
{
  "answer": "texto da receita"
}
```

Tambem funcionam `response` ou `text`.

Ou use o servidor como proxy. Defina a variavel `AI_ENDPOINT` antes de rodar:

```bash
AI_ENDPOINT=https://seu-space.hf.space/api/chat node server.js
```

No Windows PowerShell:

```powershell
$env:AI_ENDPOINT="https://seu-space.hf.space/api/chat"
node server.js
```

## Hospedagem gratuita

Para a primeira versao online:

- Frontend: GitHub Pages, Vercel, Netlify ou Render Static Site.
- IA open source: Hugging Face Space gratuito/ZeroGPU, respeitando filas e limites.
- Calorias: sempre calculadas no app com a base TACO, sem depender da IA.

## Observacao importante

A IA sugere a receita, mas o calculo nutricional vem da TACO. Isso evita que o chatbot invente calorias.
