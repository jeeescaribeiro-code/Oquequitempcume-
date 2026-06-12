const data = window.TACO_DATA || { alimentos: [], total: 0 };
const aiConfig = window.NUTRI_AI_CONFIG || { endpoint: "", provider: "local-demo" };
const foods = (data.alimentos || []).map((food) => ({ ...food, fonte: food.fonte || "TACO" }));
let onlineFoods = [];
let tbcaFoods = [];
let onlineSearchTimer = null;
let lastOnlineQuery = "";
const selected = new Map();
const currentSuggestions = new Map();

const searchInput = document.querySelector("#searchInput");
const categoryFilter = document.querySelector("#categoryFilter");
const sourceFilter = document.querySelector("#sourceFilter");
const onlineSearchButton = document.querySelector("#onlineSearchButton");
const onlineStatus = document.querySelector("#onlineStatus");
const results = document.querySelector("#results");
const selectedList = document.querySelector("#selectedList");
const clearButton = document.querySelector("#clearButton");
const servingsInput = document.querySelector("#servingsInput");
const llmPrompt = document.querySelector("#llmPrompt");
const copyPromptButton = document.querySelector("#copyPromptButton");
const chatMessages = document.querySelector("#chatMessages");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const generateRecipeButton = document.querySelector("#generateRecipeButton");
const suggestionsPanel = document.querySelector("#suggestionsPanel");
const suggestionsList = document.querySelector("#suggestionsList");
const addSuggestionsButton = document.querySelector("#addSuggestionsButton");
const dailyGoalInput = document.querySelector("#dailyGoalInput");
const logMealButton = document.querySelector("#logMealButton");
const clearDiaryButton = document.querySelector("#clearDiaryButton");
const mealHistoryList = document.querySelector("#mealHistoryList");

const totals = {
  kcal: document.querySelector("#totalKcal"),
  portion: document.querySelector("#portionKcal"),
  protein: document.querySelector("#proteinTotal"),
  carb: document.querySelector("#carbTotal"),
  fat: document.querySelector("#fatTotal"),
  fiber: document.querySelector("#fiberTotal"),
};

const dailyEls = {
  kcal: document.querySelector("#dailyKcalTotal"),
  remaining: document.querySelector("#dailyKcalRemaining"),
  progress: document.querySelector("#dailyProgressBar"),
  protein: document.querySelector("#dailyProteinTotal"),
  carb: document.querySelector("#dailyCarbTotal"),
  fat: document.querySelector("#dailyFatTotal"),
  fiber: document.querySelector("#dailyFiberTotal"),
  calcium: document.querySelector("#dailyCalciumTotal"),
  iron: document.querySelector("#dailyIronTotal"),
  sodium: document.querySelector("#dailySodiumTotal"),
  potassium: document.querySelector("#dailyPotassiumTotal"),
  vitaminC: document.querySelector("#dailyVitaminCTotal"),
  chartProtein: document.querySelector("#chartProtein"),
  chartCarb: document.querySelector("#chartCarb"),
  chartFat: document.querySelector("#chartFat"),
  chartFiber: document.querySelector("#chartFiber"),
};

const diaryKey = "oquequitempcume.diary.v1";
const goalKey = "oquequitempcume.dailyGoal.v1";
let dailyDiary = loadDailyDiary();

function updateFoodCount() {
  const extras = [];
  if (tbcaFoods.length) extras.push(`${tbcaFoods.length} TBCA`);
  if (onlineFoods.length) extras.push(`${onlineFoods.length} marcas`);
  const suffix = extras.length ? ` + ${extras.join(" + ")}` : "";
  document.querySelector("#foodCount").textContent = `${foods.length} TACO${suffix}`;
}

updateFoodCount();

function foodKey(food) {
  return `${food.fonte || "TACO"}:${food.id}`;
}

function allFoods() {
  return [...foods, ...tbcaFoods, ...onlineFoods];
}

