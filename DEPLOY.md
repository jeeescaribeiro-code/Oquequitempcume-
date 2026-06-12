# Deploy gratuito no Render

## 1. Arquivos para colocar no GitHub

Coloque estes arquivos e pastas no repositorio:

```txt
assets/
data/
.gitignore
config.js
DEPLOY.md
index.html
package.json
README.md
render.yaml
script.js
server.js
styles.css
```

Nao precisa colocar:

```txt
Taco-4a-Edicao.xlsx
tools/
node_modules/
.env
```

## 2. Configuracao no Render

Crie um servico em:

```txt
New > Web Service
```

Use:

```txt
Runtime: Node
Plan: Free
Build Command: npm install
Start Command: npm start
```

## 3. Environment Variables no Render

Para publicar sem IA real, coloque apenas:

```txt
NODE_ENV=production
```

Opcionalmente:

```txt
MAX_BODY_BYTES=1048576
REQUEST_TIMEOUT_MS=12000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=80
```

Se for usar uma API de IA externa:

```txt
AI_ENDPOINT=https://sua-api-de-ia.com/chat
```

Nao use Ollama no Render Free. Ollama/Gemma local funciona no seu computador, mas nao roda dentro do Render Free.

## 4. Observacoes

- O servidor agora serve apenas arquivos publicos permitidos.
- `server.js`, `.env`, `.xlsx` e outros arquivos internos nao sao expostos como estaticos.
- A busca online usa TBCA/USP e Open Food Facts por rotas do servidor.
- O diario alimentar fica no `localStorage` do navegador do usuario.
