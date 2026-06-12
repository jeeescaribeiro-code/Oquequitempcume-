const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const aiProvider = process.env.AI_PROVIDER || "";
const aiEndpoint = process.env.AI_ENDPOINT || "";
const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "gemma3";
const usdaApiKey = process.env.USDA_API_KEY || "";
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 80);
const rateLimitStore = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const publicFiles = new Set([
  "index.html",
  "styles.css",
  "script.js",
  "config.js",
  "data/alimentos.js",
  "assets/cozinha-background.jpg",
]);

function sendJson(response, status, payload) {
  response.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(payload));
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...extra,
  };
}

function getClientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function isRateLimited(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  const bucket = rateLimitStore.get(ip) || { count: 0, resetAt: now + rateLimitWindowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + rateLimitWindowMs;
  }

  bucket.count += 1;
  rateLimitStore.set(ip, bucket);

  return bucket.count > rateLimitMax;
}

function sendStatic(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, securityHeaders());
    response.end("Method not allowed");
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  const cleanPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const relativePath = cleanPath.replace(/^\/+/, "").replace(/\\/g, "/");

  if (!publicFiles.has(relativePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const filePath = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, filePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    response.writeHead(403, securityHeaders());
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, securityHeaders());
      response.end("Not found");
      return;
    }

    response.writeHead(200, securityHeaders({ "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" }));
    response.end(request.method === "HEAD" ? undefined : content);
  });
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Payload muito grande.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleChat(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message || "JSON inválido." });
    return;
  }

  if (aiProvider === "ollama" || process.env.OLLAMA_MODEL) {
    await handleOllamaChat(body, response);
    return;
  }

  if (!aiEndpoint) {
    sendJson(response, 200, {
      answer: "Servidor ativo. Configure AI_PROVIDER=ollama ou AI_ENDPOINT para ligar uma LLM real.",
      receivedPrompt: body.prompt || "",
    });
    return;
  }

  const aiResponse = await fetchWithTimeout(aiEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await aiResponse.text();
  try {
    const payload = JSON.parse(text);
    sendJson(response, aiResponse.status, payload);
  } catch {
    sendJson(response, aiResponse.status, { answer: text });
  }
}