function findFoodByKey(key) {
  return allFoods().find((food) => foodKey(food) === key);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value, decimals = 1) {
  return Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function nutrientFor(food, key, grams) {
  const value = food.nutrientes[key];
  if (typeof value !== "number") return 0;
  return (value / 100) * grams;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadDailyDiary() {
  try {
    const stored = JSON.parse(localStorage.getItem(diaryKey) || "null");
    if (stored?.date === todayKey() && Array.isArray(stored.entries)) return stored;
  } catch {}
  return { date: todayKey(), entries: [] };
}

function saveDailyDiary() {
  localStorage.setItem(diaryKey, JSON.stringify(dailyDiary));
}

function loadDailyGoal() {
  const stored = Number(localStorage.getItem(goalKey));
  return Number.isFinite(stored) && stored > 0 ? stored : 2000;
}

function saveDailyGoal(value) {
  localStorage.setItem(goalKey, String(value));
}

function foodNutritionSnapshot(food, grams) {
  return {
    kcal: nutrientFor(food, "energiaKcal", grams),
    protein: nutrientFor(food, "proteinaG", grams),
    carb: nutrientFor(food, "carboidratoG", grams),
    fat: nutrientFor(food, "lipideosG", grams),
    fiber: nutrientFor(food, "fibraG", grams),
    calcium: nutrientFor(food, "calcioMg", grams),
    iron: nutrientFor(food, "ferroMg", grams),
    sodium: nutrientFor(food, "sodioMg", grams),
    potassium: nutrientFor(food, "potassioMg", grams),
    vitaminC: nutrientFor(food, "vitaminaCMg", grams),
  };
}

function populateCategories() {
  const categories = [...new Set(foods.map((food) => food.categoria).filter(Boolean))].sort();
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });
}

function getFilteredFoods() {
  const query = normalizeText(searchInput.value);
  const category = categoryFilter.value;
  const source = sourceFilter.value;

  if (!query && !category) return [];

  return allFoods()
    .filter((food) => {
      const matchesQuery = !query || food.busca.includes(query);
      const matchesCategory = !category || food.categoria === category || food.fonte !== "TACO";
      const matchesSource = source === "all" || food.fonte === source;
      return matchesQuery && matchesCategory && matchesSource;
    })
    .sort((a, b) => {
      if (a.fonte !== b.fonte) return a.fonte === "TACO" ? -1 : 1;
      return a.descricao > b.descricao ? 1 : -1;
    })
    .slice(0, 40);
}

function renderResults() {
  if (!normalizeText(searchInput.value) && !categoryFilter.value) {
    results.innerHTML = "";
    return;
  }

  const filteredFoods = getFilteredFoods();

  if (!filteredFoods.length) {
    results.innerHTML = '<div class="no-results">Digite um alimento para buscar na TACO, TBCA/USP e marcas online.</div>';
    return;
  }

  results.innerHTML = filteredFoods
    .map((food) => {
      const kcal = food.nutrientes.energiaKcal;
      const key = foodKey(food);
      const isSelected = selected.has(key);
      const brand = food.marca ? `<span>${escapeHtml(food.marca)}</span>` : "";
      const barcode = food.codigoBarras ? `<span>EAN ${escapeHtml(food.codigoBarras)}</span>` : "";
      return `
        <article class="food-row">
          <div>
            <span class="food-name">${escapeHtml(food.descricao)}</span>
            <div class="food-meta">
              <span>${escapeHtml(food.fonte || "TACO")}</span>
              <span>${escapeHtml(food.categoria || "Sem categoria")}</span>
              ${brand}
              ${barcode}
              <span>${formatNumber(kcal || 0)} kcal/100g</span>
              <span>${formatNumber(food.nutrientes.proteinaG || 0)} g proteína</span>
            </div>
          </div>
          <button class="add-button" type="button" data-key="${escapeHtml(key)}">
            ${isSelected ? "Adicionado" : "Adicionar"}
          </button>
        </article>
      `;
    })
    .join("");
}

function addFood(key, grams = 100) {
  const normalizedKey = String(key).includes(":") ? String(key) : `TACO:${key}`;
  const food = findFoodByKey(normalizedKey);
  if (!food) return;

  if (!selected.has(normalizedKey)) {
    selected.set(normalizedKey, { food, grams });
  }

  renderAll();
}

function removeFood(key) {
  selected.delete(key);
  renderAll();
}

function updateGrams(key, grams) {
  const entry = selected.get(key);
  if (!entry) return;
  entry.grams = Math.max(1, Number(grams) || 1);
  renderSummary();
}

function renderSelected() {
  if (!selected.size) {
    selectedList.className = "selected-list empty-state";
    selectedList.textContent = "Escolha ingredientes na busca ou peça pelo chat.";
    return;
  }

  selectedList.className = "selected-list";
  selectedList.innerHTML = [...selected.values()]
    .map(({ food, grams }) => {
      const kcal = nutrientFor(food, "energiaKcal", grams);
      const key = foodKey(food);
      return `
        <article class="selected-row">
          <div>
            <span class="food-name">${escapeHtml(food.descricao)}</span>
            <div class="food-meta">
              <span>${escapeHtml(food.fonte || "TACO")}</span>
              <span>${formatNumber(kcal)} kcal</span>
              <span>${formatNumber(nutrientFor(food, "proteinaG", grams))} g proteína</span>
            </div>
          </div>
          <input class="grams-input" type="number" min="1" step="5" value="${grams}" data-key="${escapeHtml(key)}" aria-label="Gramas de ${escapeHtml(food.descricao)}">
          <button class="remove-button" type="button" data-key="${escapeHtml(key)}">Remover</button>
        </article>
      `;
    })
    .join("");
}

function calculateTotals() {
  return [...selected.values()].reduce(
    (acc, { food, grams }) => {
      acc.kcal += nutrientFor(food, "energiaKcal", grams);
      acc.protein += nutrientFor(food, "proteinaG", grams);
      acc.carb += nutrientFor(food, "carboidratoG", grams);
      acc.fat += nutrientFor(food, "lipideosG", grams);
      acc.fiber += nutrientFor(food, "fibraG", grams);
      return acc;
    },
    { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0 },
  );
}

function calculateDailyTotals() {
  return dailyDiary.entries.reduce(
    (acc, entry) => {
      Object.keys(acc).forEach((key) => {
        acc[key] += entry.nutrients[key] || 0;
      });
      return acc;
    },
    {
      kcal: 0,
      protein: 0,
      carb: 0,
      fat: 0,
      fiber: 0,
      calcium: 0,
      iron: 0,
      sodium: 0,
      potassium: 0,
      vitaminC: 0,
    },
  );
}

function logCurrentSelection() {
  if (!selected.size) {
    addMessage("bot", "Adicione alimentos na seleção antes de guardar no diário do dia.");
    return;
  }

  const entries = [...selected.values()].map(({ food, grams }) => ({
    id: foodKey(food),
    descricao: food.descricao,
    fonte: food.fonte || "TACO",
    grams,
    createdAt: new Date().toISOString(),
    nutrients: foodNutritionSnapshot(food, grams),
  }));

  dailyDiary.entries.push(...entries);
  saveDailyDiary();
  renderDailyDiary();
}

function clearDailyDiary() {
  dailyDiary = { date: todayKey(), entries: [] };
  saveDailyDiary();
  renderDailyDiary();
}

function setBarWidth(element, value, max) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  element.style.width = `${percent}%`;
}