async function handleOllamaChat(body, response) {
  const prompt = body.prompt || "";

  if (!prompt.trim()) {
    sendJson(response, 400, { error: "Prompt vazio." });
    return;
  }

  const ollamaResponse = await fetchWithTimeout(`${ollamaUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: false,
      options: {
        temperature: 0.45,
        num_predict: 700,
      },
    }),
  });

  const text = await ollamaResponse.text();

  if (!ollamaResponse.ok) {
    sendJson(response, ollamaResponse.status, {
      error: "Falha ao chamar Ollama.",
      details: text,
    });
    return;
  }

  try {
    const payload = JSON.parse(text);
    sendJson(response, 200, {
      answer: payload.response || "Ollama respondeu sem texto.",
      provider: "ollama",
      model: ollamaModel,
    });
  } catch {
    sendJson(response, 502, {
      error: "Resposta inesperada do Ollama.",
      details: text,
    });
  }
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function asNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if (!text || text === "na" || text === "nd") return null;
  if (text === "tr") return 0;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : null;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&ccedil;/g, "ç")
    .replace(/&atilde;/g, "ã")
    .replace(/&otilde;/g, "õ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&agrave;/g, "à")
    .replace(/&acirc;/g, "â")
    .replace(/&ecirc;/g, "ê")
    .replace(/&ocirc;/g, "ô")
    .replace(/&Ccedil;/g, "Ç")
    .replace(/&Atilde;/g, "Ã")
    .replace(/&Otilde;/g, "Õ")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function mapOpenFoodFactsProduct(product) {
  const nutriments = product.nutriments || {};
  const energyKcal = asNumber(nutriments["energy-kcal_100g"])
    ?? (asNumber(nutriments.energy_100g) ? asNumber(nutriments.energy_100g) / 4.184 : null);
  const name = product.product_name || product.generic_name || "Produto sem nome";
  const brand = product.brands || "";
  const category = product.categories || "Produto industrializado";

  return {
    id: `off:${product.code || product._id || normalizeText(`${name}-${brand}`)}`,
    descricao: brand ? `${name} - ${brand}` : name,
    categoria: category,
    fonte: "Open Food Facts",
    marca: brand || null,
    codigoBarras: product.code || null,
    ingredientesTexto: product.ingredients_text || "",
    busca: normalizeText(`${name} ${brand} ${category} ${product.ingredients_text || ""}`),
    porcaoReferenciaGramas: 100,
    nutrientes: {
      energiaKcal: asNumber(energyKcal),
      proteinaG: asNumber(nutriments.proteins_100g),
      lipideosG: asNumber(nutriments.fat_100g),
      carboidratoG: asNumber(nutriments.carbohydrates_100g),
      fibraG: asNumber(nutriments.fiber_100g),
      sodioMg: asNumber(nutriments.sodium_100g) === null ? null : asNumber(nutriments.sodium_100g) * 1000,
    },
  };
}

function buildOpenFoodFactsUrl(baseUrl, query, pageSize) {
  const fields = [
    "code",
    "product_name",
    "generic_name",
    "brands",
    "categories",
    "ingredients_text",
    "nutriments",
  ].join(",");
  const searchUrl = new URL("/cgi/search.pl", baseUrl);
  searchUrl.searchParams.set("search_terms", query);
  searchUrl.searchParams.set("search_simple", "1");
  searchUrl.searchParams.set("action", "process");
  searchUrl.searchParams.set("json", "1");
  searchUrl.searchParams.set("page_size", String(pageSize));
  searchUrl.searchParams.set("fields", fields);
  return searchUrl;
}

async function fetchOpenFoodFacts(query, pageSize) {
  const bases = [
    "https://br.openfoodfacts.org",
    "https://world.openfoodfacts.org",
    "https://world.openfoodfacts.net",
  ];
  const errors = [];

  for (const base of bases) {
    const searchUrl = buildOpenFoodFactsUrl(base, query, pageSize);
    const headers = {
      "User-Agent": "Oquequitempcume/0.1 (local development; contact: local@example.com)",
      Accept: "application/json",
    };

    if (base.endsWith(".net")) {
      headers.Authorization = `Basic ${Buffer.from("off:off").toString("base64")}`;
    }

    try {
      const external = await fetchWithTimeout(searchUrl, { headers });
      if (!external.ok) {
        errors.push(`${base}: ${external.status}`);
        continue;
      }

      return {
        base,
        payload: await external.json(),
      };
    } catch (error) {
      errors.push(`${base}: ${error.message}`);
    }
  }

  const unavailable = errors.some((entry) => entry.includes("503"));
  const message = unavailable
    ? "Open Food Facts está indisponível ou limitando requisições agora. Tente novamente em alguns minutos."
    : "Não foi possível consultar Open Food Facts agora.";
  const error = new Error(message);
  error.status = unavailable ? 503 : 502;
  error.details = errors;
  throw error;
}

async function handleOpenFoodFactsSearch(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const query = String(url.searchParams.get("q") || "").trim();
  const pageSize = Math.min(Number(url.searchParams.get("pageSize") || 12), 24);

  if (!query) {
    sendJson(response, 400, { error: "Informe q para buscar." });
    return;
  }

  let result;
  try {
    result = await fetchOpenFoodFacts(query, pageSize);
  } catch (error) {
    sendJson(response, error.status || 502, {
      error: error.message,
      details: error.details || [],
    });
    return;
  }

  const payload = result.payload;
  const alimentos = (payload.products || [])
    .map(mapOpenFoodFactsProduct)
    .filter((food) => food.descricao && food.nutrientes.energiaKcal !== null);

  sendJson(response, 200, {
    fonte: "Open Food Facts",
    origemConsulta: result.base,
    total: alimentos.length,
    alimentos,
  });
}

function parseTbcaRows(html, limit) {
  const rows = [];
  const rowMatches = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];

  for (const match of rowMatches) {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 4) continue;

    const hrefMatch = cells[0].match(/href=['"]([^'"]+)['"]/i);
    const code = stripHtml(cells[0]);
    const descricao = stripHtml(cells[1]);
    const nomeCientifico = stripHtml(cells[2]);
    const categoria = stripHtml(cells[3]);
    const marca = stripHtml(cells[4] || "");

    if (!hrefMatch || !code || !descricao) continue;
    rows.push({
      code,
      descricao,
      nomeCientifico,
      categoria,
      marca,
      detailUrl: new URL(hrefMatch[1], "https://www.tbca.net.br/base-dados/").toString(),
    });

    if (rows.length >= limit) break;
  }

  return rows;
}

function parseTbcaDetail(html, base) {
  const text = stripHtml(html);
  const code = text.match(/Código:\s*([A-Z0-9]+)/i)?.[1] || base.code;
  const group = text.match(/Grupo:\s*([^]+?)Tipo de Alimento:/i)?.[1]?.trim() || base.categoria;
  const type = text.match(/Tipo de Alimento:\s*([^]+?)Marca:/i)?.[1]?.trim() || "";
  const brand = text.match(/Marca:\s*([^]+?)Descrição:/i)?.[1]?.trim() || base.marca;
  const description = text.match(/Descrição:\s*([^<]+?)<</i)?.[1]?.trim() || base.descricao;

  const nutrient = (label, unit) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedUnit = unit ? unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
    const pattern = unit
      ? `${escapedLabel}\\s+${escapedUnit}\\s+([\\d,.]+|tr|NA|ND)`
      : `${escapedLabel}\\s+([\\d,.]+|tr|NA|ND)`;
    const match = text.match(new RegExp(pattern, "i"));
    return match ? asNumber(match[1]) : null;
  };

  return {
    id: `tbca:${code}`,
    descricao: description,
    categoria: group,
    tipoAlimento: type,
    fonte: "TBCA/USP",
    marca: brand || null,
    codigoBarras: null,
    urlFonte: base.detailUrl,
    busca: normalizeText(`${description} ${brand} ${group} ${type} ${base.nomeCientifico}`),
    porcaoReferenciaGramas: 100,
    nutrientes: {
      energiaKcal: nutrient("Energia kcal"),
      proteinaG: nutrient("Proteína", "g"),
      lipideosG: nutrient("Lipídios", "g"),
      carboidratoG: nutrient("Carboidrato total", "g"),
      fibraG: nutrient("Fibra alimentar", "g"),
      calcioMg: nutrient("Cálcio", "mg"),
      ferroMg: nutrient("Ferro", "mg"),
      sodioMg: nutrient("Sódio", "mg"),
      potassioMg: nutrient("Potássio", "mg"),
      vitaminaCMg: nutrient("Vitamina C", "mg"),
    },
  };
}

async function fetchTbcaDetail(row) {
  const detail = await fetchWithTimeout(row.detailUrl, {
    headers: {
      "User-Agent": "Oquequitempcume/0.1 (consulta local educacional)",
      Accept: "text/html",
    },
  });

  if (!detail.ok) return null;
  return parseTbcaDetail(await detail.text(), row);
}

function tbcaQueryAlternatives(query) {
  const normalized = normalizeText(query);
  const alternatives = [query];
  const brandFallbacks = [
    { terms: ["nescau", "toddy", "ovomaltine"], fallback: "achocolatado" },
    { terms: ["nestle", "batavo", "danone", "vigor"], fallback: "iogurte" },
    { terms: ["coca cola", "pepsi", "guarana"], fallback: "refrigerante" },
  ];

  brandFallbacks.forEach((item) => {
    if (item.terms.some((term) => normalized.includes(term))) alternatives.push(item.fallback);
  });

  return [...new Set(alternatives)];
}

async function handleTbcaSearch(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const query = String(url.searchParams.get("q") || "").trim();
  const pageSize = Math.min(Number(url.searchParams.get("pageSize") || 8), 12);

  if (!query) {
    sendJson(response, 400, { error: "Informe q para buscar." });
    return;
  }

  let rows = [];
  for (const term of tbcaQueryAlternatives(query)) {
    const body = new URLSearchParams({
      guarda: "tomo1",
      produto: term,
      cmb_grupo: "",
      cmb_tipo_alimento: "",
    });

    const tbcaResponse = await fetchWithTimeout("https://www.tbca.net.br/base-dados/composicao_alimentos.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Oquequitempcume/0.1 (consulta local educacional)",
        Accept: "text/html",
      },
      body,
    });

    if (!tbcaResponse.ok) {
      sendJson(response, tbcaResponse.status, { error: "Falha ao consultar TBCA/USP." });
      return;
    }

    rows = parseTbcaRows(await tbcaResponse.text(), pageSize);
    if (rows.length) break;
  }

  const detailed = await Promise.all(rows.map(fetchTbcaDetail));
  const alimentos = detailed.filter((food) => food && food.nutrientes.energiaKcal !== null);

  sendJson(response, 200, {
    fonte: "TBCA/USP",
    avisoUso: "Dados consultados online na TBCA/USP. Cite a fonte e respeite a licença CC BY-NC-ND 4.0.",
    total: alimentos.length,
    alimentos,
  });
}

function usdaNutrient(nutrients, ids) {
  const item = nutrients.find((nutrient) => ids.includes(nutrient.nutrientId));
  return item ? asNumber(item.value) : null;
}

function mapUsdaFood(food) {
  const nutrients = food.foodNutrients || [];
  const brand = food.brandOwner || food.brandName || "";
  const name = food.description || "Produto sem nome";
  return {
    id: `usda:${food.fdcId}`,
    descricao: brand ? `${name} - ${brand}` : name,
    categoria: food.foodCategory || "USDA Branded Foods",
    fonte: "USDA FoodData Central",
    marca: brand || null,
    codigoBarras: food.gtinUpc || null,
    busca: normalizeText(`${name} ${brand} ${food.foodCategory || ""}`),
    porcaoReferenciaGramas: 100,
    nutrientes: {
      energiaKcal: usdaNutrient(nutrients, [1008]),
      proteinaG: usdaNutrient(nutrients, [1003]),
      lipideosG: usdaNutrient(nutrients, [1004]),
      carboidratoG: usdaNutrient(nutrients, [1005]),
      fibraG: usdaNutrient(nutrients, [1079]),
      sodioMg: usdaNutrient(nutrients, [1093]),
    },
  };
}

async function handleUsdaSearch(request, response) {
  if (!usdaApiKey) {
    sendJson(response, 501, { error: "Configure USDA_API_KEY para usar a FoodData Central." });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  const query = String(url.searchParams.get("q") || "").trim();
  const pageSize = Math.min(Number(url.searchParams.get("pageSize") || 12), 24);

  if (!query) {
    sendJson(response, 400, { error: "Informe q para buscar." });
    return;
  }

  const searchUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(usdaApiKey)}`;
  const external = await fetchWithTimeout(searchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      dataType: ["Branded"],
      pageSize,
      sortBy: "fdcId",
      sortOrder: "desc",
    }),
  });

  if (!external.ok) {
    sendJson(response, external.status, { error: "Falha ao consultar USDA FoodData Central." });
    return;
  }

  const payload = await external.json();
  const alimentos = (payload.foods || [])
    .map(mapUsdaFood)
    .filter((food) => food.descricao && food.nutrientes.energiaKcal !== null);

  sendJson(response, 200, {
    fonte: "USDA FoodData Central",
    total: alimentos.length,
    alimentos,
  });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url.startsWith("/api/") && isRateLimited(request)) {
      sendJson(response, 429, { error: "Muitas requisições. Tente novamente em instantes." });
      return;
    }

    if (request.url.startsWith("/api/chat")) {
      await handleChat(request, response);
      return;
    }

    if (request.url.startsWith("/api/openfoodfacts/search")) {
      await handleOpenFoodFactsSearch(request, response);
      return;
    }

    if (request.url.startsWith("/api/tbca/search")) {
      await handleTbcaSearch(request, response);
      return;
    }

    if (request.url.startsWith("/api/usda/search")) {
      await handleUsdaSearch(request, response);
      return;
    }

    sendStatic(request, response);
  } catch (error) {
    const message = process.env.NODE_ENV === "production" ? "Erro interno do servidor." : error.message;
    sendJson(response, error.status || 500, { error: message });
  }
});

server.listen(port, () => {
  console.log(`Oquequitempcume? rodando em http://localhost:${port}`);
});