function renderDailyDiary() {
  const goal = Math.max(1, Number(dailyGoalInput.value) || 2000);
  const totals = calculateDailyTotals();
  const remaining = goal - totals.kcal;

  dailyEls.kcal.textContent = `${formatNumber(totals.kcal, 0)} kcal`;
  dailyEls.remaining.textContent = remaining >= 0
    ? `${formatNumber(remaining, 0)} kcal restantes`
    : `${formatNumber(Math.abs(remaining), 0)} kcal acima da meta`;
  setBarWidth(dailyEls.progress, totals.kcal, goal);

  dailyEls.protein.textContent = `${formatNumber(totals.protein)} g`;
  dailyEls.carb.textContent = `${formatNumber(totals.carb)} g`;
  dailyEls.fat.textContent = `${formatNumber(totals.fat)} g`;
  dailyEls.fiber.textContent = `${formatNumber(totals.fiber)} g`;
  dailyEls.calcium.textContent = `${formatNumber(totals.calcium, 0)} mg`;
  dailyEls.iron.textContent = `${formatNumber(totals.iron)} mg`;
  dailyEls.sodium.textContent = `${formatNumber(totals.sodium, 0)} mg`;
  dailyEls.potassium.textContent = `${formatNumber(totals.potassium, 0)} mg`;
  dailyEls.vitaminC.textContent = `${formatNumber(totals.vitaminC)} mg`;

  setBarWidth(dailyEls.chartProtein, totals.protein, 120);
  setBarWidth(dailyEls.chartCarb, totals.carb, 300);
  setBarWidth(dailyEls.chartFat, totals.fat, 80);
  setBarWidth(dailyEls.chartFiber, totals.fiber, 30);

  if (!dailyDiary.entries.length) {
    mealHistoryList.className = "meal-history-list empty-state";
    mealHistoryList.textContent = "Nenhum alimento registrado hoje.";
    return;
  }

  mealHistoryList.className = "meal-history-list";
  mealHistoryList.innerHTML = dailyDiary.entries
    .slice()
    .reverse()
    .map((entry) => `
      <div class="meal-entry">
        <strong>${escapeHtml(entry.descricao)}</strong>
        <span>${escapeHtml(entry.fonte)} · ${formatNumber(entry.grams, 0)}g · ${formatNumber(entry.nutrients.kcal, 0)} kcal</span>
      </div>
    `)
    .join("");
}

function buildPrompt(totalValues) {
  if (!selected.size) {
    return "Selecione ingredientes para gerar uma receita de baixa caloria.";
  }

  const servings = Math.max(1, Number(servingsInput.value) || 1);
  const ingredients = [...selected.values()]
    .map(({ food, grams }) => `- ${food.descricao}: ${grams}g (${formatNumber(nutrientFor(food, "energiaKcal", grams))} kcal estimadas)`)
    .join("\n");

  return `Você é o chatbot do site Oquequitempcume?.
Crie uma receita cotidiana, simples e coerente usando apenas os ingredientes abaixo.
Priorize a menor quantidade calórica possível, mas a receita precisa ser uma refeição real.

Regras:
- Use no mínimo 250g de alimento no total, se possível.
- Use pelo menos 3 ingredientes quando houver ingredientes suficientes.
- Não invente calorias. As calorias serão calculadas pelo sistema com a TACO.
- Informe modo de preparo curto.
- Informe as quantidades em gramas.
- A receita deve render ${servings} porção(ões).
- Responda em português do Brasil.

Ingredientes disponíveis:
${ingredients}

Resumo nutricional atual da seleção:
- Energia total: ${formatNumber(totalValues.kcal)} kcal
- Proteínas: ${formatNumber(totalValues.protein)}g
- Carboidratos: ${formatNumber(totalValues.carb)}g
- Gorduras: ${formatNumber(totalValues.fat)}g
- Fibras: ${formatNumber(totalValues.fiber)}g`;
}

function renderSummary() {
  const totalValues = calculateTotals();
  const servings = Math.max(1, Number(servingsInput.value) || 1);

  totals.kcal.textContent = `${formatNumber(totalValues.kcal, 0)} kcal`;
  totals.portion.textContent = `${formatNumber(totalValues.kcal / servings, 0)} kcal por porção`;
  totals.protein.textContent = `${formatNumber(totalValues.protein)} g`;
  totals.carb.textContent = `${formatNumber(totalValues.carb)} g`;
  totals.fat.textContent = `${formatNumber(totalValues.fat)} g`;
  totals.fiber.textContent = `${formatNumber(totalValues.fiber)} g`;
  llmPrompt.value = buildPrompt(totalValues);
}

function renderAll() {
  renderResults();
  renderSelected();
  renderSummary();
}

function addMessage(role, content, extraClass = "") {
  const message = document.createElement("div");
  message.className = `message ${role} ${extraClass}`.trim();
  message.textContent = content;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function tokenizeMessage(message) {
  const tokens = normalizeText(message).split(" ").filter((token) => token.length >= 3);
  const stopwords = new Set([
    "tenho",
    "quero",
    "algo",
    "leve",
    "para",
    "fazer",
    "comer",
    "jantar",
    "almoco",
    "receita",
    "caloria",
    "calorias",
    "pouca",
    "baixo",
    "baixa",
    "minha",
    "meu",
    "uma",
    "uns",
    "das",
    "dos",
    "que",
    "tem",
    "casa",
  ]);
  return [...new Set(tokens.filter((token) => !stopwords.has(token)))];
}

function scoreFood(food, tokens) {
  return tokens.reduce((score, token) => {
    if (food.busca === token) return score + 8;
    if (food.busca.split(" ").includes(token)) return score + 5;
    if (food.busca.includes(token)) return score + 2;
    return score;
  }, 0);
}

function findFoodSuggestions(message, limit = 8) {
  const tokens = tokenizeMessage(message);
  if (!tokens.length) return [];

  const picked = new Map();

  tokens.forEach((token) => {
    allFoods()
      .map((food) => ({ food, score: scoreFood(food, [token]) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        const kcalA = a.food.nutrientes.energiaKcal || 9999;
        const kcalB = b.food.nutrientes.energiaKcal || 9999;
        return b.score - a.score || kcalA - kcalB;
      })
      .slice(0, 2)
      .forEach((item) => picked.set(item.food.id, item.food));
  });

  return [...picked.values()]
    .map((food) => ({ food, score: scoreFood(food, tokens) }))
    .sort((a, b) => {
      const kcalA = a.food.nutrientes.energiaKcal || 9999;
      const kcalB = b.food.nutrientes.energiaKcal || 9999;
      return b.score - a.score || kcalA - kcalB;
    })
    .slice(0, limit)
    .map((item) => item.food);
}

function renderSuggestions(suggestions) {
  currentSuggestions.clear();

  if (!suggestions.length) {
    suggestionsPanel.hidden = true;
    suggestionsList.innerHTML = "";
    return;
  }

  suggestions.forEach((food) => currentSuggestions.set(foodKey(food), food));
  suggestionsPanel.hidden = false;
  suggestionsList.innerHTML = suggestions
    .map((food) => {
      const key = foodKey(food);
      return `
      <article class="suggestion-row">
        <div>
          <span class="food-name">${escapeHtml(food.descricao)}</span>
          <div class="food-meta">
            <span>${escapeHtml(food.fonte || "TACO")}</span>
            <span>${escapeHtml(food.categoria || "Sem categoria")}</span>
            <span>${formatNumber(food.nutrientes.energiaKcal || 0)} kcal/100g</span>
          </div>
        </div>
        <input class="suggestion-grams" type="number" min="1" step="5" placeholder="g" data-suggestion-key="${escapeHtml(key)}" aria-label="Gramas de ${escapeHtml(food.descricao)}">
      </article>
    `;
    })
    .join("");
}

function addAllSuggestions() {
  let added = 0;
  suggestionsList.querySelectorAll("[data-suggestion-key]").forEach((input) => {
    const grams = Number(input.value);
    if (!grams || grams <= 0) return;
    addFood(input.dataset.suggestionKey, grams);
    added += 1;
  });

  if (added) {
    addMessage("bot", `${added} item(ns) adicionado(s) com as quantidades informadas.`);
    renderSuggestions([...currentSuggestions.values()]);
  } else {
    addMessage("bot", "Informe a quantidade em gramas em pelo menos um item antes de adicionar.");
  }
}

async function fetchSource(endpoint, query) {
  const response = await fetch(`${endpoint}?q=${encodeURIComponent(query)}&pageSize=12`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `status ${response.status}`);
  return payload.alimentos || [];
}

async function searchOnlineBrands(force = false) {
  const query = searchInput.value.trim();
  if (!query) {
    onlineStatus.textContent = "Digite para buscar nas fontes disponíveis.";
    return;
  }

  if (!window.location?.protocol?.startsWith("http")) {
    onlineStatus.textContent = "Busca online disponível quando o projeto roda em localhost.";
    return;
  }

  if (!force && (query.length < 3 || normalizeText(query) === normalizeText(lastOnlineQuery))) return;

  lastOnlineQuery = query;
  onlineSearchButton.disabled = true;
  onlineStatus.textContent = "Buscando também na TBCA/USP e em marcas online...";

  try {
    const [tbcaResult, offResult] = await Promise.allSettled([
      fetchSource("/api/tbca/search", query),
      fetchSource("/api/openfoodfacts/search", query),
    ]);

    const tbcaIncoming = tbcaResult.status === "fulfilled" ? tbcaResult.value : [];
    const offIncoming = offResult.status === "fulfilled" ? offResult.value : [];

    const tbcaMerged = new Map(tbcaFoods.map((food) => [foodKey(food), food]));
    tbcaIncoming.forEach((food) => tbcaMerged.set(foodKey(food), food));
    tbcaFoods = [...tbcaMerged.values()];

    const merged = new Map(onlineFoods.map((food) => [foodKey(food), food]));
    offIncoming.forEach((food) => merged.set(foodKey(food), food));
    onlineFoods = [...merged.values()];
    sourceFilter.value = "all";
    updateFoodCount();
    const failures = [tbcaResult, offResult].filter((result) => result.status === "rejected");
    const found = tbcaIncoming.length + offIncoming.length;
    onlineStatus.textContent = found
      ? `${found} resultado(s) online adicionados: ${tbcaIncoming.length} TBCA/USP, ${offIncoming.length} marcas.`
      : failures.length
        ? "Fontes online indisponíveis agora. A TACO local continua funcionando."
        : "Nenhum resultado online com calorias foi encontrado.";
    renderResults();
  } catch (error) {
    onlineStatus.textContent = `${error.message} A busca TACO local continua funcionando.`;
  } finally {
    onlineSearchButton.disabled = false;
  }
}

function lowCalorieLocalRecipe() {
  if (!selected.size) {
    return "Me diga quais ingredientes você tem ou adicione alguns itens manualmente. Aí eu monto uma receita leve e calculo pela TACO.";
  }

  const entries = [...selected.values()].sort((a, b) => {
    const kcalA = a.food.nutrientes.energiaKcal || 9999;
    const kcalB = b.food.nutrientes.energiaKcal || 9999;
    return kcalA - kcalB;
  });
  const chosen = entries.slice(0, Math.min(4, entries.length));
  const totalValues = calculateTotals();
  const servings = Math.max(1, Number(servingsInput.value) || 1);
  const ingredients = chosen.map(({ food, grams }) => `- ${food.descricao}: ${grams}g`).join("\n");

  return `Sugestão leve: prato simples com os ingredientes menos calóricos da sua seleção.

Ingredientes:
${ingredients}

Preparo:
1. Cozinhe ou aqueça os ingredientes que precisarem de cocção.
2. Misture os itens mais leves como base do prato.
3. Evite fritura e use água, sal e temperos secos se quiser.
4. Divida em ${servings} porção(ões).

Estimativa pela TACO da seleção atual:
- Total: ${formatNumber(totalValues.kcal, 0)} kcal
- Por porção: ${formatNumber(totalValues.kcal / servings, 0)} kcal
- Proteínas: ${formatNumber(totalValues.protein)}g

Modo demonstrativo local: para usar uma LLM open source real, configure o endpoint em config.js.`;
}

async function callConfiguredAi(prompt) {
  const endpoint = aiConfig.endpoint || (window.location?.protocol?.startsWith("http") ? "/api/chat" : "");

  if (!endpoint) {
    return lowCalorieLocalRecipe();
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ingredients: [...selected.values()].map(({ food, grams }) => ({
        id: foodKey(food),
        fonte: food.fonte || "TACO",
        marca: food.marca || null,
        codigoBarras: food.codigoBarras || null,
        descricao: food.descricao,
        gramas: grams,
        nutrientes: food.nutrientes,
      })),
      totals: calculateTotals(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha na IA: ${response.status}`);
  }

  const payload = await response.json();
  return payload.answer || payload.response || payload.text || "A IA respondeu, mas não enviou texto no formato esperado.";
}

async function generateRecipeFromSelection() {
  const prompt = buildPrompt(calculateTotals());
  const loading = addMessage("bot", "Gerando receita...", "loading");

  try {
    const answer = await callConfiguredAi(prompt);
    loading.remove();
    addMessage("bot", answer);
  } catch (error) {
    loading.remove();
    addMessage("bot", `Não consegui chamar a IA configurada agora. ${error.message}. Mantive o cálculo manual funcionando.`);
  }
}

async function handleChatMessage(message) {
  addMessage("user", message);
  const suggestions = findFoodSuggestions(message);
  renderSuggestions(suggestions);

  if (suggestions.length) {
    const names = suggestions.slice(0, 4).map((food) => food.descricao).join(", ");
    addMessage(
      "bot",
      `Encontrei possíveis alimentos: ${names}. Quer que eu adicione algum? Informe a quantidade em gramas nos campos abaixo e clique em "Adicionar informados".`,
    );
  } else {
    addMessage("bot", "Não achei ingredientes claros na TACO. Tente escrever nomes como frango, arroz, tomate, ovo, cenoura ou alface.");
  }

  const wantsRecipe = normalizeText(message).match(/\b(receita|jantar|almoco|comer|preparar|fazer)\b/);
  if (wantsRecipe && selected.size) {
    await generateRecipeFromSelection();
  } else if (wantsRecipe && suggestions.length) {
    addMessage("bot", "Para gerar a receita com esses itens, primeiro confirme quais entram e as quantidades em gramas.");
  }
}

results.addEventListener("click", (event) => {
  const button = event.target.closest(".add-button");
  if (!button) return;
  addFood(button.dataset.key);
  results.innerHTML = "";
});

selectedList.addEventListener("input", (event) => {
  if (!event.target.classList.contains("grams-input")) return;
  updateGrams(event.target.dataset.key, event.target.value);
});

selectedList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-button");
  if (!button) return;
  removeFood(button.dataset.key);
});

addSuggestionsButton.addEventListener("click", addAllSuggestions);

clearButton.addEventListener("click", () => {
  selected.clear();
  renderAll();
});

copyPromptButton.addEventListener("click", async () => {
  llmPrompt.select();
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(llmPrompt.value);
  } else {
    document.execCommand("copy");
  }
  copyPromptButton.textContent = "Copiado";
  window.setTimeout(() => {
    copyPromptButton.textContent = "Copiar";
  }, 1200);
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = "";
  await handleChatMessage(message);
});

dailyGoalInput.value = loadDailyGoal();
dailyGoalInput.addEventListener("input", () => {
  saveDailyGoal(Math.max(1, Number(dailyGoalInput.value) || 2000));
  renderDailyDiary();
});
logMealButton.addEventListener("click", logCurrentSelection);
clearDiaryButton.addEventListener("click", clearDailyDiary);

generateRecipeButton.addEventListener("click", generateRecipeFromSelection);
onlineSearchButton.addEventListener("click", () => searchOnlineBrands(true));
searchInput.addEventListener("input", renderResults);
searchInput.addEventListener("input", () => {
  window.clearTimeout(onlineSearchTimer);
  onlineSearchTimer = window.setTimeout(() => searchOnlineBrands(false), 650);
});
categoryFilter.addEventListener("change", renderResults);
sourceFilter.addEventListener("change", renderResults);
servingsInput.addEventListener("input", renderSummary);

populateCategories();
renderAll();
renderDailyDiary();
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("is-visible");
      });
    },
    { threshold: 0.16 },
  );
  document.querySelectorAll(".reveal-section").forEach((section) => revealObserver.observe(section));
} else {
  document.querySelectorAll(".reveal-section").forEach((section) => section.classList.add("is-visible"));
}
addMessage(
  "bot",
  "Oi! Me diga o que tem em casa. Eu encontro os ingredientes na TACO, você ajusta as gramas e eu gero uma receita leve.",
);
