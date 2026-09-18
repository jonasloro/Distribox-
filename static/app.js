let currentUser = JSON.parse(localStorage.getItem("cl_recebimento_user") || "null");
let currentView = "dashboard";
let currentCardId = null;
let cardData = null;
let receivingPhotos = [];
let dispatchPhotos = [];
let qualityUsers = [];
let processingUsers = [];
let downstreamUsers = {ETIQUETAGEM:[],ESTOCAGEM:[]};
let selectedProductionCardId = null;
let unifiedCache = {warehouse:null,sgo:[],tasks:[],shipments:[],returns:[]};

const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Erro inesperado." }));
    throw new Error(error.detail || "Erro inesperado.");
  }
  return response.json();
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function fmtDate(value) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? value + "T00:00:00" : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("pt-BR");
}

function fmtDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

function fmtSeconds(value) {
  let seconds = Math.max(0, Number(value || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
}

function statusClass(status) {
  if (["AGUARDANDO_QUALIDADE", "RETORNO_CONCLUIDO", "AGUARDANDO_INSPECAO", "AGUARDANDO_CONCLUSAO_QUALIDADE", "AGUARDANDO_PROCESSAMENTO", "AGUARDANDO_INICIO_PROCESSAMENTO", "AGUARDANDO_CONCLUSAO_PROCESSAMENTO", "AGUARDANDO_TRIAGEM", "AGUARDANDO_ETIQUETAGEM", "AGUARDANDO_ESTOCAGEM"].includes(status)) return "green";
  if (["RECEBIMENTO_FISICO_CONCLUIDO_10_PENDENTE", "SEPARACAO_10_CONCLUIDA_RECEBIMENTO_PENDENTE", "RETORNO_FISICO_CONCLUIDO_10_PENDENTE", "SEPARACAO_RETORNO_10_CONCLUIDA_FISICO_PENDENTE", "AGUARDANDO_DESPACHO_COSTURA", "INSPECAO_PAUSADA", "PROCESSAMENTO_PAUSADO"].includes(status)) return "orange";
  if (status === "DESPACHO_CD02") return "red";
  if (["EM_COSTURA_CD01", "EM_INSPECAO", "EM_PROCESSAMENTO"].includes(status)) return "purple";
  return "";
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 3500);
}

async function doLogin() {
  try {
    currentUser = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: $("loginUsername").value, password: $("loginPassword").value }),
    });
    localStorage.setItem("cl_recebimento_user", JSON.stringify(currentUser));
    $("loginError").textContent = "";
    enterApp();
  } catch (error) {
    $("loginError").textContent = error.message;
  }
}

function enterApp() {
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("currentUser").innerHTML = `<strong>${esc(currentUser.name)}</strong><br>${esc(currentUser.role)}`;
  goTo("dashboard");
}

function logout() {
  localStorage.removeItem("cl_recebimento_user");
  location.reload();
}

function setPage(title, subtitle) {
  $("pageTitle").textContent = title;
  $("pageSubtitle").textContent = subtitle;
}

function activeNav(view) {
  const parent = ({storage:"storage-hub",warehouse:"storage-hub","warehouse-heatmap":"storage-hub","stock-stats":"storage-hub","capacity-simulator":"storage-hub",returns:"returns-hub","return-indicators":"returns-hub","return-history":"returns-hub",sgo:"sgo-indicators",tasks:"sgo-indicators",import:"sgo-indicators",test:"settings"})[view] || view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === parent);
  });
}

async function goTo(view) {
  currentView = view;
  activeNav(view);
  try {
    if (view === "dashboard") await renderDashboard();
    if (view === "receiving") await renderCards("receiving");
    if (view === "quality") await renderCards("quality");
    if (view === "processing") await renderCards("processing");
    if (view === "labeling") await renderCards("labeling");
    if (view === "storage") await renderCards("storage");
    if (view === "storage-hub") await renderStorageHub();
    if (view === "warehouse") await renderWarehouse();
    if (view === "warehouse-heatmap") await renderWarehouseHeatmap();
    if (view === "stock-stats") await renderStockStatistics();
    if (view === "capacity-simulator") await renderCapacitySimulator();
    if (view === "sgo") await renderSgo();
    if (view === "sgo-indicators") await renderSgoIndicators();
    if (view === "tasks") await renderTasks();
    if (view === "shipping") await renderShipping();
    if (view === "returns") await renderReturnsV3();
    if (view === "returns-hub") await renderReturnsHub();
    if (view === "return-indicators") await renderReturnIndicators();
    if (view === "return-history") await renderReturnHistory();
    if (view === "registrations") await renderRegistrations();
    if (view === "settings") await renderSettings();
    if (view === "import") await renderImport();
    if (view === "test") await renderTestTools();
    if (view === "history") await renderGlobalHistory();
  } catch (error) {
    console.error(error);
    $("mainContent").innerHTML = `<div class="state-panel error-state"><b>Não foi possível carregar esta visão.</b><span>${esc(error.message)}</span><button class="primary" onclick="refreshCurrentView()">Tentar novamente</button></div>`;
  }
}

async function refreshCurrentView() {
  if (currentCardId) return openCard(currentCardId);
  return goTo(currentView);
}

function globalSearchKey(event) {
  if (event.key !== "Enter") return;
  const term = event.target.value.trim();
  if (!term) return;
  goTo("receiving").then(() => {
    const input = document.querySelector(".queue-search input");
    if (input) { input.value = term; input.dispatchEvent(new Event("input")); }
  });
}

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); $("globalSearch")?.focus();
  }
});

function showQuickHelp() {
  $("modalBody").innerHTML = `<div class="card-title"><div><h2>Ajuda rápida</h2><div class="card-subtitle">OutLog One — fluxo operacional</div></div></div><div class="help-grid"><button onclick="closeModal();goTo('receiving')"><b>Recebimento</b><span>Físico, tiragem de 10% e triagem.</span></button><button onclick="closeModal();goTo('quality')"><b>Qualidade</b><span>Inspeções, amostras e resultados.</span></button><button onclick="closeModal();goTo('storage-hub')"><b>Estocagem</b><span>Fila, mapa, consulta e capacidade.</span></button><button onclick="closeModal();goTo('returns-hub')"><b>Devoluções</b><span>Conferência, pendências e indicadores.</span></button></div>`;
  $("modal").classList.remove("hidden");
}

async function renderDashboardLegacy() {
  setPage("Central de Operações", "Produção, estoque, SGO, expedição e devoluções na mesma visão");
  const [data, unified] = await Promise.all([api("/api/dashboard"), api("/api/unified/overview")]);
  const metrics = [
    ["No Recebimento", data.totals.receiving, "#0891b2"],
    ["Na Qualidade", data.totals.quality, "#0f766e"],
    ["No Processamento", data.totals.processing, "#0f766e"],
    ["Na Estocagem", data.totals.storage, "#166534"],
    ["Capacidade utilizada", `${unified.warehouse.percentage}%`, unified.warehouse.percentage > 90 ? "#d92d20" : "#22c55e"],
    ["Entradas SGO", Object.values(unified.sgo).reduce((a,b)=>a+b,0), "#2563eb"],
    ["Tarefas pendentes", (unified.tasks.PENDENTE||0)+(unified.tasks.EM_ANDAMENTO||0), "#e98b08"],
    ["Devoluções abertas", Object.entries(unified.returns).filter(([k])=>k!=="CONCLUIDA").reduce((a,[,v])=>a+v,0), "#d92d20"],
  ];
  const max = Math.max(1, ...data.status_counts.map((row) => row.value));
  $("mainContent").innerHTML = `
    <div class="kpi-grid">
      ${metrics.map(([label, value, color]) => `
        <div class="kpi" style="--accent:${color}">
          <div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-hint">Cards</div>
        </div>`).join("")}
    </div>
    <div class="operation-flow">
      ${[["Compra / SGO","sgo",Object.values(unified.sgo).reduce((a,b)=>a+b,0)],["Recebimento + 10%","receiving",data.totals.receiving],["Qualidade","quality",data.totals.quality],["Processamento","processing",data.totals.processing],["Etiquetagem","labeling",data.totals.labeling||0],["Estocagem","storage",data.totals.storage],["Expedição","shipping","→"],["Devoluções","returns",Object.values(unified.returns).reduce((a,b)=>a+b,0)]].map(([label,view,total])=>`<button onclick="goTo('${view}')"><span>Etapa</span><strong>${total}</strong><small>${label}</small></button>`).join("")}
    </div>
    <div class="grid-two dashboard-panels">
      <div class="panel">
        <div class="panel-header">Distribuição por situação</div>
        <div class="panel-body">
          ${data.status_counts.length ? data.status_counts.map((row) => `
            <div class="bar-row"><span>${esc(row.label)}</span><div class="bar-track"><i style="width:${(row.value/max)*100}%"></i></div><b>${row.value}</b></div>
          `).join("") : '<div class="notice">Importe o relatório para iniciar.</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">Regra de liberação</div>
        <div class="panel-body">
          <div class="notice"><b>Mercadoria nova</b><br>Recebimento físico e separação dos 10% com triagem inicial podem terminar em qualquer ordem.</div>
          <div class="notice warn"><b>O Card só sai do Recebimento quando as duas partes estiverem concluídas.</b></div>
          <div class="notice success-box"><b>Retorno CD01</b><br>O Recebimento separa uma nova amostra de 10% sobre a quantidade retornada. A Qualidade usa essa amostra na Inspeção 2 obrigatória.</div>
        </div>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <div class="panel-header">Cards atualizados recentemente</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Compra</th><th>Fornecedor</th><th>Marca</th><th>Tipo</th><th>Qtd.</th><th>Casulo</th><th>Setor</th><th>Status</th><th></th></tr></thead>
        <tbody>${data.recent.map((card) => `
          <tr><td><b>${esc(card.purchase_id)}</b></td><td>${esc(card.supplier||"—")}</td><td>${esc(card.brand||"—")}</td>
          <td>${esc(card.purchase_mode === "GRADE" ? "Grade" : card.purchase_mode === "SALDO" ? "Saldo" : "—")}</td><td>${card.expected_total}</td><td>${esc(card.casulo_current||"—")}</td><td>${esc(card.current_sector)}</td>
          <td><span class="badge ${statusClass(card.status)}">${esc(card.status_label)}</span></td>
          <td><button class="primary small-btn" onclick="openCard(${card.id})">Abrir</button></td></tr>
        `).join("") || '<tr><td colspan="9">Nenhum Card.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

function metricCardsHtml(scope, totals) {
  if (scope === "receiving") {
    const qty = Number(totals.receiving_qty || 0), capacity = Number(totals.warehouse_capacity || 0);
    const percentage = capacity ? (qty * 100 / capacity).toFixed(1) : "0.0";
    return `<div class="metric-row-2"><div class="kpi"><div class="kpi-label">Peças aguardando recebimento</div><div class="kpi-value">${qty.toLocaleString("pt-BR")}</div></div><div class="kpi"><div class="kpi-label">% da capacidade real do CD</div><div class="kpi-value">${percentage}%</div></div></div>`;
  }
  if (scope === "quality") {
    const qty = Number(totals.quality_qty || 0), total = Number(totals.quality || 0), active = Number(totals.quality_in_progress || 0);
    return `<div class="metric-row-2"><div class="kpi"><div class="kpi-label">Peças em Qualidade</div><div class="kpi-value">${qty.toLocaleString("pt-BR")}</div></div><div class="kpi"><div class="kpi-label">% em inspeção ativa</div><div class="kpi-value">${total?(active*100/total).toFixed(1):"0.0"}%</div></div></div>`;
  }
  if (scope === "processing") {
    const qty = Number(totals.processing_qty || 0), total = Number(totals.processing || 0), active = Number(totals.processing_in_progress || 0);
    return `<div class="metric-row-2"><div class="kpi"><div class="kpi-label">Peças em Processamento</div><div class="kpi-value">${qty.toLocaleString("pt-BR")}</div></div><div class="kpi"><div class="kpi-label">% em execução ativa</div><div class="kpi-value">${total?(active*100/total).toFixed(1):"0.0"}%</div></div></div>`;
  }
  return "";
}

async function renderCards(scope) {
  const quality = scope === "quality";
  const processing = scope === "processing";
  const labeling = scope === "labeling", storage = scope === "storage";
  const title = quality ? "Qualidade" : processing ? "Processamento" : labeling ? "Etiquetagem" : storage ? "Estocagem" : "Recebimento";
  const subtitle = quality ? "Inspeção ágil e preenchimento guiado" : processing ? "Seleção compacta de materiais" : labeling ? "Grade por tamanho; Saldo por quantidade" : storage ? "Entrada em estoque por tamanho ou saldo geral" : "Controle geral da produção e posição real de cada item";
  setPage(title, subtitle);
  const cards = await api(`/api/cards?scope=${scope}`);
  const metrics = ["receiving","quality","processing"].includes(scope)
    ? metricCardsHtml(scope, (await api("/api/dashboard")).totals) : "";
  if (["receiving","quality","processing","labeling","storage"].includes(scope)) {
    const tabs = storage ? moduleTabs([["Visão geral","storage-hub"],["Fila operacional","storage"],["Mapa de casulos","warehouse"],["Mapa de Calor","warehouse-heatmap"],["Estatísticas","stock-stats"],["Simulador","capacity-simulator"]],"storage") : "";
    $("mainContent").innerHTML = tabs + metrics + processingQueueHtml(cards, scope);
    filterProductionQueue();
    return;
  }
  $("mainContent").innerHTML = `
    <div class="toolbar">
      <input id="cardSearch" placeholder="Pesquisar compra, fornecedor, marca ou Casulo" onkeydown="if(event.key==='Enter') searchCards('${scope}')">
      <button class="primary" onclick="searchCards('${scope}')">Pesquisar</button>
    </div>
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Compra</th><th>Fornecedor</th><th>Marca</th><th>Tipo</th><th>Itens</th><th>Qtd. esperada</th><th>Casulo</th><th>Status</th><th></th></tr></thead>
      <tbody id="cardsBody">${cardRows(cards, scope)}</tbody>
    </table></div></div>`;
}

function processingQueueHtml(cards, scope=currentView) {
  const tab = ["receiving","quality","processing","labeling","storage"].includes(scope) ? scope : "processing";
  const brands = [...new Set(cards.map((c)=>c.brand).filter(Boolean))].sort();
  return `<div class="work-queue">
    <div class="queue-toolbar">
      <div class="queue-search"><span>⌕</span><input id="productionMaterialSearch" placeholder="Compra, fornecedor, marca, produto ou Casulo" oninput="filterProductionQueue()"></div>
      <select id="productionTypeFilter" onchange="filterProductionQueue()"><option value="">Todos os tipos</option><option value="GRADE">Grade</option><option value="SALDO">Saldo</option></select>
      <select id="productionStatusFilter" onchange="filterProductionQueue()"><option value="">Todos os status</option><option value="AGUARDANDO">Aguardando</option><option value="ATIVO">Em produção</option><option value="PAUSADO">Pausados</option></select>
      <select id="productionBrandFilter" onchange="filterProductionQueue()"><option value="">Todas as marcas</option>${brands.map((b)=>`<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select>
      <button class="ghost" onclick="clearProductionFilters()">Limpar</button>
    </div>
    <div class="queue-counter"><b id="productionVisibleCount">${cards.length}</b> materiais encontrados <span>• selecione uma linha para continuar</span></div>
    <div class="panel queue-panel"><div class="table-wrap queue-table-wrap"><table class="compact-table production-queue-table">
      <thead><tr><th class="select-col"></th><th>Material / compra</th><th>Fornecedor</th><th>Marca</th><th>Tipo</th><th>Itens</th><th>Qtd.</th><th>Casulo</th><th>Status</th><th></th></tr></thead>
      <tbody id="productionQueueBody">${cards.map((card)=>productionQueueRow(card,tab)).join("") || '<tr><td colspan="10">Nenhum material disponível.</td></tr>'}</tbody>
    </table></div></div>
    <div id="productionSelectionBar" class="selection-bar hidden"><div><span>Material selecionado</span><b id="productionSelectionLabel"></b></div><div class="actions"><button class="ghost" onclick="clearProductionSelection()">Cancelar</button><button class="primary" onclick="openSelectedProduction('${tab}')">Abrir controle →</button></div></div>
  </div>`;
}

function productionActivity(card, tab="processing") {
  const status=String(card.status||"");
  if (tab==="receiving") {
    if (card.receiving_activity==="PAUSADA") return "PAUSADO";
    if (card.receiving_activity==="EM_ANDAMENTO") return "ATIVO";
    return "AGUARDANDO";
  }
  if (tab==="quality") {
    if (status==="INSPECAO_PAUSADA") return "PAUSADO";
    if (["EM_INSPECAO","AGUARDANDO_CONCLUSAO_QUALIDADE"].includes(status)) return "ATIVO";
    return "AGUARDANDO";
  }
  if (tab==="processing") return status==="EM_PROCESSAMENTO" ? "ATIVO" : status==="PROCESSAMENTO_PAUSADO" ? "PAUSADO" : "AGUARDANDO";
  return "AGUARDANDO";
}

function productionQueueRow(card,tab="processing") {
  const searchable = [card.purchase_id,card.supplier,card.brand,card.casulo_current,card.original_type,card.material_search].join(" ").toLowerCase();
  const activity = productionActivity(card,tab);
  return `<tr class="production-material-row" tabindex="0" data-id="${card.id}" data-label="${esc(card.purchase_id)} — ${esc(card.brand||card.supplier||'Sem marca')}" data-search="${esc(searchable)}" data-type="${esc(card.purchase_mode||'')}" data-status="${activity}" data-brand="${esc(card.brand||'')}" onclick="selectProductionMaterial(${card.id})" ondblclick="openCard(${card.id},'${tab}')" onkeydown="if(event.key==='Enter')openCard(${card.id},'${tab}')">
    <td class="select-col"><span class="row-selector"></span></td><td><b>${esc(card.purchase_id)}</b><small>${esc(card.original_type||'')}</small></td><td>${esc(card.supplier||"—")}</td><td>${esc(card.brand||"—")}</td><td><span class="type-pill">${card.purchase_mode === "GRADE" ? "Grade" : "Saldo"}</span></td><td>${card.item_count}</td><td><b>${card.expected_total}</b></td><td>${esc(card.casulo_current||"—")}</td><td><span class="badge ${statusClass(card.status)}">${esc(card.status_label)}</span></td><td><button class="row-open" onclick="event.stopPropagation();openCard(${card.id},'${tab}')" aria-label="Abrir material">›</button></td></tr>`;
}

function filterProductionQueue() {
  const search=normalizeSearch($("productionMaterialSearch")?.value||""),type=$("productionTypeFilter")?.value||"",status=$("productionStatusFilter")?.value||"",brand=$("productionBrandFilter")?.value||"";
  let visible=0;
  document.querySelectorAll(".production-material-row").forEach((row)=>{const show=(!search||normalizeSearch(row.dataset.search).includes(search))&&(!type||row.dataset.type===type)&&(!status||row.dataset.status===status)&&(!brand||row.dataset.brand===brand);row.classList.toggle("hidden",!show);if(show)visible++;});
  if (selectedProductionCardId && document.querySelector(`.production-material-row[data-id="${selectedProductionCardId}"]`)?.classList.contains("hidden")) clearProductionSelection();
  if ($("productionVisibleCount")) $("productionVisibleCount").textContent=visible;
}
function normalizeSearch(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();}
function clearProductionFilters(){["productionMaterialSearch","productionTypeFilter","productionStatusFilter","productionBrandFilter"].forEach((id)=>{if($(id))$(id).value=""});filterProductionQueue();}
function selectProductionMaterial(id){selectedProductionCardId=id;document.querySelectorAll(".production-material-row").forEach((row)=>row.classList.toggle("selected",Number(row.dataset.id)===id));const row=document.querySelector(`.production-material-row[data-id="${id}"]`);$("productionSelectionLabel").textContent=row?.dataset.label||"";$("productionSelectionBar").classList.remove("hidden");}
function clearProductionSelection(){selectedProductionCardId=null;document.querySelectorAll(".production-material-row").forEach((row)=>row.classList.remove("selected"));$("productionSelectionBar")?.classList.add("hidden");}
function openSelectedProduction(tab="processing"){if(selectedProductionCardId)openCard(selectedProductionCardId,tab);}

function cardRows(cards, scope="receiving") {
  const tab = scope === "quality" ? "quality" : scope === "processing" ? "processing" : scope === "labeling" ? "labeling" : scope === "storage" ? "storage" : "receiving";
  return cards.map((card) => `
    <tr><td><b>${esc(card.purchase_id)}</b></td><td>${esc(card.supplier||"—")}</td><td>${esc(card.brand||"—")}</td>
    <td>${esc(card.purchase_mode === "GRADE" ? "Grade" : card.purchase_mode === "SALDO" ? "Saldo" : card.original_type||"—")}</td><td>${card.item_count}</td><td>${card.expected_total}</td><td>${esc(card.casulo_current||"—")}</td>
    <td><span class="badge ${statusClass(card.status)}">${esc(card.status_label)}</span></td>
    <td><button class="primary small-btn" onclick="openCard(${card.id},'${tab}')">Abrir Card</button></td></tr>
  `).join("") || '<tr><td colspan="9">Nenhum Card nesta lista.</td></tr>';
}

async function searchCards(scope) {
  const cards = await api(`/api/cards?scope=${scope}&search=${encodeURIComponent($("cardSearch").value)}`);
  $("cardsBody").innerHTML = cardRows(cards, scope);
}

async function renderImport() {
  setPage("Importar Excel", "Leitura completa das compras operacionais");
  const imports = await api("/api/imports");
  const allowed = currentUser.role === "admin";
  $("mainContent").innerHTML = `
    <div class="panel"><div class="panel-header">Relatório de Compras</div><div class="panel-body">
      <div class="notice">O sistema lê compras em <b>Trânsito</b> ou <b>Operações</b>, identifica a posição real de cada item e mantém o Card no <b>Recebimento</b>. A coluna <b>Tipo</b> classifica: <b>Private Label = Grade</b> e <b>Saldo = Saldo</b>.</div>
      ${allowed ? `<div class="import-zone"><h3>Selecione o arquivo oficial</h3><p>Há um arquivo para teste na pasta <b>arquivo_teste</b>.</p><input id="excelFile" type="file" accept=".xlsx,.xlsm"><br><button class="primary" onclick="uploadExcel()">Importar</button><div id="importResult"></div></div>` : '<div class="notice warn">Somente o Administrador pode importar arquivos.</div>'}
    </div></div>
    <div class="panel" style="margin-top:14px"><div class="panel-header">Últimas importações</div><div class="table-wrap"><table>
      <thead><tr><th>Arquivo</th><th>Linhas</th><th>Operacionais</th><th>Cards criados</th><th>Atualizados</th><th>Itens criados</th><th>Data</th></tr></thead>
      <tbody>${imports.map((row) => `<tr><td>${esc(row.filename)}</td><td>${row.total_rows}</td><td>${row.matched_rows}</td><td>${row.cards_created}</td><td>${row.cards_updated}</td><td>${row.items_created}</td><td>${fmtDateTime(row.created_at)}</td></tr>`).join("") || '<tr><td colspan="7">Nenhuma importação.</td></tr>'}</tbody>
    </table></div></div>`;
}

async function uploadExcel() {
  const file = $("excelFile").files[0];
  if (!file) return toast("Selecione o arquivo Excel.");
  const form = new FormData();
  form.append("file", file);
  $("importResult").innerHTML = '<div class="notice">Importando e agrupando os Cards...</div>';
  try {
    const response = await fetch(`/api/import-excel?user_id=${currentUser.id}`, { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Erro na importação.");
    $("importResult").innerHTML = `<div class="notice success-box"><b>Importação concluída.</b><br>Linhas lidas: ${data.total_rows}<br>Linhas operacionais: ${data.matched_rows}<br>Cards criados: ${data.cards_created}<br>Cards atualizados: ${data.cards_updated}<br>Itens criados: ${data.items_created}<br>Itens atualizados: ${data.items_updated}<br>Cards CD02 removidos: ${data.cards_removed_cd02||0}<br>Erros: ${data.errors.length}</div>`;
    toast("Importação concluída.");
  } catch (error) {
    $("importResult").innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  }
}

async function renderTestTools() {
  setPage("Ferramentas de teste", "Retorno da Costura CD01 e acesso rápido ao Processamento");
  if (currentUser.role !== "admin") {
    $("mainContent").innerHTML = '<div class="notice warn">Somente o Administrador acessa as simulações.</div>';
    return;
  }
  const [receiving, quality, processing, outside] = await Promise.all([
    api("/api/cards?scope=receiving"), api("/api/cards?scope=quality"), api("/api/cards?scope=processing"), api("/api/cards?scope=outside")
  ]);
  const costuraCards = receiving.filter((card) => card.status === "EM_COSTURA_CD01");
  const allCards = [...receiving, ...quality, ...processing, ...outside];
  const processingCandidates = allCards.filter((card) => card.status !== "DESPACHO_CD02" && card.current_sector !== "PROCESSAMENTO");
  $("mainContent").innerHTML = `
    <div class="notice">As simulações não substituem os fluxos reais. Elas existem somente para permitir o teste isolado dos módulos ainda em construção.</div>
    <div class="panel"><div class="panel-header">Retorno da Costura CD01</div><div class="table-wrap"><table>
      <thead><tr><th>Compra</th><th>Fornecedor</th><th>Status</th><th>Destino</th><th>Ações</th></tr></thead>
      <tbody>${costuraCards.map((card) => `
        <tr><td><b>${esc(card.purchase_id)}</b></td><td>${esc(card.supplier||"—")}</td><td><span class="badge ${statusClass(card.status)}">${esc(card.status_label)}</span></td><td>${esc(card.quality_destination||"—")}</td>
        <td><button class="success small-btn" onclick="simulateReturn(${card.id})">Registrar retorno CD01</button></td></tr>
      `).join("") || '<tr><td colspan="5">Nenhum Card em Costura CD01.</td></tr>'}</tbody>
    </table></div></div>
    <div class="panel" style="margin-top:14px"><div class="panel-header">Enviar diretamente ao Processamento para teste</div><div class="table-wrap"><table>
      <thead><tr><th>Compra</th><th>Fornecedor</th><th>Tipo</th><th>Setor atual</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${processingCandidates.map((card) => `
        <tr><td><b>${esc(card.purchase_id)}</b></td><td>${esc(card.supplier||"—")}</td><td>${esc(card.purchase_mode === "GRADE" ? "Grade" : card.purchase_mode === "SALDO" ? "Saldo" : "Não reconhecido")}</td><td>${esc(card.current_sector)}</td><td><span class="badge ${statusClass(card.status)}">${esc(card.status_label)}</span></td>
        <td><button class="primary small-btn" onclick="simulateSendProcessing(${card.id})">Enviar ao Processamento</button></td></tr>
      `).join("") || '<tr><td colspan="6">Nenhum Card disponível.</td></tr>'}</tbody>
    </table></div></div>`;
}

async function simulateReturn(cardId) {
  try {
    await api(`/api/test/cards/${cardId}/costura-return`, { method: "POST", body: JSON.stringify({ user_id: currentUser.id }) });
    toast("Retorno CD01 enviado ao Recebimento.");
    renderTestTools();
  } catch (error) { toast(error.message); }
}

async function simulateSendProcessing(cardId) {
  if (!confirm("Enviar este Card diretamente ao Processamento somente para teste?")) return;
  try {
    await api(`/api/test/cards/${cardId}/send-processing`, { method: "POST", body: JSON.stringify({ user_id: currentUser.id }) });
    toast("Card enviado ao Processamento para teste.");
    renderTestTools();
  } catch (error) { toast(error.message); }
}

async function renderGlobalHistory() {
  setPage("Histórico", "Todas as movimentações do Card único");
  const rows = await api("/api/history?limit=500");
  $("mainContent").innerHTML = `<div class="panel"><div class="panel-header">Últimos eventos</div><div class="panel-body"><div class="timeline">
    ${rows.map((event) => `<div class="timeline-event"><b>Compra ${esc(event.purchase_id)} — ${esc(event.description)}</b><br><small>${fmtDateTime(event.created_at)} ${event.user_name ? "• "+esc(event.user_name) : ""}</small></div>`).join("") || '<div class="notice">Nenhum evento.</div>'}
  </div></div></div>`;
}

async function openCard(cardId, tab = "receiving") {
  currentCardId = cardId;
  cardData = await api(`/api/cards/${cardId}`);
  receivingPhotos = cardData.receiving?.photo_paths || [];
  dispatchPhotos = cardData.dispatch?.photo_paths || [];
  $("modalBody").innerHTML = `
    <div class="card-title"><div><h2>Card da Compra ${esc(cardData.purchase_id)}</h2><div class="card-subtitle">${esc(cardData.supplier||"—")} • ${esc(cardData.brand||"—")} • ${cardData.expected_total} peças</div></div><span class="badge ${statusClass(cardData.status)}">${esc(cardData.status_label)}</span></div>
    <div class="summary-grid">
      <div class="summary-box"><span>Setor atual</span><strong>${esc(cardData.current_sector)}</strong></div>
      <div class="summary-box"><span>Tipo de entrada</span><strong>${cardData.receiving_type === "RETORNO" ? "Retorno da Costura" : "Mercadoria nova"}</strong></div>
      <div class="summary-box"><span>Tipo da compra</span><strong>${cardData.purchase_mode === "GRADE" ? "Grade" : cardData.purchase_mode === "SALDO" ? "Saldo" : "Não reconhecido"}</strong></div>
      <div class="summary-box"><span>Itens</span><strong>${cardData.items.length}</strong></div>
      <div class="summary-box"><span>Quantidade esperada</span><strong>${cardData.expected_total}</strong></div>
      <div class="summary-box"><span>Casulo atual</span><strong>${esc(cardData.casulo_current||"Não informado")}</strong></div>
    </div>
    <div class="tabs">
      <button id="tabReceivingBtn" onclick="renderReceivingTab()">Recebimento</button>
      <button id="tabQualityBtn" onclick="renderQualityTab()">Qualidade</button>
      <button id="tabProcessingBtn" onclick="renderProcessingTab()">Processamento</button>
      <button id="tabLabelingBtn" onclick="renderDownstreamTab('ETIQUETAGEM')">Etiquetagem</button>
      <button id="tabStorageBtn" onclick="renderDownstreamTab('ESTOCAGEM')">Estocagem</button>
      <button id="tabCasuloBtn" onclick="renderCasuloTab()">Casulo</button>
      <button id="tabProductsBtn" onclick="renderProductsTab()">Produtos</button>
      <button id="tabHistoryBtn" onclick="renderCardHistory()">Histórico</button>
    </div>
    <div id="cardTab"></div>`;
  $("modal").classList.remove("hidden");
  if (tab === "casulo") renderCasuloTab();
  else if (tab === "quality") renderQualityTab();
  else if (tab === "processing") renderProcessingTab();
  else if (tab === "labeling") renderDownstreamTab("ETIQUETAGEM");
  else if (tab === "storage") renderDownstreamTab("ESTOCAGEM");
  else if (tab === "products") renderProductsTab();
  else if (tab === "history") renderCardHistory();
  else renderReceivingTab();
}

function activateTab(id) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
  $(id)?.classList.add("active");
}

function canOperateReceiving() {
  return currentUser.role === "recebimento" && cardData.current_sector === "RECEBIMENTO";
}

function canOperateQuality() {
  return ["qualidade", "supervisor", "admin"].includes(currentUser.role);
}

function canDistributeQuality() {
  return ["supervisor", "admin"].includes(currentUser.role);
}

function canOperateProcessing() {
  return ["processamento", "supervisor", "admin"].includes(currentUser.role);
}

function canDistributeProcessing() {
  return ["supervisor", "admin"].includes(currentUser.role);
}

function renderReceivingTab() {
  activateTab("tabReceivingBtn");
  if (cardData.source_snapshot_at && !cardData.receiving) {
    window.sourceAllowedStages=null;
    $("cardTab").innerHTML = sourceLocationHtml();
    return;
  }
  if (cardData.source_snapshot_at && cardData.current_sector !== "RECEBIMENTO") {
    window.sourceAllowedStages=null;
    $("cardTab").innerHTML = `<div class="notice"><b>Andamento local preservado:</b> ${esc(cardData.current_sector)} — ${esc(cardData.status_label)}.</div>${sourceLocationHtml()}`;
    return;
  }
  if (cardData.current_sector !== "RECEBIMENTO") {
    $("cardTab").innerHTML = outsideReceivingHtml();
    return;
  }
  if (cardData.status === "AGUARDANDO_DESPACHO_COSTURA") {
    $("cardTab").innerHTML = dispatchHtml();
    return;
  }
  if (cardData.status === "AGUARDANDO_RECEBIMENTO_RETORNO") {
    $("cardTab").innerHTML = receivingFormHtml(true);
    window.setTimeout(refreshTimerDisplay, 500);
    return;
  }
  if (cardData.status === "EM_COSTURA_CD01" || cardData.receiving?.receiving_type === "COSTURA") {
    $("cardTab").innerHTML = inCosturaHtml();
    return;
  }
  const isReturn = cardData.receiving?.receiving_type === "RETORNO" || cardData.receiving_type === "RETORNO";
  $("cardTab").innerHTML = receivingFormHtml(isReturn);
  window.setTimeout(refreshTimerDisplay, 500);
}

function sourceLocationHtml() {
  const stages = {};
  cardData.items.forEach((i)=>stages[i.source_stage]=(stages[i.source_stage]||0)+1);
  return `<div class="panel-body"><div class="notice success-box"><b>Card mantido no Recebimento</b><br>Esta é a fotografia do último relatório importado. A posição é controlada por item/tamanho, inclusive quando uma mesma compra está dividida entre etapas.</div>
    <div class="stage-chips">${Object.entries(stages).map(([s,n])=>`<button class="stage-chip" onclick="filterSourceItems('${esc(s)}')"><b>${n}</b> ${esc(sourceStageLabel(s))}</button>`).join("")}<button class="stage-chip" onclick="filterSourceItems('')">Mostrar todos</button></div>
    <div class="queue-search source-search"><span>⌕</span><input id="sourceItemSearch" placeholder="Produto, referência, cor, tamanho ou costureiro" oninput="filterSourceItems()"></div>
    <div class="table-wrap source-items"><table class="compact-table"><thead><tr><th>Produto</th><th>Referência</th><th>Cor</th><th>Tamanho</th><th>Qtd.</th><th>Posição</th><th>Costureiro</th></tr></thead><tbody>
    ${cardData.items.map((i)=>`<tr class="source-item-row" data-stage="${esc(i.source_stage)}" data-search="${esc([i.product,i.reference,i.sku,i.color,i.size,i.source_seamstress].join(' ').toLowerCase())}"><td><b>${esc(i.product||'—')}</b></td><td>${esc(i.reference||i.sku||'—')}</td><td>${esc(i.color||'—')}</td><td><b>${esc(i.size||'—')}</b></td><td>${i.expected_qty}</td><td><span class="type-pill">${esc(sourceStageLabel(i.source_stage))}</span><small>${esc(i.source_status_pcp||i.source_status_logistics||i.source_status_quality||'')}</small></td><td>${esc(i.source_seamstress||'—')}</td></tr>`).join("")}
    </tbody></table></div><div class="notice">Atualizado em ${fmtDateTime(cardData.source_snapshot_at)}. Uma nova importação atualiza a posição sem criar outro Card.</div></div>`;
}
function sourceStageLabel(s){return ({FORNECEDOR:"No fornecedor",TRANSITO:"Em trânsito",QUALIDADE:"Qualidade",QUALIDADE_RETRABALHO:"Retrabalho",QUALIDADE_REJEITADO:"Rejeitado",PCP_CONFIGURAR:"PCP — configurar",AGUARDANDO_COSTURA:"Vai para Costura",EM_COSTURA:"Na Costura",RETORNO_COSTURA:"Retornou da Costura",AGUARDANDO_PROCESSAMENTO:"Aguardando Processamento",PROCESSAMENTO:"Processamento",TRIAGEM:"Triagem",ETIQUETAGEM:"Etiquetagem",ESTOCAGEM:"Estocagem",CONCLUIDO:"Concluído"})[s]||s||"Não classificado";}
function filterSourceItems(stage="__KEEP__"){
  if(stage!=="__KEEP__") window.sourceStageFilter=stage;
  const term=normalizeSearch($("sourceItemSearch")?.value||"");
  document.querySelectorAll(".source-item-row").forEach((r)=>r.classList.toggle("hidden",!!((window.sourceAllowedStages&&!window.sourceAllowedStages.includes(r.dataset.stage))||(window.sourceStageFilter&&r.dataset.stage!==window.sourceStageFilter)||(term&&!normalizeSearch(r.dataset.search).includes(term)))));
}

function renderImportedSectorSnapshot(tabId,stages,title){
  activateTab(tabId); window.sourceAllowedStages=stages; window.sourceStageFilter="";
  $("cardTab").innerHTML=`<div class="notice success-box"><b>${esc(title)}</b><br>Este Card possui itens nesta etapa conforme o relatório importado.</div>${sourceLocationHtml()}`;
  filterSourceItems("");
}

function outsideReceivingHtml() {
  const d = cardData.dispatch;
  return `<div class="panel-body">
    <div class="notice">Este Card não está atualmente no Recebimento. Os dados permanecem disponíveis somente para consulta.</div>
    ${cardData.status === "EM_COSTURA_CD01" && d ? `<div class="form-grid"><div class="field"><label>Transportadora</label><input class="readonly" readonly value="${esc(d.carrier)}"></div><div class="field"><label>Costureiro</label><input class="readonly" readonly value="${esc(d.seamstress_name)}"></div><div class="field"><label>Previsão de retorno</label><input class="readonly" readonly value="${fmtDate(d.return_forecast)}"></div></div>` : ""}
    ${cardData.status === "DESPACHO_CD02" ? '<div class="notice error"><b>Despacho CD02:</b> a mercadoria saiu do fluxo operacional interno.</div>' : ""}
  </div>`;
}

function inCosturaHtml() {
  const d = cardData.dispatch;
  const r = cardData.receiving;
  const operate = canOperateReceiving();
  const productionDone = r?.ten_percent_status === "CONCLUIDA";
  return `<div class="panel-body">
    <div class="notice success-box"><b>Mercadoria em Costura — CD01</b><br>O Card permanece na aba Recebimento para acompanhamento até o retorno da mercadoria.</div>
    <div class="form-grid">
      <div class="field"><label>Status</label><input class="readonly" readonly value="${esc(cardData.status_label)}"></div>
      <div class="field"><label>Destino</label><input class="readonly" readonly value="${esc(cardData.quality_destination || "CD01")}"></div>
      <div class="field"><label>Transportadora</label><input class="readonly" readonly value="${esc(d?.carrier || "—")}"></div>
      <div class="field"><label>Costureiro</label><input class="readonly" readonly value="${esc(d?.seamstress_name || "—")}"></div>
      <div class="field"><label>Quantidade despachada</label><input class="readonly" readonly value="${d?.dispatched_qty ?? "—"}"></div>
      <div class="field"><label>Volumes</label><input class="readonly" readonly value="${d?.volumes ?? "—"}"></div>
      <div class="field"><label>Data do despacho</label><input class="readonly" readonly value="${fmtDateTime(d?.completed_at)}"></div>
      <div class="field"><label>Previsão de retorno</label><input class="readonly" readonly value="${fmtDate(d?.return_forecast)}"></div>
      <div class="field full"><label>Observações do despacho</label><textarea class="readonly" readonly>${esc(d?.notes || "")}</textarea></div>
    </div>
    ${r ? costuraProductionHtml(r, productionDone, operate) : '<div class="notice warn">O controle de produção da Costura será criado automaticamente na próxima atualização do relatório.</div>'}
    <div class="notice warn">Aguardando o retorno da Costura. Quando a mercadoria retornar, será aberto um novo controle de recebimento e uma nova tiragem de 10%, sem perder este acompanhamento.</div>
    ${currentUser.role === "admin" ? `<div class="actions"><button class="success" onclick="simulateReturn(${cardData.id})">Registrar retorno CD01 — teste</button></div>` : ""}
  </div>`;
}

function samplePlanTable(r, title) {
  const rows = r.sample_plan || [];
  if (!rows.length) return "";
  return `<h3 class="section-heading">${esc(title)}</h3>
    <div class="notice"><b>Distribuição automática por cor e tamanho.</b><br>O total de peças é dividido com a mesma regra da Qualidade. Para Grade, cada combinação recebe pelo menos uma peça e a soma fecha exatamente a meta prevista de 10%.</div>
    <div class="table-wrap compact-picker"><table class="compact-table"><thead><tr><th>Produto</th><th>Referência</th><th>Cor</th><th>Tamanho</th><th>Qtd. total</th><th>Retirar nos 10%</th></tr></thead><tbody>
      ${rows.map((item)=>`<tr><td><b>${esc(item.product||"—")}</b></td><td>${esc(item.reference||item.sku||"—")}</td><td>${esc(item.color||"Geral")}</td><td><span class="size-token">${esc(item.size||"Geral")}</span></td><td>${item.expected_qty}</td><td><b>${item.sample_qty}</b></td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="5"><b>Total previsto da tiragem</b></td><td><b>${rows.reduce((sum,item)=>sum+Number(item.sample_qty||0),0)}</b></td></tr></tfoot></table></div>`;
}

function costuraProductionHtml(r, productionDone, operate) {
  const timer = r.timer || {state:"NAO_INICIADA",business_seconds:0,paused_seconds:0,permanence_seconds:0};
  return `<h3 class="section-heading">Controle de produção — Costura</h3>
    <div class="timer-card">
      <div class="form-grid"><div class="field"><label>Quantidade prevista na Costura</label><input class="readonly" readonly value="${(r.operation_items||[]).reduce((sum,item)=>sum+Number(item.expected_qty||0),0)||cardData.expected_total}"></div><div class="field"><label>Quantidade produzida</label><input id="sampleActual" type="number" min="0" ${operate&&!productionDone?"":"readonly"} value="${r.ten_percent_actual??""}"></div></div>
      <div class="timer-grid" style="margin-top:11px"><div class="timer-value"><span>Status</span><strong>${esc(timer.state)}</strong></div><div class="timer-value"><span>Tempo útil</span><strong>${fmtSeconds(timer.business_seconds)}</strong></div><div class="timer-value"><span>Tempo parado</span><strong>${fmtSeconds(timer.paused_seconds)}</strong></div><div class="timer-value"><span>Permanência</span><strong>${fmtSeconds(timer.permanence_seconds)}</strong></div></div>
      <div class="actions">${operate&&!productionDone&&timer.state==="NAO_INICIADA"?'<button class="primary" onclick="sampleAction(\'start\')">Iniciar produção</button>':""}${operate&&!productionDone&&timer.state==="EM_ANDAMENTO"?'<button class="warning" onclick="sampleAction(\'pause\')">Pausar</button><button class="success" onclick="sampleAction(\'finish\')">Concluir produção</button>':""}${operate&&!productionDone&&timer.state==="PAUSADA"?'<button class="primary" onclick="sampleAction(\'resume\')">Retomar</button><button class="success" onclick="sampleAction(\'finish\')">Concluir produção</button>':""}${productionDone?'<span class="badge green">Produção concluída</span>':'<span class="badge orange">Produção em acompanhamento</span>'}</div>
    </div>${samplePlanTable(r,"Previsão da tiragem de 10% no retorno")}`;
}

function receivingFormHtml(isReturn) {
  const r = cardData.receiving;
  if (!r) return '<div class="notice error">Registro de Recebimento não encontrado.</div>';
  const operate = canOperateReceiving();
  const physicalDone = r.physical_status === "CONCLUIDO";
  const sampleDone = r.ten_percent_status === "CONCLUIDA";
  const readOnly = operate && !physicalDone ? "" : "readonly";
  const disabled = operate && !physicalDone ? "" : "disabled";
  const operationItems = r.operation_items || [];
  return `
    <div class="panel-body">
      <div class="notice ${isReturn ? "success-box" : ""}"><b>${isReturn ? "Recebimento do retorno CD01" : "Recebimento de mercadoria em trânsito"}</b><br>${isReturn ? "Registre o retorno e separe uma nova amostra de 10%. O Card só segue para a Inspeção 2 quando as duas partes terminarem." : "O recebimento físico e a separação dos 10% com triagem inicial podem ser concluídos em qualquer ordem. O Card só segue para a Qualidade quando ambos terminarem."}</div>
      ${operationItems.length ? `<div class="notice"><b>${operationItems.length} item(ns) fazem parte deste controle</b><br>Somente estes itens serão movimentados. Os demais itens da compra permanecerão em suas etapas atuais.</div>` : ""}
      <h3 class="section-heading">Recebimento físico</h3>
      <div class="form-grid">
        <div class="field"><label>Volumes</label><input id="recVolumes" type="number" min="0" ${readOnly} value="${r.volumes ?? ""}"></div>
        <div class="field"><label>${isReturn ? "Quantidade retornada" : "Quantidade recebida"}</label><input id="recQty" type="number" min="0" ${readOnly} value="${r.received_qty ?? ""}"></div>
        <div class="field"><label>Danos ou avarias?</label><select id="recDamage" ${disabled}><option value="">Selecione</option><option value="0" ${r.has_damage===0?"selected":""}>Não</option><option value="1" ${r.has_damage===1?"selected":""}>Sim</option></select></div>
        <div class="field full"><label>Descrição dos danos</label><textarea id="recDamageDesc" ${readOnly}>${esc(r.damage_description||"")}</textarea></div>
        <div class="field full"><label>Observações</label><textarea id="recNotes" ${readOnly}>${esc(r.notes||"")}</textarea></div>
      </div>
      <div class="actions">
        ${operate && !physicalDone ? `<button class="secondary" onclick="saveReceiving()">Salvar dados</button><button class="success" onclick="completePhysical()">Concluir recebimento físico</button><label class="primary small-btn" style="cursor:pointer">Adicionar fotos<input id="receivingFiles" type="file" multiple hidden onchange="uploadReceivingPhotos()"></label>` : ""}
        ${physicalDone ? '<span class="badge green">Recebimento físico concluído</span>' : '<span class="badge gray">Recebimento físico pendente</span>'}
      </div>
      <div class="photos">${receivingPhotos.map((p,i)=>`<a class="photo-link" target="_blank" href="${p}">Arquivo ${i+1}</a>`).join("")}</div>
      ${samplePlanTable(r,isReturn?"Plano exato da nova tiragem de 10%":"Plano exato da tiragem de 10%")}
      ${sampleHtml(r, sampleDone, operate, isReturn)}
    </div>`;
}

function sampleHtml(r, sampleDone, operate, isReturn=false) {
  const timer = r.timer || { state:"NAO_INICIADA",business_seconds:0,paused_seconds:0,permanence_seconds:0 };
  const operationTotal = (r.operation_items||[]).reduce((sum,item)=>sum+Number(item.expected_qty||0),0);
  return `
    <h3 class="section-heading">${isReturn ? "Nova tiragem de 10% do retorno" : "Tiragem de 10% + triagem inicial"}</h3>
    <div class="timer-card">
      <div class="form-grid">
        <div class="field"><label>${isReturn && operationTotal ? "Quantidade prevista do retorno" : "Quantidade esperada da compra"}</label><input class="readonly" readonly value="${isReturn && operationTotal ? operationTotal : cardData.expected_total}"></div>
        <div class="field"><label>Quantidade mínima (10%)</label><input class="readonly" readonly value="${r.ten_percent_min}"></div>
        <div class="field"><label>Quantidade efetivamente separada</label><input id="sampleActual" type="number" min="0" ${operate && !sampleDone ? "" : "readonly"} value="${r.ten_percent_actual ?? ""}"></div>
      </div>
      <div class="timer-grid" style="margin-top:11px">
        <div class="timer-value"><span>Status</span><strong>${esc(timer.state)}</strong></div>
        <div class="timer-value"><span>Tempo útil</span><strong id="timerUseful">${fmtSeconds(timer.business_seconds)}</strong></div>
        <div class="timer-value"><span>Tempo parado</span><strong id="timerPaused">${fmtSeconds(timer.paused_seconds)}</strong></div>
        <div class="timer-value"><span>Permanência</span><strong id="timerPermanence">${fmtSeconds(timer.permanence_seconds)}</strong></div>
      </div>
      <div class="actions">
        ${operate && !sampleDone && timer.state === "NAO_INICIADA" ? `<button class="primary" onclick="sampleAction('start')">${isReturn ? "Iniciar tiragem" : "Iniciar tiragem e triagem"}</button>` : ""}
        ${operate && !sampleDone && timer.state === "EM_ANDAMENTO" ? `<button class="warning" onclick="sampleAction('pause')">Pausar</button><button class="success" onclick="sampleAction('finish')">${isReturn ? "Concluir tiragem" : "Concluir tiragem e triagem"}</button>` : ""}
        ${operate && !sampleDone && timer.state === "PAUSADA" ? `<button class="primary" onclick="sampleAction('resume')">Retomar</button><button class="success" onclick="sampleAction('finish')">${isReturn ? "Concluir tiragem" : "Concluir tiragem e triagem"}</button>` : ""}
        ${sampleDone ? `<span class="badge green">${isReturn ? "Nova amostra separada" : "Tiragem e triagem concluídas"}</span>` : `<span class="badge orange">${isReturn ? "Nova amostra pendente" : "Tiragem e triagem pendentes"}</span>`}
      </div>
    </div>`;
}

function dispatchHtml() {
  const operate = canOperateReceiving();
  return `<div class="panel-body">
    <div class="notice warn"><b>Inspeção 1 concluída.</b> A Qualidade definiu o destino <b>${esc(cardData.quality_destination)}</b>. O Recebimento é responsável pelo despacho.</div>
    <div class="form-grid">
      <div class="field"><label>Destino definido pela Qualidade</label><input class="readonly" readonly value="${esc(cardData.quality_destination)}"></div>
      <div class="field"><label>Transportadora</label><input id="dispatchCarrier" ${operate?"":"readonly"}></div>
      <div class="field"><label>Nome do costureiro</label><input id="dispatchSeamstress" ${operate?"":"readonly"}></div>
      <div class="field"><label>Quantidade despachada</label><input id="dispatchQty" type="number" min="0" ${operate?"":"readonly"}></div>
      <div class="field"><label>Volumes</label><input id="dispatchVolumes" type="number" min="0" ${operate?"":"readonly"}></div>
      <div class="field full"><label>Observações</label><textarea id="dispatchNotes" ${operate?"":"readonly"}></textarea></div>
    </div>
    <div class="actions">${operate ? `<button class="success" onclick="completeDispatch()">Concluir despacho</button><label class="primary small-btn" style="cursor:pointer">Adicionar fotos<input id="dispatchFiles" type="file" multiple hidden onchange="uploadDispatchPhotos()"></label>` : '<span class="badge gray">Somente operador de Recebimento</span>'}</div>
    <div class="photos">${dispatchPhotos.map((p,i)=>`<a class="photo-link" target="_blank" href="${p}">Arquivo ${i+1}</a>`).join("")}</div>
  </div>`;
}

async function saveReceiving() {
  try {
    const r = cardData.receiving;
    await api(`/api/receivings/${r.id}`, { method:"PATCH", body:JSON.stringify({
      user_id: currentUser.id,
      volumes: $("recVolumes").value === "" ? null : Number($("recVolumes").value),
      received_qty: $("recQty").value === "" ? null : Number($("recQty").value),
      has_damage: $("recDamage").value === "" ? null : $("recDamage").value === "1",
      damage_description: $("recDamageDesc").value,
      notes: $("recNotes").value,
      photo_paths: receivingPhotos,
      ten_percent_actual: $("sampleActual") ? ($("sampleActual").value === "" ? null : Number($("sampleActual").value)) : r.ten_percent_actual,
    })});
    toast("Dados salvos.");
    await openCard(currentCardId);
  } catch (error) { toast(error.message); }
}

async function completePhysical() {
  try {
    await saveReceivingNoReload();
    await api(`/api/receivings/${cardData.receiving.id}/physical-complete`, { method:"POST", body:JSON.stringify({ user_id:currentUser.id }) });
    toast("Recebimento físico concluído.");
    await openCard(currentCardId);
  } catch (error) { toast(error.message); }
}

async function saveReceivingNoReload() {
  const r = cardData.receiving;
  await api(`/api/receivings/${r.id}`, { method:"PATCH", body:JSON.stringify({
    user_id: currentUser.id,
    volumes: $("recVolumes").value === "" ? null : Number($("recVolumes").value),
    received_qty: $("recQty").value === "" ? null : Number($("recQty").value),
    has_damage: $("recDamage").value === "" ? null : $("recDamage").value === "1",
    damage_description: $("recDamageDesc").value,
    notes: $("recNotes").value,
    photo_paths: receivingPhotos,
    ten_percent_actual: $("sampleActual") ? ($("sampleActual").value === "" ? null : Number($("sampleActual").value)) : r.ten_percent_actual,
  })});
}

async function sampleAction(action) {
  try {
    if ($("sampleActual")) {
      await api(`/api/receivings/${cardData.receiving.id}`, { method:"PATCH", body:JSON.stringify({
        user_id:currentUser.id,
        ten_percent_actual: $("sampleActual").value === "" ? null : Number($("sampleActual").value),
      })});
    }
    await api(`/api/receivings/${cardData.receiving.id}/timer/${action}`, { method:"POST", body:JSON.stringify({ user_id:currentUser.id }) });
    toast(cardData.receiving?.receiving_type === "COSTURA" ? "Controle de produção da Costura atualizado." : "Atividade dos 10% atualizada.");
    await openCard(currentCardId);
  } catch (error) { toast(error.message); }
}

async function uploadFiles(inputId) {
  const files = Array.from($(inputId).files || []);
  if (!files.length) return [];
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  const result = await api("/api/uploads", { method:"POST", body:form });
  return result.paths;
}

async function uploadReceivingPhotos() {
  try {
    receivingPhotos.push(...await uploadFiles("receivingFiles"));
    toast("Arquivos adicionados. Clique em Salvar dados para registrar.");
    renderReceivingTab();
  } catch (error) { toast(error.message); }
}

async function uploadDispatchPhotos() {
  try {
    dispatchPhotos.push(...await uploadFiles("dispatchFiles"));
    toast("Arquivos adicionados ao despacho.");
    renderReceivingTab();
  } catch (error) { toast(error.message); }
}

async function completeDispatch() {
  try {
    await api(`/api/cards/${currentCardId}/dispatch`, { method:"POST", body:JSON.stringify({
      user_id:currentUser.id,
      carrier:$("dispatchCarrier").value,
      seamstress_name:$("dispatchSeamstress").value,
      dispatched_qty:$("dispatchQty").value,
      volumes:$("dispatchVolumes").value,
      notes:$("dispatchNotes").value,
      photo_paths:dispatchPhotos,
    })});
    toast("Despacho concluído.");
    await openCard(currentCardId);
  } catch (error) { toast(error.message); }
}

function renderCasuloTab() {
  activateTab("tabCasuloBtn");
  const canEdit = canOperateReceiving();
  $("cardTab").innerHTML = `<div class="panel-body">
    <div class="casulo-box"><h3 style="margin-top:0">Localização física da mercadoria</h3><div class="form-grid">
      <div class="field"><label>Casulo atual</label><input class="readonly" readonly value="${esc(cardData.casulo_current||"Não informado")}"></div>
      <div class="field"><label>Novo Casulo</label><input id="newCasulo" ${canEdit?"":"readonly"}></div>
      <div class="field"><label>Observação da movimentação</label><input id="casuloNote" ${canEdit?"":"readonly"}></div>
    </div><div class="actions">${canEdit?'<button class="primary" onclick="updateCasulo()">Atualizar Casulo</button>':'<span class="badge gray">Edição permitida somente ao operador de Recebimento enquanto o Card estiver no Recebimento</span>'}</div></div>
    <h3 class="section-heading">Histórico de Casulos</h3>
    <div class="timeline">${cardData.casulo_history.map((row)=>`<div class="timeline-event"><b>${esc(row.old_casulo||"Não informado")} → ${esc(row.new_casulo)}</b><br><small>${fmtDateTime(row.created_at)} • ${esc(row.user_name)} ${row.note?"• "+esc(row.note):""}</small></div>`).join("") || '<div class="notice">Nenhuma movimentação registrada.</div>'}</div>
  </div>`;
}

async function updateCasulo() {
  try {
    await api(`/api/cards/${currentCardId}/casulo`, { method:"POST", body:JSON.stringify({ user_id:currentUser.id,new_casulo:$("newCasulo").value,note:$("casuloNote").value }) });
    toast("Casulo atualizado.");
    await openCard(currentCardId, "casulo");
  } catch (error) { toast(error.message); }
}

function renderProductsTab() {
  activateTab("tabProductsBtn");
  $("cardTab").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Produto</th><th>Referência</th><th>SKU</th><th>Marca</th><th>Cor</th><th>Tamanho</th><th>Lote</th><th>NF</th><th>Qtd. esperada</th></tr></thead>
    <tbody>${cardData.items.map((i)=>`<tr><td>${esc(i.product||"—")}</td><td>${esc(i.reference||"—")}</td><td>${esc(i.sku||"—")}</td><td>${esc(i.brand||"—")}</td><td>${esc(i.color||"—")}</td><td>${esc(i.size||"—")}</td><td>${esc(i.lot||"—")}</td><td>${esc(i.nf||"—")}</td><td>${i.expected_qty}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function renderCardHistory() {
  activateTab("tabHistoryBtn");
  $("cardTab").innerHTML = `<div class="panel-body"><div class="timeline">${cardData.history.map((event)=>`<div class="timeline-event"><b>${esc(event.description)}</b><br><small>${fmtDateTime(event.created_at)} ${event.user_name?"• "+esc(event.user_name):""}</small></div>`).join("") || '<div class="notice">Nenhum evento.</div>'}</div></div>`;
}

async function renderQualityTab() {
  activateTab("tabQualityBtn");
  try {
    if (!qualityUsers.length) qualityUsers = await api("/api/quality/users");
  } catch (error) {
    $("cardTab").innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
    return;
  }
  const q = cardData.quality;
  const importedQualityItems = (cardData.items||[]).filter((item)=>["QUALIDADE","QUALIDADE_RETRABALHO","QUALIDADE_REJEITADO"].includes(item.source_stage));
  if (cardData.source_snapshot_at && (!q || q.status === "CONCLUIDA") && cardData.current_sector !== "QUALIDADE") {
    if (importedQualityItems.length && canOperateQuality()) {
      window.qualitySourceSubset = true;
      $("cardTab").innerHTML = qualitySetupHtml(null, true);
      toggleQualitySetupFields();
      return;
    }
    renderImportedSectorSnapshot("tabQualityBtn",["QUALIDADE","QUALIDADE_RETRABALHO","QUALIDADE_REJEITADO"],"Itens localizados na Qualidade");
    if (importedQualityItems.length) $("cardTab").insertAdjacentHTML("afterbegin",'<div class="notice warn">Entre com um perfil da Qualidade, Supervisor ou Administrador para assumir estes itens e iniciar a inspeção.</div>');
    return;
  }
  window.qualitySourceSubset = false;
  const needsNewInspection = cardData.current_sector === "QUALIDADE" && (!q || q.status === "CONCLUIDA");
  if (needsNewInspection) {
    if (!canOperateQuality()) {
      $("cardTab").innerHTML = '<div class="panel-body"><div class="notice warn">Aguardando um usuário da Qualidade configurar a nova inspeção.</div></div>';
      return;
    }
    $("cardTab").innerHTML = qualitySetupHtml(q);
    toggleQualitySetupFields();
    return;
  }
  if (!q) {
    $("cardTab").innerHTML = '<div class="panel-body"><div class="notice">Este Card ainda não possui inspeção da Qualidade.</div></div>';
    return;
  }
  $("cardTab").innerHTML = qualityInspectionHtml(q);
}

function qualitySetupHtml(previousInspection=null, sourceSubset=false) {
  const defaultType = cardData.receiving_type === "RETORNO" ? 2 : 1;
  const defaultMode = cardData.purchase_mode || previousInspection?.purchase_mode || "";
  return `<div class="panel-body">
    ${sourceSubset ? `<div class="notice success-box"><b>Controle dos itens importados na Qualidade</b><br>Somente os ${((cardData.items||[]).filter((item)=>["QUALIDADE","QUALIDADE_RETRABALHO","QUALIDADE_REJEITADO"].includes(item.source_stage))).length} item(ns) posicionados neste setor entrarão na inspeção. Os demais itens da compra não serão alterados.</div>` : ""}
    ${previousInspection ? `<div class="notice success-box">A Inspeção ${previousInspection.inspection_type} anterior foi concluída em ${fmtDateTime(previousInspection.completed_at)}. O Card retornou à Qualidade para uma nova rodada.</div>` : ""}
    <div class="notice"><b>Configuração da inspeção</b><br>O tipo da compra vem automaticamente da coluna <b>Tipo</b> do Excel: Private Label = Grade e Saldo = Saldo.</div>
    ${cardData.receiving_type === "RETORNO"
      ? '<div class="notice warn"><b>Retorno da Costura:</b> a Inspeção 2 é obrigatória e usará a nova amostra de 10% separada pelo Recebimento.</div>'
      : '<div class="notice success-box"><b>Mercadoria nova:</b> escolha Inspeção 1 somente quando a mercadoria precisar ir para Costura. Escolha Inspeção 2 quando ela já puder seguir diretamente para Processamento. Nos dois casos será usada a amostra dos 10% separada pelo Recebimento.</div>'}
    <div class="form-grid">
      <div class="field"><label>Tipo de inspeção</label><select id="qualityType" onchange="toggleQualitySetupFields()" ${cardData.receiving_type === "RETORNO" ? "disabled" : ""}><option value="1" ${defaultType===1?"selected":""}>Inspeção 1</option><option value="2" ${defaultType===2?"selected":""}>Inspeção 2</option></select></div>
      <div class="field"><label>Tipo da compra</label><input id="qualityPurchaseMode" class="readonly" readonly value="${defaultMode === "GRADE" ? "Grade — controle por item" : defaultMode === "SALDO" ? "Saldo — quantidade geral" : "Tipo não reconhecido"}"></div>
      <div class="field" id="qualityDestinationField"><label>Destino da Inspeção 1</label><select id="qualityDestination"><option value="">Selecione</option><option value="CD01">CD01 — retorna ao nosso CD</option><option value="CD02">CD02 — sai do fluxo interno</option></select></div>
      <div class="field"><label>É necessário separar peças para Desenvolvimento?</label><select id="developmentRequired" onchange="toggleDevelopmentSetup()"><option value="">Selecione</option><option value="0">Não</option><option value="1">Sim</option></select></div>
      <div class="field" id="developmentSeparatedField" style="display:none"><label>As peças para Desenvolvimento já foram separadas?</label><select id="developmentSeparated"><option value="">Selecione</option><option value="0">Não</option><option value="1">Sim</option></select></div>
    </div>
    <div class="actions"><button class="primary" onclick="createQualityInspection()">Criar inspeção</button></div>
  </div>`;
}

function toggleQualitySetupFields() {
  const type = Number($("qualityType")?.value || 1);
  if ($("qualityDestinationField")) $("qualityDestinationField").style.display = type === 1 ? "block" : "none";
}

function toggleDevelopmentSetup() {
  const required = $("developmentRequired")?.value === "1";
  if ($("developmentSeparatedField")) $("developmentSeparatedField").style.display = required ? "block" : "none";
}

async function createQualityInspection() {
  try {
    const requiredValue = $("developmentRequired").value;
    const separatedValue = $("developmentSeparated")?.value ?? "";
    await api(`/api/cards/${currentCardId}/quality/inspections`, {
      method: "POST",
      body: JSON.stringify({
        user_id: currentUser.id,
        inspection_type: Number($("qualityType").value),
        destination: $("qualityDestination")?.value || null,
        development_required: requiredValue === "" ? null : requiredValue === "1",
        development_separated: requiredValue !== "1" ? null : (separatedValue === "" ? null : separatedValue === "1"),
        source_subset: Boolean(window.qualitySourceSubset),
      }),
    });
    toast("Inspeção criada.");
    await openCard(currentCardId, "quality");
  } catch (error) { toast(error.message); }
}

function qualityInspectionHtml(q) {
  const isOpen = q.status === "ABERTA";
  const canOperate = canOperateQuality();
  const typeLabel = `Inspeção ${q.inspection_type}`;
  const modeLabel = q.purchase_mode === "SALDO" ? "Saldo — controle por quantidade geral" : "Grade — controle por item";
  const sampleLabel = q.sample_source === "RECEBIMENTO"
    ? `Amostra dos 10% separada e triada pelo Recebimento • ${modeLabel}`
    : `Nova amostra obrigatória de 10% separada pelo Recebimento após o retorno da Costura • ${modeLabel}`;
  return `<div class="panel-body">
    <div class="quality-header">
      <div class="notice ${q.inspection_type===2?"success-box":""}"><b>${typeLabel}</b>${q.inspection_type===1?` — destino <b>${esc(q.destination)}</b>`:""}<br>${sampleLabel}</div>
      ${q.development_warning ? '<div class="notice warn"><b>Atenção:</b> a separação de peças para o setor Desenvolvimento ainda está pendente. Este aviso não bloqueia a conclusão.</div>' : ''}
    </div>
    <div class="summary-grid quality-summary">
      <div class="summary-box"><span>Meta da amostra</span><strong>${q.totals.sample_target}</strong></div>
      <div class="summary-box"><span>Amostra definida</span><strong>${q.totals.sample_defined}</strong></div>
      <div class="summary-box"><span>Atribuída</span><strong>${q.totals.assigned}</strong></div>
      <div class="summary-box"><span>Inspecionada</span><strong>${q.totals.inspected}</strong></div>
      <div class="summary-box"><span>Disponível</span><strong>${q.totals.available}</strong></div>
      <div class="summary-box"><span>Aprovada</span><strong>${q.totals.approved}</strong></div>
      <div class="summary-box"><span>Rejeitada</span><strong>${q.totals.rejected}</strong></div>
      <div class="summary-box"><span>Retrabalho</span><strong>${q.totals.rework}</strong></div>
    </div>
    ${developmentQualityHtml(q, canOperate)}
    ${qualityPreviousInspectionsHtml(q)}
    ${qualitySampleHtml(q, isOpen, canOperate)}
    ${qualityAssignmentAreaHtml(q, isOpen, canOperate)}
    ${qualityWorkersHtml(q, isOpen)}
    <h3 class="section-heading">Conclusão geral da inspeção</h3>
    ${q.validation_errors.length ? `<div class="notice warn"><b>Pendências para concluir:</b><br>${q.validation_errors.slice(0,10).map(esc).join("<br>")}${q.validation_errors.length>10?"<br>…":""}</div>` : '<div class="notice success-box"><b>Todos os itens e quantidades da amostra estão fechados.</b></div>'}
    <div class="actions">
      ${isOpen && canOperate ? `<button class="success" ${q.completion_ready?"":"disabled"} onclick="completeQualityInspection()">Concluir inspeção</button>` : ''}
      ${!isOpen ? '<span class="badge green">Inspeção concluída</span>' : ''}
    </div>
  </div>`;
}

function qualityPreviousInspectionsHtml(q) {
  const rows = q.previous_inspections || [];
  if (!rows.length) return "";
  return `<h3 class="section-heading">Rodadas anteriores da Qualidade</h3><div class="table-wrap"><table>
    <thead><tr><th>Inspeção</th><th>Tipo</th><th>Destino</th><th>Amostra</th><th>Aprovada</th><th>Rejeitada</th><th>Retrabalho</th><th>Conclusão</th><th>Desenvolvimento</th></tr></thead>
    <tbody>${rows.map((row)=>`<tr><td>Inspeção ${row.inspection_type}</td><td>${row.purchase_mode==="SALDO"?"Saldo":"Grade"}</td><td>${esc(row.destination||"—")}</td><td>${row.sample_target_total}</td><td>${row.approved_total}</td><td>${row.rejected_total}</td><td>${row.rework_total}</td><td>${fmtDateTime(row.completed_at)}</td><td>${row.development_pending?'<span class="badge orange">Pendente</span>':'<span class="badge green">Regular</span>'}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function developmentQualityHtml(q, canOperate) {
  const requiredValue = q.development_required === null || q.development_required === undefined ? "" : String(q.development_required);
  const separatedValue = q.development_separated === null || q.development_separated === undefined ? "" : String(q.development_separated);
  if (!canOperate) {
    return `<h3 class="section-heading">Desenvolvimento</h3><div class="notice">Separação necessária: <b>${requiredValue==="1"?"Sim":requiredValue==="0"?"Não":"Não informado"}</b>${requiredValue==="1"?`<br>Peças separadas: <b>${separatedValue==="1"?"Sim":"Não"}</b>`:""}</div>`;
  }
  return `<h3 class="section-heading">Separação para Desenvolvimento</h3>
    <div class="form-grid">
      <div class="field"><label>É necessário separar peças?</label><select id="qualityDevRequired" onchange="toggleQualityDevelopmentEdit()"><option value="0" ${requiredValue==="0"?"selected":""}>Não</option><option value="1" ${requiredValue==="1"?"selected":""}>Sim</option></select></div>
      <div class="field" id="qualityDevSeparatedField" style="display:${requiredValue==="1"?"block":"none"}"><label>As peças já foram separadas?</label><select id="qualityDevSeparated"><option value="0" ${separatedValue!=="1"?"selected":""}>Não</option><option value="1" ${separatedValue==="1"?"selected":""}>Sim</option></select></div>
    </div><div class="actions"><button class="secondary" onclick="saveQualityDevelopment()">Atualizar Desenvolvimento</button></div>`;
}

function toggleQualityDevelopmentEdit() {
  if ($("qualityDevSeparatedField")) $("qualityDevSeparatedField").style.display = $("qualityDevRequired").value === "1" ? "block" : "none";
}

async function saveQualityDevelopment() {
  try {
    const required = $("qualityDevRequired").value === "1";
    await api(`/api/quality/inspections/${cardData.quality.id}/development`, {
      method: "PATCH",
      body: JSON.stringify({
        user_id: currentUser.id,
        development_required: required,
        development_separated: required ? $("qualityDevSeparated").value === "1" : null,
      }),
    });
    toast("Situação do Desenvolvimento atualizada.");
    await openCard(currentCardId, "quality");
  } catch (error) { toast(error.message); }
}

function qualitySampleHtml(q, isOpen, canOperate) {
  if (q.purchase_mode === "SALDO") {
    const row = q.sample_items[0];
    return `<h3 class="section-heading">Amostra automática — Saldo</h3>
      <div class="notice"><b>Quantidade geral:</b> não é necessário distribuir por produto, cor ou tamanho. A soma dos inspetores deve fechar ${q.totals.sample_target} peças.</div>
      <div class="summary-grid compact-summary">
        <div class="summary-box"><span>Amostra geral</span><strong>${row?.sample_qty ?? q.totals.sample_target}</strong></div>
        <div class="summary-box"><span>Atribuída</span><strong>${row?.assigned_total ?? 0}</strong></div>
        <div class="summary-box"><span>Disponível</span><strong>${row?.available_qty ?? q.totals.sample_target}</strong></div>
      </div>`;
  }
  return `<h3 class="section-heading">Amostra automática — Grade</h3>
    <div class="notice">A quantidade foi dividida automaticamente entre os itens. Quando os 10% eram menores que o número de itens, a amostra foi aumentada para garantir pelo menos uma peça de cada item.</div>
    <div class="table-wrap"><table><thead><tr><th>Produto</th><th>Referência/SKU</th><th>Cor</th><th>Tamanho</th><th>Qtd. compra</th><th>Amostra</th><th>Atribuída</th><th>Inspecionada</th><th>Disponível</th></tr></thead><tbody>
    ${q.sample_items.map((row)=>`<tr><td>${esc(row.product||"—")}</td><td>${esc(row.reference||row.sku||"—")}</td><td>${esc(row.color||"—")}</td><td>${esc(row.size||"—")}</td><td>${row.expected_qty}</td><td><b>${row.sample_qty}</b></td><td>${row.assigned_total}</td><td>${row.inspected_total}</td><td>${row.available_qty}</td></tr>`).join("") || '<tr><td colspan="9">A amostra ainda não foi definida.</td></tr>'}
    </tbody></table></div>`;
}

function qualityInspectorOptions(selectedId="") {
  return qualityUsers.map((u)=>`<option value="${u.id}" ${String(u.id)===String(selectedId)?"selected":""}>${esc(u.name)}</option>`).join("");
}

function qualityAssignmentAreaHtml(q, isOpen, canOperate) {
  if (!isOpen || !canOperate || !q.sample_items.length) return "";
  const availableRows = q.sample_items.filter((row)=>Number(row.available_qty)>0);
  if (!availableRows.length) return '<h3 class="section-heading">Atribuição rápida</h3><div class="notice success-box">Toda a amostra já foi atribuída.</div>';
  const supervisorMode = ["supervisor","admin"].includes(currentUser.role);
  return `<h3 class="section-heading">Atribuição rápida em lote</h3>
    <div class="notice"><b>Preencha várias linhas e confirme uma única vez.</b> O sistema reserva o item e a quantidade no mesmo salvamento.</div>
    <div class="bulk-toolbar">
      ${supervisorMode ? `<div class="field bulk-inspector"><label>Inspetor para todas as linhas</label><select id="qualityBatchInspector"><option value="">Selecione</option>${qualityInspectorOptions()}</select></div>` : `<div class="selected-inspector"><span>Inspetor</span><b>${esc(currentUser.name)}</b><input type="hidden" id="qualityBatchInspector" value="${currentUser.id}"></div>`}
      <div class="field bulk-search"><label>Pesquisar</label><input id="qualityAssignSearch" placeholder="Produto, SKU, cor ou tamanho" oninput="filterQualityAssignmentRows()"></div>
      <div class="actions compact-actions">
        <button class="secondary" onclick="selectAllQualityAvailable()">Selecionar disponíveis</button>
        <button class="secondary" onclick="fillQualityBalances()">Assumir saldos selecionados</button>
        <button class="ghost" onclick="clearQualityBatch()">Limpar</button>
      </div>
    </div>
    <div class="table-wrap"><table id="qualityBatchTable"><thead><tr><th class="check-col"><input type="checkbox" id="qualityBatchAll" onchange="toggleQualityBatchAll(this.checked)"></th><th>Item</th><th>Amostra</th><th>Já atribuída</th><th>Disponível</th><th>Quantidade a assumir</th><th>Ação rápida</th></tr></thead><tbody>
      ${availableRows.map((row)=>{
        const itemLabel = row.sample_scope==="GERAL" ? "Quantidade geral — Saldo" : `${row.product||"—"} • ${row.reference||row.sku||"—"} • ${row.color||"—"} • ${row.size||"—"}`;
        return `<tr class="quality-batch-row" data-search="${esc(itemLabel.toLowerCase())}" data-sample-id="${row.id}" data-available="${row.available_qty}">
          <td><input class="quality-batch-check" type="checkbox" id="qualityBatchCheck_${row.id}" onchange="syncQualityBatchRow(${row.id})"></td>
          <td><b>${esc(row.product||"—")}</b>${row.sample_scope==="GERAL"?"":`<br><small>${esc(row.reference||row.sku||"—")} • ${esc(row.color||"—")} • ${esc(row.size||"—")}</small>`}</td>
          <td>${row.sample_qty}</td><td>${row.assigned_total}</td><td><b>${row.available_qty}</b></td>
          <td><input class="table-input quality-batch-qty" id="qualityBatchQty_${row.id}" type="number" min="1" max="${row.available_qty}" placeholder="0" oninput="syncQualityBatchQty(${row.id})" onkeydown="qualityBatchKeydown(event,${row.id})"></td>
          <td><button class="primary small-btn" onclick="quickClaimQuality(${row.id},${row.available_qty})">Assumir agora</button></td>
        </tr>`;
      }).join("")}
    </tbody></table></div>
    <div class="bulk-footer"><div id="qualityBatchSummary">Nenhuma linha selecionada.</div><button class="primary" onclick="saveQualityAssignmentsBatch()">Confirmar atribuições selecionadas</button></div>`;
}

function visibleQualityBatchRows() {
  return [...document.querySelectorAll(".quality-batch-row")].filter((row)=>row.style.display!=="none");
}

function filterQualityAssignmentRows() {
  const term = ($("qualityAssignSearch")?.value || "").trim().toLowerCase();
  document.querySelectorAll(".quality-batch-row").forEach((row)=>{
    row.style.display = !term || (row.dataset.search||"").includes(term) ? "" : "none";
  });
}

function toggleQualityBatchAll(checked) {
  visibleQualityBatchRows().forEach((row)=>{
    const id=row.dataset.sampleId;
    const box=$(`qualityBatchCheck_${id}`);
    if (box) box.checked=checked;
  });
  updateQualityBatchSummary();
}

function selectAllQualityAvailable() {
  toggleQualityBatchAll(true);
}

function useQualityBalance(id) {
  const row=document.querySelector(`.quality-batch-row[data-sample-id="${id}"]`);
  if (!row) return;
  $(`qualityBatchCheck_${id}`).checked=true;
  $(`qualityBatchQty_${id}`).value=row.dataset.available;
  updateQualityBatchSummary();
}

function fillQualityBalances() {
  visibleQualityBatchRows().forEach((row)=>{
    const id=row.dataset.sampleId;
    if ($(`qualityBatchCheck_${id}`)?.checked) $(`qualityBatchQty_${id}`).value=row.dataset.available;
  });
  updateQualityBatchSummary();
}

function clearQualityBatch() {
  document.querySelectorAll(".quality-batch-check").forEach((box)=>box.checked=false);
  document.querySelectorAll(".quality-batch-qty").forEach((input)=>input.value="");
  if ($("qualityBatchAll")) $("qualityBatchAll").checked=false;
  updateQualityBatchSummary();
}

function syncQualityBatchRow(id) {
  const checked=$(`qualityBatchCheck_${id}`)?.checked;
  const input=$(`qualityBatchQty_${id}`);
  const row=document.querySelector(`.quality-batch-row[data-sample-id="${id}"]`);
  if (checked && input && !input.value) input.value=row?.dataset.available||"";
  updateQualityBatchSummary();
}

function syncQualityBatchQty(id) {
  const input=$(`qualityBatchQty_${id}`);
  if (input && Number(input.value)>0) $(`qualityBatchCheck_${id}`).checked=true;
  updateQualityBatchSummary();
}

function qualityBatchKeydown(event,id) {
  if (event.key!=="Enter") return;
  event.preventDefault();
  const rows=visibleQualityBatchRows();
  const index=rows.findIndex((row)=>String(row.dataset.sampleId)===String(id));
  const next=rows[index+1];
  if (next) $(`qualityBatchQty_${next.dataset.sampleId}`)?.focus();
}

function updateQualityBatchSummary() {
  let lines=0,total=0;
  document.querySelectorAll(".quality-batch-row").forEach((row)=>{
    const id=row.dataset.sampleId;
    if ($(`qualityBatchCheck_${id}`)?.checked) {
      lines+=1;
      total+=Number($(`qualityBatchQty_${id}`)?.value||0);
    }
  });
  if ($("qualityBatchSummary")) $("qualityBatchSummary").innerHTML = lines ? `<b>${lines}</b> linha(s) • <b>${total}</b> peça(s)` : "Nenhuma linha selecionada.";
}

async function saveQualityAssignmentsBatch() {
  try {
    const inspectorId=Number($("qualityBatchInspector")?.value||0);
    if (!inspectorId) throw new Error("Selecione o inspetor.");
    const assignments=[];
    document.querySelectorAll(".quality-batch-row").forEach((row)=>{
      const id=Number(row.dataset.sampleId);
      if ($(`qualityBatchCheck_${id}`)?.checked) {
        const qty=Number($(`qualityBatchQty_${id}`)?.value||0);
        if (qty>0) assignments.push({sample_item_id:id,assigned_qty:qty});
      }
    });
    await api(`/api/quality/inspections/${cardData.quality.id}/assignments/batch`,{
      method:"POST",
      body:JSON.stringify({user_id:currentUser.id,inspector_id:inspectorId,assignments}),
    });
    toast(`${assignments.length} atribuição(ões) salva(s) de uma vez.`);
    await openCard(currentCardId,"quality");
  } catch (error) { toast(error.message); }
}

async function quickClaimQuality(sampleId,qty){
  try{
    const inspectorId=currentUser.role==="qualidade"?currentUser.id:Number($("qualityBatchInspector")?.value||0);
    if(!inspectorId)throw new Error("Selecione o inspetor.");
    await api(`/api/quality/inspections/${cardData.quality.id}/assignments/batch`,{method:"POST",body:JSON.stringify({user_id:currentUser.id,inspector_id:inspectorId,assignments:[{sample_item_id:sampleId,assigned_qty:qty}]})});
    toast("Item assumido. A próxima linha já está disponível."); await openCard(currentCardId,"quality");
  }catch(e){toast(e.message)}
}

function qualityWorkersHtml(q, isOpen) {
  if (!q.workers.length) return '<h3 class="section-heading">Inspetores</h3><div class="notice">Nenhum item foi atribuído.</div>';
  return `<h3 class="section-heading">Inspetores e resultados individuais</h3>${q.workers.map((worker)=>qualityWorkerHtml(worker,isOpen)).join("")}`;
}

function qualityWorkerHtml(worker, isOpen) {
  const timer = worker.timer || {state:"NAO_INICIADA",business_seconds:0,paused_seconds:0,permanence_seconds:0};
  const canControlTimer = isOpen && (worker.inspector_id === currentUser.id || currentUser.role === "admin");
  const canEditResults = isOpen && (worker.inspector_id === currentUser.id || currentUser.role === "admin");
  const canManageAssignment = isOpen && (worker.inspector_id === currentUser.id || ["supervisor","admin"].includes(currentUser.role));
  return `<div class="quality-worker">
    <div class="quality-worker-head"><div><b>${esc(worker.inspector_name)}</b><br><span class="status-note">${worker.assignments.length} atribuição(ões)</span></div><span class="badge ${timer.state==="CONCLUIDA"?"green":timer.state==="PAUSADA"?"orange":timer.state==="EM_ANDAMENTO"?"purple":"gray"}">${esc(timer.state)}</span></div>
    <div class="timer-grid">
      <div class="timer-value"><span>Tempo útil</span><strong>${fmtSeconds(timer.business_seconds)}</strong></div>
      <div class="timer-value"><span>Tempo parado</span><strong>${fmtSeconds(timer.paused_seconds)}</strong></div>
      <div class="timer-value"><span>Permanência</span><strong>${fmtSeconds(timer.permanence_seconds)}</strong></div>
      <div class="timer-value"><span>Produção</span><strong>${worker.assignments.reduce((a,b)=>a+Number(b.inspected_qty||0),0)}</strong></div>
    </div>
    <div class="actions">
      ${canControlTimer && timer.state==="NAO_INICIADA"?`<button class="primary" onclick="qualityTimerAction(${worker.id},'start')">Iniciar inspeção</button>`:""}
      ${canControlTimer && timer.state==="EM_ANDAMENTO"?`<button class="warning" onclick="qualityTimerAction(${worker.id},'pause')">Pausar</button><button class="success" onclick="qualityTimerAction(${worker.id},'finish')">Finalizar minha inspeção</button>`:""}
      ${canControlTimer && timer.state==="PAUSADA"?`<button class="primary" onclick="qualityTimerAction(${worker.id},'resume')">Retomar</button><button class="success" onclick="qualityTimerAction(${worker.id},'finish')">Finalizar minha inspeção</button>`:""}
    </div>
    ${worker.assignments.map((a)=>qualityAssignmentResultHtml(a,worker,canEditResults,canManageAssignment)).join("")}
  </div>`;
}

function qualityAssignmentResultHtml(a, worker, canEdit, canManage) {
  const photos = a.photo_paths || [];
  return `<div class="quality-assignment">
    <div class="quality-assignment-title"><b>${esc(a.product||"—")} • ${esc(a.color||"—")} • ${esc(a.size||"—")}</b><span class="badge ${a.valid?"green":"orange"}">${a.assigned_qty} peças atribuídas</span></div>
    <div class="form-grid">
      <div class="field"><label>Quantidade inspecionada</label><input id="qaInspected_${a.id}" type="number" min="0" max="${a.assigned_qty}" value="${a.inspected_qty}" ${canEdit?"":"readonly"} oninput="recalcQualityAssignment(${a.id})"></div>
      <div class="field"><label>Quantidade rejeitada</label><input id="qaRejected_${a.id}" type="number" min="0" value="${a.rejected_qty}" ${canEdit?"":"readonly"} oninput="recalcQualityAssignment(${a.id})"></div>
      <div class="field"><label>Quantidade para retrabalho</label><input id="qaRework_${a.id}" type="number" min="0" value="${a.rework_qty}" ${canEdit?"":"readonly"} oninput="recalcQualityAssignment(${a.id})"></div>
      <div class="field"><label>Quantidade aprovada</label><input id="qaApproved_${a.id}" class="readonly" readonly value="${a.approved_qty}"></div>
      <div class="field"><label>Motivo da rejeição</label><input id="qaRejectReason_${a.id}" value="${esc(a.reject_reason||"")}" ${canEdit?"":"readonly"}></div>
      <div class="field"><label>Motivo do retrabalho</label><input id="qaReworkReason_${a.id}" value="${esc(a.rework_reason||"")}" ${canEdit?"":"readonly"}></div>
      <div class="field full"><label>Observação obrigatória quando houver rejeição ou retrabalho</label><textarea id="qaObservation_${a.id}" ${canEdit?"":"readonly"}>${esc(a.observation||"")}</textarea></div>
    </div>
    <div class="photos">${photos.map((p,i)=>`<a class="photo-link" target="_blank" href="${p}">Evidência ${i+1}</a>`).join("")}</div>
    ${a.validation_errors?.length?`<div class="notice warn">${a.validation_errors.map(esc).join("<br>")}</div>`:""}
    <div class="actions">
      ${canEdit?`<button class="success" onclick="qualityAllApproved(${a.id},${a.assigned_qty})">Tudo aprovado</button><button class="secondary" onclick="saveQualityResult(${a.id})">Salvar resultado</button><label class="primary small-btn" style="cursor:pointer">Adicionar evidências<input id="qaFiles_${a.id}" type="file" multiple hidden onchange="uploadQualityAssignmentPhotos(${a.id})"></label>`:""}
      ${canManage && worker.status==="NAO_INICIADA"?`<button class="danger small-btn" onclick="releaseQualityAssignment(${a.id})">Devolver atribuição</button>`:""}
      ${canManage && Number(a.inspected_qty||0)===0?`<select id="qaTransferTo_${a.id}"><option value="">Transferir para...</option>${qualityInspectorOptions()}</select><input id="qaTransferReason_${a.id}" placeholder="Motivo da transferência"><button class="warning small-btn" onclick="transferQualityAssignment(${a.id})">Transferir</button>`:""}
    </div>
  </div>`;
}

async function qualityAllApproved(id,qty){
  $(`qaInspected_${id}`).value=qty;$(`qaRejected_${id}`).value=0;$(`qaRework_${id}`).value=0;recalcQualityAssignment(id);
  await saveQualityResult(id);
}

function recalcQualityAssignment(id) {
  const inspected=Number($(`qaInspected_${id}`)?.value||0), rejected=Number($(`qaRejected_${id}`)?.value||0), rework=Number($(`qaRework_${id}`)?.value||0);
  if ($(`qaApproved_${id}`)) $(`qaApproved_${id}`).value = Math.max(0, inspected-rejected-rework);
}

function qualityAssignmentPayload(id, photosOverride=null) {
  const worker = cardData.quality.workers.find((w)=>w.assignments.some((a)=>a.id===id));
  const assignment = worker?.assignments.find((a)=>a.id===id);
  return {
    user_id: currentUser.id,
    inspected_qty: Number($(`qaInspected_${id}`).value||0),
    rejected_qty: Number($(`qaRejected_${id}`).value||0),
    rework_qty: Number($(`qaRework_${id}`).value||0),
    reject_reason: $(`qaRejectReason_${id}`).value,
    rework_reason: $(`qaReworkReason_${id}`).value,
    observation: $(`qaObservation_${id}`).value,
    photo_paths: photosOverride || assignment?.photo_paths || [],
  };
}

async function saveQualityResult(id, photosOverride=null) {
  try {
    await api(`/api/quality/assignments/${id}/result`, { method:"PATCH", body:JSON.stringify(qualityAssignmentPayload(id,photosOverride)) });
    toast("Resultado salvo.");
    await openCard(currentCardId,"quality");
  } catch (error) { toast(error.message); }
}

async function uploadQualityAssignmentPhotos(id) {
  try {
    const files = Array.from($(`qaFiles_${id}`).files||[]);
    if (!files.length) return;
    const form=new FormData(); files.forEach((f)=>form.append("files",f));
    const uploaded=await api("/api/uploads",{method:"POST",body:form});
    const worker=cardData.quality.workers.find((w)=>w.assignments.some((a)=>a.id===id));
    const assignment=worker.assignments.find((a)=>a.id===id);
    await saveQualityResult(id,[...(assignment.photo_paths||[]),...uploaded.paths]);
  } catch (error) { toast(error.message); }
}

async function qualityTimerAction(workerId, action) {
  try {
    await api(`/api/quality/workers/${workerId}/timer/${action}`, {method:"POST",body:JSON.stringify({user_id:currentUser.id})});
    toast("Tempo da inspeção atualizado.");
    await openCard(currentCardId,"quality");
  } catch (error) { toast(error.message); }
}

async function releaseQualityAssignment(id) {
  if (!confirm("Devolver este item e quantidade para a disponibilidade?")) return;
  try {
    await api(`/api/quality/assignments/${id}/release`,{method:"POST",body:JSON.stringify({user_id:currentUser.id})});
    toast("Atribuição devolvida.");
    await openCard(currentCardId,"quality");
  } catch (error) { toast(error.message); }
}

async function transferQualityAssignment(id) {
  try {
    await api(`/api/quality/assignments/${id}/transfer`,{method:"POST",body:JSON.stringify({user_id:currentUser.id,to_user_id:Number($(`qaTransferTo_${id}`).value||0),reason:$(`qaTransferReason_${id}`).value})});
    toast("Atribuição transferida.");
    await openCard(currentCardId,"quality");
  } catch (error) { toast(error.message); }
}

async function completeQualityInspection() {
  const q=cardData.quality;
  let confirmPending=false;
  if (q.development_warning) {
    confirmPending=confirm("Existem peças pendentes de separação para o setor Desenvolvimento. Deseja concluir a inspeção mesmo assim?");
    if (!confirmPending) return;
  } else if (!confirm("Concluir definitivamente esta inspeção e movimentar o Card?")) return;
  try {
    await api(`/api/quality/inspections/${q.id}/complete`,{method:"POST",body:JSON.stringify({user_id:currentUser.id,confirm_development_pending:confirmPending})});
    toast("Inspeção concluída e Card movimentado.");
    await openCard(currentCardId,"quality");
  } catch (error) { toast(error.message); }
}


async function renderProcessingTab() {
  activateTab("tabProcessingBtn");
  try {
    if (!processingUsers.length) processingUsers = await api("/api/processing/users");
  } catch (error) {
    $("cardTab").innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
    return;
  }
  const p = cardData.processing;
  const importedProcessingItems = (cardData.items||[]).filter((item)=>["AGUARDANDO_PROCESSAMENTO","PROCESSAMENTO"].includes(item.source_stage));
  if (cardData.source_snapshot_at && !p && cardData.current_sector !== "PROCESSAMENTO") {
    if (importedProcessingItems.length && canOperateProcessing()) {
      $("cardTab").innerHTML = processingSetupHtml(importedProcessingItems);
      toggleProcessingLabelField();
    } else {
      renderImportedSectorSnapshot("tabProcessingBtn",["AGUARDANDO_PROCESSAMENTO","PROCESSAMENTO"],"Itens localizados no Processamento");
      if (importedProcessingItems.length) {
        $("cardTab").insertAdjacentHTML("afterbegin",'<div class="notice warn"><b>Para produzir:</b> saia deste perfil e entre como operador do Processamento, Supervisor ou Administrador.</div>');
      }
    }
    return;
  }
  if (cardData.current_sector === "PROCESSAMENTO" && !p) {
    if (!canOperateProcessing()) {
      $("cardTab").innerHTML = '<div class="panel-body"><div class="notice warn">Aguardando um operador do Processamento configurar o Card.</div></div>';
      return;
    }
    $("cardTab").innerHTML = processingSetupHtml();
    toggleProcessingLabelField();
    return;
  }
  if (!p) {
    $("cardTab").innerHTML = '<div class="panel-body"><div class="notice">Este Card ainda não possui dados do Processamento.</div></div>';
    return;
  }
  $("cardTab").innerHTML = processingDetailHtml(p);
  toggleProcessingLabelField();
}

function processingSetupHtml(importedItems=[]) {
  const modeLabel = cardData.purchase_mode === "GRADE" ? "Grade — importado como Private Label" : cardData.purchase_mode === "SALDO" ? "Saldo" : "Tipo não reconhecido";
  const imported = importedItems.length > 0;
  const importedQty = importedItems.reduce((sum,item)=>sum+Number(item.expected_qty||0),0);
  const importedPicker = !imported ? "" : cardData.purchase_mode === "GRADE" ? `
    <div class="notice success-box"><b>Selecione os tamanhos que entrarão nesta produção.</b><br>Somente os itens posicionados em Aguardando Processamento serão movimentados. Os demais permanecem nos setores atuais.</div>
    <div class="table-wrap compact-picker"><table class="compact-table"><thead><tr><th class="check-col"><input id="processingImportedAll" type="checkbox" checked onchange="toggleImportedProcessingItems(this.checked)"></th><th>Produto</th><th>Cor</th><th>Tamanho</th><th>Quantidade</th></tr></thead><tbody>
      ${importedItems.map((item)=>`<tr><td><input class="processing-import-item" type="checkbox" value="${item.id}" checked onchange="updateImportedProcessingSummary()"></td><td><b>${esc(item.product||'—')}</b><small>${esc(item.reference||item.sku||'')}</small></td><td>${esc(item.color||'—')}</td><td><span class="size-token">${esc(item.size||'—')}</span></td><td><b>${item.expected_qty}</b></td></tr>`).join("")}
    </tbody></table></div><div id="processingImportedSummary" class="queue-counter"><b>${importedItems.length}</b> tamanho(s) • <b>${importedQty}</b> peça(s) selecionada(s)</div>` : `
    <div class="notice success-box"><b>Saldo disponível para produção</b><br>${importedItems.length} linha(s), total de ${importedQty} peça(s). O apontamento continuará por quantidade geral.</div>`;
  return `<div class="panel-body">
    <div class="notice"><b>Configuração inicial do Processamento</b><br>O tipo da compra vem automaticamente do Excel e não pode ser alterado neste setor.${imported ? " O Card-mãe continuará no Recebimento porque esta compra possui itens em etapas diferentes." : ""}</div>
    ${importedPicker}
    <div class="form-grid">
      <div class="field"><label>Tipo da compra</label><input class="readonly" readonly value="${esc(modeLabel)}"></div>
      <div class="field"><label>Marca</label><input id="processingBrand" value="${esc(cardData.brand||"")}" placeholder="Informe a marca"></div>
      <div class="field"><label>Perfil da compra</label><select id="processingProfile"><option value="">Selecione</option><option value="CADASTRO_ENTRADA">Cadastro + Entrada</option><option value="SOMENTE_ENTRADA">Somente Entrada</option></select></div>
      <div class="field"><label>Necessita Triagem?</label><select id="processingNeedsTriage"><option value="">Selecione</option><option value="1">Sim</option><option value="0">Não</option></select></div>
      <div class="field"><label>Necessita Etiquetagem?</label><select id="processingNeedsLabeling" onchange="toggleProcessingLabelField()"><option value="">Selecione</option><option value="1">Sim</option><option value="0">Não</option></select></div>
      <div class="field" id="processingLabelTypeField" style="display:none"><label>Tipo de etiqueta</label><select id="processingLabelType"><option value="">Selecione</option><option value="BRANCA">Branca — descrição, EAN e valor</option><option value="VERMELHA">Vermelha — valor</option><option value="PERSONALIZADA">Personalizada</option></select></div>
      ${cardData.purchase_mode === "GRADE" ? `<div class="field full"><label class="check-line"><input id="processingDeferQty" type="checkbox"> A quantidade final da Grade será confirmada somente na Estocagem</label></div>` : ""}
      <div class="field full"><label>Observações</label><textarea id="processingNotes"></textarea></div>
    </div>
    <div class="actions"><button class="primary" onclick="createProcessing()">Configurar Processamento</button></div>
  </div>`;
}

function toggleProcessingLabelField() {
  const visible = $("processingNeedsLabeling")?.value === "1";
  if ($("processingLabelTypeField")) $("processingLabelTypeField").style.display = visible ? "block" : "none";
}

async function createProcessing() {
  try {
    const triage = $("processingNeedsTriage").value;
    const labeling = $("processingNeedsLabeling").value;
    const importedChecks = [...document.querySelectorAll(".processing-import-item")];
    const itemIds = importedChecks.filter((input)=>input.checked).map((input)=>Number(input.value));
    if (importedChecks.length && !itemIds.length) throw new Error("Selecione pelo menos um tamanho para produzir.");
    await api(`/api/cards/${currentCardId}/processing`, {
      method: "POST",
      body: JSON.stringify({
        user_id: currentUser.id,
        brand: $("processingBrand").value,
        operation_profile: $("processingProfile").value,
        needs_triage: triage === "" ? null : triage === "1",
        needs_labeling: labeling === "" ? null : labeling === "1",
        label_type: $("processingLabelType")?.value || null,
        quantity_deferred_to_storage: Boolean($("processingDeferQty")?.checked),
        notes: $("processingNotes").value,
        item_ids: itemIds,
      }),
    });
    toast("Processamento configurado.");
    await openCard(currentCardId, "processing");
  } catch (error) { toast(error.message); }
}

function toggleImportedProcessingItems(checked){document.querySelectorAll(".processing-import-item").forEach((input)=>input.checked=checked);updateImportedProcessingSummary();}
function updateImportedProcessingSummary(){const selected=[...document.querySelectorAll(".processing-import-item:checked")];const ids=new Set(selected.map((input)=>Number(input.value)));const items=(cardData.items||[]).filter((item)=>ids.has(item.id));const qty=items.reduce((sum,item)=>sum+Number(item.expected_qty||0),0);if($("processingImportedSummary"))$("processingImportedSummary").innerHTML=`<b>${items.length}</b> tamanho(s) • <b>${qty}</b> peça(s) selecionada(s)`;if($("processingImportedAll"))$("processingImportedAll").checked=selected.length===document.querySelectorAll(".processing-import-item").length;}

function processingDetailHtml(p) {
  const isOpen = p.status === "ABERTO";
  const canOperate = canOperateProcessing();
  const modeLabel = p.purchase_mode === "GRADE" ? "Grade" : "Saldo";
  const routeLabel = p.needs_triage ? "Triagem" : p.needs_labeling ? "Etiquetagem" : "Estocagem";
  return `<div class="panel-body">
    <div class="notice ${p.status === "CONCLUIDO" ? "success-box" : ""}"><b>Processamento ${p.status === "CONCLUIDO" ? "concluído" : "aberto"}</b><br>Tipo: <b>${modeLabel}</b> • Próximo destino configurado: <b>${routeLabel}</b></div>
    <div class="summary-grid processing-summary">
      <div class="summary-box"><span>Quantidade prevista</span><strong>${p.totals.expected}</strong></div>
      <div class="summary-box"><span>Quantidade processada</span><strong>${p.totals.processed}</strong></div>
      <div class="summary-box"><span>Quantidade estocada</span><strong>${p.totals.stored}</strong></div>
      <div class="summary-box"><span>Produção apontada</span><strong>${p.totals.worker_production}</strong></div>
      <div class="summary-box"><span>Tipo</span><strong>${modeLabel}</strong></div>
      <div class="summary-box"><span>Marca</span><strong>${esc(p.brand)}</strong></div>
    </div>
    ${processingConfigurationHtml(p, isOpen && canOperate)}
    ${processingWorkersHtml(p, isOpen)}
    ${processingQuantitiesHtml(p, isOpen && canOperate)}
    <h3 class="section-heading">Conclusão do Processamento</h3>
    ${p.validation_errors?.length ? `<div class="notice warn"><b>Pendências:</b><br>${p.validation_errors.map(esc).join("<br>")}</div>` : '<div class="notice success-box"><b>Processamento pronto para conclusão.</b></div>'}
    <div class="actions">
      ${isOpen && canOperate ? `<button class="success" ${p.validation_errors?.length ? "disabled" : ""} onclick="completeProcessing()">Concluir Processamento</button>` : ""}
      ${!isOpen ? '<span class="badge green">Processamento concluído</span>' : ""}
    </div>
  </div>`;
}

function processingConfigurationHtml(p, editable) {
  const profileLabel = p.operation_profile === "CADASTRO_ENTRADA" ? "Cadastro + Entrada" : "Somente Entrada";
  if (!editable) {
    return `<h3 class="section-heading">Configuração</h3><div class="form-grid">
      <div class="field"><label>Marca</label><input class="readonly" readonly value="${esc(p.brand)}"></div>
      <div class="field"><label>Perfil</label><input class="readonly" readonly value="${esc(profileLabel)}"></div>
      <div class="field"><label>Triagem</label><input class="readonly" readonly value="${p.needs_triage ? "Sim" : "Não"}"></div>
      <div class="field"><label>Etiquetagem</label><input class="readonly" readonly value="${p.needs_labeling ? "Sim" : "Não"}"></div>
      <div class="field"><label>Tipo de etiqueta</label><input class="readonly" readonly value="${esc(p.label_type||"Não se aplica")}"></div>
      <div class="field"><label>Quantidade da Grade</label><input class="readonly" readonly value="${p.quantity_deferred_to_storage ? "Confirmar na Estocagem" : "Informada no Processamento"}"></div>
    </div>`;
  }
  return `<h3 class="section-heading">Configuração</h3><div class="form-grid">
    <div class="field"><label>Tipo da compra</label><input class="readonly" readonly value="${p.purchase_mode === "GRADE" ? "Grade" : "Saldo"}"></div>
    <div class="field"><label>Marca</label><input id="processingBrand" value="${esc(p.brand)}"></div>
    <div class="field"><label>Perfil da compra</label><select id="processingProfile"><option value="CADASTRO_ENTRADA" ${p.operation_profile === "CADASTRO_ENTRADA" ? "selected" : ""}>Cadastro + Entrada</option><option value="SOMENTE_ENTRADA" ${p.operation_profile === "SOMENTE_ENTRADA" ? "selected" : ""}>Somente Entrada</option></select></div>
    <div class="field"><label>Necessita Triagem?</label><select id="processingNeedsTriage"><option value="1" ${p.needs_triage ? "selected" : ""}>Sim</option><option value="0" ${!p.needs_triage ? "selected" : ""}>Não</option></select></div>
    <div class="field"><label>Necessita Etiquetagem?</label><select id="processingNeedsLabeling" onchange="toggleProcessingLabelField()"><option value="1" ${p.needs_labeling ? "selected" : ""}>Sim</option><option value="0" ${!p.needs_labeling ? "selected" : ""}>Não</option></select></div>
    <div class="field" id="processingLabelTypeField" style="display:${p.needs_labeling ? "block" : "none"}"><label>Tipo de etiqueta</label><select id="processingLabelType"><option value="BRANCA" ${p.label_type === "BRANCA" ? "selected" : ""}>Branca</option><option value="VERMELHA" ${p.label_type === "VERMELHA" ? "selected" : ""}>Vermelha</option><option value="PERSONALIZADA" ${p.label_type === "PERSONALIZADA" ? "selected" : ""}>Personalizada</option></select></div>
    ${p.purchase_mode === "GRADE" ? `<div class="field full"><label class="check-line"><input id="processingDeferQty" type="checkbox" ${p.quantity_deferred_to_storage ? "checked" : ""}> A quantidade final da Grade será confirmada somente na Estocagem</label></div>` : ""}
    <div class="field full"><label>Observações</label><textarea id="processingNotes">${esc(p.notes||"")}</textarea></div>
  </div><div class="actions"><button class="secondary" onclick="saveProcessingConfiguration()">Salvar configuração</button></div>`;
}

async function saveProcessingConfiguration() {
  try {
    const p = cardData.processing;
    await api(`/api/processing/${p.id}/configuration`, {
      method: "PATCH",
      body: JSON.stringify({
        user_id: currentUser.id,
        brand: $("processingBrand").value,
        operation_profile: $("processingProfile").value,
        needs_triage: $("processingNeedsTriage").value === "1",
        needs_labeling: $("processingNeedsLabeling").value === "1",
        label_type: $("processingLabelType")?.value || null,
        quantity_deferred_to_storage: Boolean($("processingDeferQty")?.checked),
        notes: $("processingNotes").value,
      }),
    });
    toast("Configuração atualizada.");
    await openCard(currentCardId, "processing");
  } catch (error) { toast(error.message); }
}

function processingUserOptions(selected="") {
  return processingUsers.map((u) => `<option value="${u.id}" ${String(u.id)===String(selected)?"selected":""}>${esc(u.name)}</option>`).join("");
}

function processingWorkersHtml(p, isOpen) {
  const currentAlready = p.workers.some((w) => w.user_id === currentUser.id);
  const addArea = isOpen && canOperateProcessing() ? `<div class="bulk-toolbar processing-worker-add">
    ${currentUser.role === "processamento" ? `<div class="selected-inspector"><span>Operador</span><b>${esc(currentUser.name)}</b></div><button class="primary" ${currentAlready ? "disabled" : ""} onclick="addProcessingWorker(${currentUser.id})">Assumir Card</button>` : `<div class="field"><label>Adicionar colaborador</label><select id="processingWorkerSelect"><option value="">Selecione</option>${processingUserOptions()}</select></div><button class="primary" onclick="addProcessingWorker(Number($(\"processingWorkerSelect\").value||0))">Adicionar</button>`}
  </div>` : "";
  return `<h3 class="section-heading">Colaboradores e produção</h3>${addArea}${p.workers.length ? p.workers.map((w)=>processingWorkerHtml(w,isOpen)).join("") : '<div class="notice">Nenhum colaborador assumiu o Card.</div>'}`;
}

function processingWorkerHtml(w, isOpen) {
  const timer = w.timer || {state:"NAO_INICIADA",business_seconds:0,paused_seconds:0,permanence_seconds:0};
  const canControl = isOpen && (w.user_id === currentUser.id || currentUser.role === "admin");
  const canEdit = isOpen && (w.user_id === currentUser.id || ["supervisor","admin"].includes(currentUser.role));
  return `<div class="processing-worker">
    <div class="quality-worker-head"><div><b>${esc(w.user_name)}</b><br><span class="status-note">Produção individual</span></div><span class="badge ${timer.state === "CONCLUIDA" ? "green" : timer.state === "PAUSADA" ? "orange" : timer.state === "EM_ANDAMENTO" ? "purple" : "gray"}">${esc(timer.state)}</span></div>
    <div class="timer-grid">
      <div class="timer-value"><span>Tempo útil</span><strong>${fmtSeconds(timer.business_seconds)}</strong></div>
      <div class="timer-value"><span>Tempo parado</span><strong>${fmtSeconds(timer.paused_seconds)}</strong></div>
      <div class="timer-value"><span>Permanência</span><strong>${fmtSeconds(timer.permanence_seconds)}</strong></div>
      <div class="timer-value"><span>Produção</span><strong>${w.produced_qty}</strong></div>
    </div>
    <div class="form-grid" style="margin-top:10px"><div class="field"><label>Quantidade produzida por este colaborador</label><input id="processingWorkerQty_${w.id}" type="number" min="0" value="${w.produced_qty}" ${canEdit ? "" : "readonly"}></div></div>
    <div class="actions">
      ${canEdit ? `<button class="secondary" onclick="saveProcessingWorkerProduction(${w.id})">Salvar produção</button>` : ""}
      ${canControl && timer.state === "NAO_INICIADA" ? `<button class="primary" onclick="processingTimerAction(${w.id},'start')">Iniciar</button>` : ""}
      ${canControl && timer.state === "EM_ANDAMENTO" ? `<button class="warning" onclick="processingTimerAction(${w.id},'pause')">Pausar</button><button class="success" onclick="processingTimerAction(${w.id},'finish')">Finalizar</button>` : ""}
      ${canControl && timer.state === "PAUSADA" ? `<button class="primary" onclick="processingTimerAction(${w.id},'resume')">Retomar</button><button class="success" onclick="processingTimerAction(${w.id},'finish')">Finalizar</button>` : ""}
    </div>
  </div>`;
}

async function addProcessingWorker(userId) {
  if (!userId) return toast("Selecione o colaborador.");
  try {
    await api(`/api/processing/${cardData.processing.id}/workers`, {method:"POST",body:JSON.stringify({user_id:currentUser.id,worker_user_id:userId})});
    toast("Colaborador incluído.");
    await openCard(currentCardId,"processing");
  } catch (error) { toast(error.message); }
}

async function saveProcessingWorkerProduction(workerId) {
  try {
    await api(`/api/processing/workers/${workerId}/production`, {method:"PATCH",body:JSON.stringify({user_id:currentUser.id,produced_qty:Number($(`processingWorkerQty_${workerId}`).value||0)})});
    toast("Produção salva.");
    await openCard(currentCardId,"processing");
  } catch (error) { toast(error.message); }
}

async function processingTimerAction(workerId, action) {
  try {
    await api(`/api/processing/workers/${workerId}/timer/${action}`, {method:"POST",body:JSON.stringify({user_id:currentUser.id})});
    toast("Cronômetro atualizado.");
    await openCard(currentCardId,"processing");
  } catch (error) { toast(error.message); }
}

function processingQuantitiesHtml(p, editable) {
  const copyButton = `<button class="ghost" ${p.totals.stored > 0 && editable ? "" : "disabled"} onclick="copyStoredToProcessed()">Copiar Estocada → Processada</button>`;
  if (p.purchase_mode === "SALDO") {
    return `<h3 class="section-heading">Quantidades — Saldo</h3><div class="notice">Para compras Saldo, o controle é feito somente pela quantidade geral.</div>
      <div class="form-grid"><div class="field"><label>Quantidade prevista</label><input class="readonly" readonly value="${p.totals.expected}"></div><div class="field"><label>Quantidade processada</label><input id="processingGeneralQty" type="number" min="0" value="${p.processed_qty_general}" ${editable ? "" : "readonly"}></div><div class="field"><label>Quantidade estocada</label><input class="readonly" readonly value="${p.stored_qty_general}"></div></div>
      <div class="actions">${editable ? '<button class="primary" onclick="saveProcessingQuantities()">Salvar quantidade</button>' : ""}${copyButton}</div>`;
  }
  const deferredNotice = p.quantity_deferred_to_storage ? '<div class="notice warn">A quantidade final desta Grade será confirmada na Estocagem. É permitido concluir o Processamento sem preencher todos os itens.</div>' : '<div class="notice">Informe a quantidade processada por item da Grade.</div>';
  return `<h3 class="section-heading">Quantidades — Grade</h3>${deferredNotice}<div class="table-wrap"><table>
    <thead><tr><th>Produto</th><th>Referência / SKU</th><th>Cor</th><th>Tamanho</th><th>Prevista</th><th>Processada</th><th>Estocada</th></tr></thead>
    <tbody>${p.items.map((item)=>`<tr><td>${esc(item.product||"—")}</td><td>${esc(item.reference||item.sku||"—")}</td><td>${esc(item.color||"—")}</td><td>${esc(item.size||"—")}</td><td>${item.expected_qty}</td><td><input class="table-input processing-item-qty" data-item-id="${item.item_id}" type="number" min="0" value="${item.processed_qty}" ${editable ? "" : "readonly"}></td><td>${item.stored_qty}</td></tr>`).join("")}</tbody>
  </table></div><div class="actions">${editable ? '<button class="primary" onclick="saveProcessingQuantities()">Salvar quantidades da Grade</button>' : ""}${copyButton}</div>`;
}

async function saveProcessingQuantities() {
  try {
    const p = cardData.processing;
    const payload = {user_id:currentUser.id};
    if (p.purchase_mode === "SALDO") payload.processed_qty_general = Number($("processingGeneralQty").value||0);
    else payload.items = [...document.querySelectorAll(".processing-item-qty")].map((input)=>({item_id:Number(input.dataset.itemId),processed_qty:Number(input.value||0)}));
    await api(`/api/processing/${p.id}/quantities`, {method:"PATCH",body:JSON.stringify(payload)});
    toast("Quantidades salvas.");
    await openCard(currentCardId,"processing");
  } catch (error) { toast(error.message); }
}

async function copyStoredToProcessed() {
  try {
    await api(`/api/processing/${cardData.processing.id}/copy-stored`, {method:"POST",body:JSON.stringify({user_id:currentUser.id})});
    toast("Quantidade estocada copiada para processada.");
    await openCard(currentCardId,"processing");
  } catch (error) { toast(error.message); }
}

async function completeProcessing() {
  if (!confirm("Concluir o Processamento e movimentar o Card para o próximo setor configurado?")) return;
  try {
    await api(`/api/processing/${cardData.processing.id}/complete`, {method:"POST",body:JSON.stringify({user_id:currentUser.id})});
    toast("Processamento concluído.");
    await openCard(currentCardId,"processing");
  } catch (error) { toast(error.message); }
}

async function renderDownstreamTab(sector) {
  const key=sector==="ETIQUETAGEM"?"labeling":"storage", tabId=sector==="ETIQUETAGEM"?"tabLabelingBtn":"tabStorageBtn";
  activateTab(tabId);
  try { if(!downstreamUsers[sector].length) downstreamUsers[sector]=await api(`/api/downstream/users?sector=${sector}`); } catch(e){$("cardTab").innerHTML=`<div class="notice error">${esc(e.message)}</div>`;return;}
  let op=cardData[key];
  const allowed=[sector.toLowerCase(),"supervisor","admin"].includes(currentUser.role);
  const importedItems=(cardData.items||[]).filter((item)=>item.source_stage===sector);
  if(!op?.id){
    if(cardData.source_snapshot_at&&cardData.current_sector!==sector&&!importedItems.length){renderImportedSectorSnapshot(tabId,[sector],`Itens localizados em ${sector==="ETIQUETAGEM"?"Etiquetagem":"Estocagem"}`);return;}
    $("cardTab").innerHTML=`<div class="panel-body"><div class="notice"><b>${sector==="ETIQUETAGEM"?"Etiquetagem":"Estocagem"}</b><br>${cardData.purchase_mode==="GRADE"?"Cada colaborador assume um tamanho completo por vez.":"Saldo é dividido por quantidade geral, sem separar tamanhos."}${importedItems.length?`<br><b>${importedItems.length}</b> item(ns) disponível(is) nesta etapa; os demais itens da compra não serão alterados.`:""}</div>${allowed?`<div class="actions"><button class="primary" onclick="startDownstream('${sector}')">Iniciar controle</button></div>`:'<div class="notice warn">Entre com um perfil deste setor, Supervisor ou Administrador para iniciar.</div>'}</div>`; return;
  }
  const grade=op.purchase_mode==="GRADE", open=op.status==="ABERTO";
  $("cardTab").innerHTML=`<div class="panel-body downstream-panel">
    <div class="notice success-box"><b>${sector==="ETIQUETAGEM"?"Etiquetagem":"Estocagem"} • ${grade?"Grade":"Saldo"}</b><br>${grade?"Escolha e assuma somente um tamanho por vez. Tamanhos já assumidos ficam indisponíveis.":"Informe quantas peças deseja assumir do saldo geral disponível."}</div>
    <div class="summary-grid compact-summary"><div class="summary-box"><span>Prevista</span><strong>${op.totals.expected}</strong></div><div class="summary-box"><span>Assumida</span><strong>${op.totals.assigned}</strong></div><div class="summary-box"><span>Concluída</span><strong>${op.totals.completed}</strong></div><div class="summary-box"><span>Disponível</span><strong>${op.totals.available}</strong></div></div>
    ${open&&allowed?(grade?downstreamGradePicker(op,sector):downstreamSaldoPicker(op,sector)):""}
    <h3 class="section-heading">Em execução</h3>${op.assignments.length?op.assignments.map(a=>downstreamAssignmentHtml(a,sector,allowed&&open)).join(""):'<div class="notice">Nenhum material assumido.</div>'}
    <div class="actions"><button class="success" ${op.totals.completed===op.totals.expected&&open&&allowed?"":"disabled"} onclick="completeDownstream(${op.id},'${sector}')">Concluir ${sector==="ETIQUETAGEM"?"Etiquetagem":"Estocagem"}</button></div></div>`;
}

function downstreamWorkerSelect(sector){
  if([sector.toLowerCase()].includes(currentUser.role)) return `<input type="hidden" id="downstreamWorker" value="${currentUser.id}"><div class="selected-inspector"><span>Colaborador</span><b>${esc(currentUser.name)}</b></div>`;
  return `<div class="field"><label>Colaborador</label><select id="downstreamWorker"><option value="">Selecione</option>${downstreamUsers[sector].map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></div>`;
}
function downstreamGradePicker(op,sector){
  const free=op.items.filter(i=>Number(i.assigned_qty)===0&&Number(i.expected_qty)>0);
  return `<h3 class="section-heading">Assumir próximo tamanho</h3><div class="downstream-picker">${downstreamWorkerSelect(sector)}<div class="queue-search"><span>⌕</span><input id="downstreamSizeSearch" placeholder="Produto, cor ou tamanho" oninput="filterDownstreamSizes()"></div></div>
    <div class="table-wrap compact-picker"><table class="compact-table"><thead><tr><th>Produto</th><th>Cor</th><th>Tamanho</th><th>Quantidade</th><th></th></tr></thead><tbody>${free.map(i=>`<tr class="downstream-size-row" data-search="${esc([i.product,i.reference,i.color,i.size].join(' ').toLowerCase())}"><td><b>${esc(i.product||'—')}</b><small>${esc(i.reference||i.sku||'—')}</small></td><td>${esc(i.color||'—')}</td><td><span class="size-token">${esc(i.size||'—')}</span></td><td><b>${i.expected_qty}</b></td><td><button class="primary small-btn" onclick="claimDownstream(${op.id},'${sector}',${i.item_id},${i.expected_qty})">Assumir tamanho</button></td></tr>`).join("")||'<tr><td colspan="5">Todos os tamanhos foram assumidos.</td></tr>'}</tbody></table></div>`;
}
function downstreamSaldoPicker(op,sector){return `<h3 class="section-heading">Assumir quantidade do Saldo</h3><div class="downstream-picker saldo-picker">${downstreamWorkerSelect(sector)}<div class="field"><label>Quantidade disponível: ${op.totals.available}</label><input id="downstreamSaldoQty" type="number" min="1" max="${op.totals.available}" placeholder="Quantidade"></div><button class="primary" onclick="claimDownstream(${op.id},'${sector}',null,Number($(\"downstreamSaldoQty\").value||0))">Assumir quantidade</button></div>`;}
function filterDownstreamSizes(){const t=normalizeSearch($("downstreamSizeSearch")?.value||"");document.querySelectorAll(".downstream-size-row").forEach(r=>r.classList.toggle("hidden",t&&!normalizeSearch(r.dataset.search).includes(t)));}
function downstreamAssignmentHtml(a,sector,allowed){const own=a.worker_user_id===currentUser.id||["supervisor","admin"].includes(currentUser.role);return `<div class="assignment-strip"><div><b>${esc(a.product||"Saldo geral")}</b><small>${a.item_id?`${esc(a.color||'—')} • Tam. ${esc(a.size||'—')}`:"Controle por quantidade"}</small></div><div><span>Colaborador</span><b>${esc(a.worker_name)}</b></div><div><span>Assumida</span><b>${a.assigned_qty}</b></div><div class="assignment-result"><span>Concluída</span><input id="downstreamDone_${a.id}" type="number" min="0" max="${a.assigned_qty}" value="${a.completed_qty}" ${allowed&&own?"":"readonly"}></div><div><span>Tempo</span><b>${fmtSeconds(a.elapsed_seconds)}</b><small>${esc(a.timer_state)}</small></div><div class="actions">${allowed&&own?`<button class="secondary small-btn" onclick="saveDownstreamResult(${a.id},'${sector}')">Salvar</button>${a.timer_state==="NAO_INICIADA"?`<button class="primary small-btn" onclick="downstreamTimer(${a.id},'start','${sector}')">Iniciar</button>`:""}${a.timer_state==="EM_ANDAMENTO"?`<button class="warning small-btn" onclick="downstreamTimer(${a.id},'pause','${sector}')">Pausar</button><button class="success small-btn" onclick="downstreamTimer(${a.id},'finish','${sector}')">Finalizar</button>`:""}${a.timer_state==="PAUSADA"?`<button class="primary small-btn" onclick="downstreamTimer(${a.id},'resume','${sector}')">Retomar</button><button class="success small-btn" onclick="downstreamTimer(${a.id},'finish','${sector}')">Finalizar</button>`:""}`:""}</div></div>`;}
async function startDownstream(sector){try{await api(`/api/cards/${currentCardId}/downstream/${sector}`,{method:"POST",body:JSON.stringify({user_id:currentUser.id})});await openCard(currentCardId,sector==="ETIQUETAGEM"?"labeling":"storage");}catch(e){toast(e.message)}}
async function claimDownstream(opId,sector,itemId,qty){try{const worker=Number($("downstreamWorker")?.value||0);if(!worker)throw new Error("Selecione o colaborador.");await api(`/api/downstream/${opId}/claim`,{method:"POST",body:JSON.stringify({user_id:currentUser.id,worker_user_id:worker,item_id:itemId,qty})});toast("Material assumido.");await openCard(currentCardId,sector==="ETIQUETAGEM"?"labeling":"storage");}catch(e){toast(e.message)}}
async function saveDownstreamResult(id,sector){try{await api(`/api/downstream/assignments/${id}`,{method:"PATCH",body:JSON.stringify({user_id:currentUser.id,completed_qty:Number($(`downstreamDone_${id}`).value||0)})});toast("Quantidade salva.");await openCard(currentCardId,sector==="ETIQUETAGEM"?"labeling":"storage");}catch(e){toast(e.message)}}
async function downstreamTimer(id,action,sector){try{await api(`/api/downstream/assignments/${id}/timer/${action}`,{method:"POST",body:JSON.stringify({user_id:currentUser.id})});await openCard(currentCardId,sector==="ETIQUETAGEM"?"labeling":"storage");}catch(e){toast(e.message)}}
async function completeDownstream(id,sector){try{await api(`/api/downstream/${id}/complete`,{method:"POST",body:JSON.stringify({user_id:currentUser.id})});toast("Etapa concluída.");closeModal();goTo(sector==="ETIQUETAGEM"?"labeling":"storage");}catch(e){toast(e.message)}}


function refreshTimerDisplay() {
  if (!cardData?.receiving?.timer) return;
  const timer = cardData.receiving.timer;
  if (timer.state !== "EM_ANDAMENTO" && timer.state !== "PAUSADA") return;
  let baseUseful = Number(timer.business_seconds || 0);
  let basePaused = Number(timer.paused_seconds || 0);
  let basePermanence = Number(timer.permanence_seconds || 0);
  const started = Date.now();
  clearInterval(window.receivingTimerInterval);
  window.receivingTimerInterval = setInterval(() => {
    if (!$("timerPermanence")) return clearInterval(window.receivingTimerInterval);
    const elapsed = Math.floor((Date.now()-started)/1000);
    $("timerPermanence").textContent = fmtSeconds(basePermanence + elapsed);
    if (timer.state === "PAUSADA") $("timerPaused").textContent = fmtSeconds(basePaused + elapsed);
  },1000);
}

function closeModal() {
  clearInterval(window.receivingTimerInterval);
  $("modal").classList.add("hidden");
  currentCardId = null;
  cardData = null;
  goTo(currentView);
}

function statusBadge(value) {
  const v=String(value||"").toUpperCase();
  const cls=v.includes("CONCL")||v==="OK"||v==="DISPONIVEL"?"green":v.includes("DIVER")||v.includes("BLOQ")?"red":v.includes("ANDAMENTO")||v.includes("OCUPADO")?"purple":"orange";
  return `<span class="badge ${cls}">${esc(String(value||"—").replaceAll("_"," "))}</span>`;
}

const WAREHOUSE_PAGE_SIZE = 200;
let warehouseVisibleCount = WAREHOUSE_PAGE_SIZE;

async function renderWarehouse() {
  setPage("Mapa e Capacidade", "Endereçamento físico, ocupação e guarda das mercadorias");
  const data=await api("/api/unified/warehouse"); unifiedCache.warehouse=data;
  warehouseVisibleCount = WAREHOUSE_PAGE_SIZE;
  $("mainContent").innerHTML=`
    ${moduleTabs([["Visão geral","storage-hub"],["Fila operacional","storage"],["Mapa de casulos","warehouse"],["Mapa de Calor","warehouse-heatmap"],["Estatísticas","stock-stats"],["Simulador","capacity-simulator"]],"warehouse")}
    <div class="zone-grid">${data.zones.map(z=>`<div class="zone-card"><div><small>Zona ${esc(z.code)}</small><b>${esc(z.name)}</b></div><strong>${z.occupancy}%</strong><div class="capacity-track"><i style="width:${Math.min(100,z.occupancy)}%"></i></div><span>${Number(z.occupied).toLocaleString("pt-BR")} / ${Number(z.capacity).toLocaleString("pt-BR")} peças</span></div>`).join("")}</div>
    <div class="panel"><div class="panel-header">Endereços do centro de distribuição <button class="primary small-btn" onclick="showStoreForm()">+ Guardar mercadoria</button></div>
      <div class="panel-body compact-filter"><div class="queue-search"><span>⌕</span><input id="warehouseSearch" placeholder="Endereço, categoria ou estrutura" oninput="filterWarehouseRows()"></div><select id="warehouseZone" onchange="filterWarehouseRows()"><option value="">Todas as zonas</option>${data.zones.map(z=>`<option>${esc(z.code)}</option>`).join("")}</select></div>
      <div id="storeForm" class="panel-body hidden"></div>
      <div class="table-wrap warehouse-table"><table class="compact-table"><thead><tr><th>Endereço</th><th>Zona</th><th>Estrutura</th><th>Categoria</th><th>Ocupação</th><th>Disponível</th><th>Status</th></tr></thead><tbody id="warehouseTableBody"></tbody></table></div>
      <div id="warehousePager" class="panel-body warehouse-pager"></div>
    </div>`;
  renderWarehouseRows();
}

function warehouseRowHtml(location){return `<tr class="warehouse-row"><td><b>${esc(location.address)}</b></td><td>${esc(location.zone_code)}</td><td>${esc(location.structure_type||"—")}</td><td>${esc(location.category||"Livre")}</td><td><div class="inline-capacity"><i style="width:${Math.min(100,location.occupancy)}%"></i></div><small>${location.occupied_qty}/${location.capacity} • ${location.occupancy}%</small></td><td><b>${Math.max(0,location.capacity-location.occupied_qty)}</b></td><td>${statusBadge(location.status)}</td></tr>`;}

function renderWarehouseRows(){
  const data=unifiedCache.warehouse;if(!data)return;
  const term=normalizeSearch($("warehouseSearch")?.value||""),zone=$("warehouseZone")?.value||"";
  const filtered=data.locations.filter(location=>(!zone||location.zone_code===zone)&&(!term||normalizeSearch([location.address,location.category,location.structure_type].join(" ")).includes(term)));
  const visible=filtered.slice(0,warehouseVisibleCount),remaining=filtered.length-visible.length;
  $("warehouseTableBody").innerHTML=visible.length?visible.map(warehouseRowHtml).join(""):'<tr><td colspan="7" class="empty-cell">Nenhum casulo encontrado.</td></tr>';
  $("warehousePager").innerHTML=`<span>Mostrando ${visible.length.toLocaleString("pt-BR")} de ${filtered.length.toLocaleString("pt-BR")} casulos</span>${remaining>0?`<button class="secondary small-btn" onclick="loadMoreWarehouseRows()">Carregar mais ${Math.min(remaining,WAREHOUSE_PAGE_SIZE).toLocaleString("pt-BR")}</button>`:""}`;
}
function loadMoreWarehouseRows(){warehouseVisibleCount+=WAREHOUSE_PAGE_SIZE;renderWarehouseRows();}
function filterWarehouseRows(){warehouseVisibleCount=WAREHOUSE_PAGE_SIZE;renderWarehouseRows();}

function heatmapColor(percentage){
  if(percentage>=90)return "#d92d20";
  if(percentage>=60)return "#e98b08";
  if(percentage>=25)return "#f5c400";
  if(percentage>0)return "#16803c";
  return "#2a3646";
}

async function renderWarehouseHeatmap(){
  setPage("Mapa de Calor","Ocupação por Rua e coluna");
  const data=await api("/api/unified/warehouse/heatmap");
  const sideBlock=(columns,title)=>`<div class="heatmap-side"><div class="heatmap-side-title">${title}</div><div class="heatmap-grid">${columns.map(column=>`<div class="heatmap-box" style="background:${heatmapColor(column.ocupacao_pct)}" title="Coluna ${column.coluna} — ${column.ocupado}/${column.capacidade} peças (${column.ocupacao_pct}%)">${column.coluna}</div>`).join("")||'<span class="empty-visual">Sem posições</span>'}</div></div>`;
  const streets=(data.ruas||[]).map(street=>{
    const odd=street.colunas.filter(column=>column.secao==="impar").sort((a,b)=>a.coluna-b.coluna);
    const even=street.colunas.filter(column=>column.secao==="par").sort((a,b)=>a.coluna-b.coluna);
    const sequential=street.colunas.filter(column=>column.secao==="sequencial").sort((a,b)=>a.coluna-b.coluna);
    return `<section class="panel heatmap-street"><div class="panel-header">${esc(street.rua)} <small>${street.colunas.length} colunas</small></div><div class="panel-body"><div class="heatmap-sides">${sideBlock(odd,"◀ Lado ímpar")}${sideBlock(even,"Lado par ▶")}</div>${sequential.length?`<div class="heatmap-sequential"><div class="heatmap-side-title">Trecho sequencial</div><div class="heatmap-grid">${sequential.map(column=>`<div class="heatmap-box" style="background:${heatmapColor(column.ocupacao_pct)}" title="Coluna ${column.coluna} — ${column.ocupado}/${column.capacidade} peças (${column.ocupacao_pct}%)">${column.coluna}</div>`).join("")}</div></div>`:""}</div></section>`;
  }).join("");
  $("mainContent").innerHTML=`${moduleTabs([["Visão geral","storage-hub"],["Fila operacional","storage"],["Mapa de casulos","warehouse"],["Mapa de Calor","warehouse-heatmap"],["Estatísticas","stock-stats"],["Simulador","capacity-simulator"]],"warehouse-heatmap")}<div class="heatmap-legend"><span><i style="background:#2a3646"></i>Vazio</span><span><i style="background:#16803c"></i>Baixa</span><span><i style="background:#f5c400"></i>Média</span><span><i style="background:#e98b08"></i>Alta</span><span><i style="background:#d92d20"></i>Quase cheio</span></div>${streets||'<div class="empty-visual">Nenhum casulo cadastrado.</div>'}`;
}

function showStoreForm(){const data=unifiedCache.warehouse;const free=data.locations.filter(l=>l.status!=="BLOQUEADO"&&l.occupied_qty<l.capacity);$("storeForm").classList.remove("hidden");$("storeForm").innerHTML=`<div class="inline-form"><div class="field"><label>Endereço</label><select id="storeLocation"><option value="">Selecione</option>${free.map(l=>`<option value="${l.id}">${esc(l.address)} • livre ${l.capacity-l.occupied_qty}</option>`).join("")}</select></div><div class="field"><label>ID do Card</label><input id="storeCard" type="number" placeholder="Opcional"></div><div class="field"><label>Quantidade</label><input id="storeQty" type="number" min="1"></div><div class="field"><label>Marca / categoria</label><input id="storeBrand" placeholder="Marca ou grupo"></div><button class="success" onclick="storeMaterial()">Confirmar guarda</button></div>`;}
async function storeMaterial(){try{await api("/api/unified/warehouse/store",{method:"POST",body:JSON.stringify({user_id:currentUser.id,location_id:Number($("storeLocation").value),card_id:Number($("storeCard").value||0),quantity:Number($("storeQty").value),brand:$("storeBrand").value,category:$("storeBrand").value})});toast("Mercadoria guardada e capacidade atualizada.");renderWarehouse();}catch(e){toast(e.message)}}

async function renderSgo(){setPage("SGO e Entradas","Previsão de compras e distribuição de serviço por setor");const rows=await api("/api/unified/sgo");unifiedCache.sgo=rows;const counts=Object.fromEntries(["EM_TRANSITO","QUALIDADE","PROCESSAMENTO","ESTOCAGEM","CONCLUIDO"].map(s=>[s,rows.filter(r=>r.status===s).length]));$("mainContent").innerHTML=`<div class="kpi-grid compact-kpis">${Object.entries(counts).map(([s,n])=>`<div class="kpi"><div class="kpi-label">${s.replaceAll('_',' ')}</div><div class="kpi-value">${n}</div></div>`).join("")}</div><div class="panel" style="margin-top:14px"><div class="panel-header">Relatório SGO <button class="primary small-btn" onclick="document.getElementById('sgoFile').click()">Importar Excel</button><input id="sgoFile" class="hidden" type="file" accept=".xlsx,.xlsm" onchange="importSgo(this)"></div><div class="panel-body"><div class="queue-search"><span>⌕</span><input id="sgoSearch" placeholder="Compra, grupo, descrição ou marca" oninput="filterSgoRows()"></div></div><div class="table-wrap"><table class="compact-table"><thead><tr><th>Compra</th><th>Grupo / descrição</th><th>Marca</th><th>Quantidade</th><th>Previsão</th><th>Etapa</th><th>Ação</th></tr></thead><tbody>${rows.map(r=>`<tr class="sgo-row" data-search="${esc(normalizeSearch([r.purchase_id,r.group_name,r.description,r.brand].join(' ')))}"><td><b>${esc(r.purchase_id||'—')}</b><small>${esc(r.origin||'')}</small></td><td><b>${esc(r.group_name||'—')}</b><small>${esc(r.description||'')}</small></td><td>${esc(r.brand||'—')}</td><td><b>${r.quantity}</b></td><td>${esc(r.forecast_date||'—')}</td><td>${statusBadge(r.status)}</td><td><button class="secondary small-btn" onclick="createSgoTask(${r.id},'${r.status}')">Criar tarefa</button></td></tr>`).join("")||'<tr><td colspan="7">Importe um relatório SGO para iniciar.</td></tr>'}</tbody></table></div></div>`;}
function filterSgoRows(){const t=normalizeSearch($("sgoSearch")?.value||"");document.querySelectorAll(".sgo-row").forEach(r=>r.classList.toggle("hidden",t&&!r.dataset.search.includes(t)));}
async function importSgo(input){if(!input.files?.[0])return;const form=new FormData();form.append("file",input.files[0]);try{const d=await api(`/api/unified/sgo/import?user_id=${currentUser.id}`,{method:"POST",body:form});toast(`${d.rows} entradas SGO importadas.`);renderSgo();}catch(e){toast(e.message)}}
async function createSgoTask(id,status){const sector=prompt("Setor da tarefa:",status||"RECEBIMENTO");if(!sector)return;try{await api(`/api/unified/sgo/${id}/task`,{method:"POST",body:JSON.stringify({user_id:currentUser.id,sector})});toast("Tarefa criada.");}catch(e){toast(e.message)}}

async function renderTasks(){setPage("Tarefas Operacionais","Responsáveis, prioridades e andamento por setor");const rows=await api("/api/unified/tasks");unifiedCache.tasks=rows;const cols=["PENDENTE","EM_ANDAMENTO","CONCLUIDA"];$("mainContent").innerHTML=`<div class="tasks-toolbar"><button class="primary" onclick="showTaskForm()">+ Nova tarefa</button><select id="taskSectorFilter" onchange="filterTaskCards()"><option value="">Todos os setores</option>${[...new Set(rows.map(r=>r.sector))].map(s=>`<option>${esc(s)}</option>`).join("")}</select></div><div id="taskForm" class="panel hidden"></div><div class="task-board">${cols.map(status=>`<section><h3>${status.replaceAll('_',' ')} <span>${rows.filter(r=>r.status===status).length}</span></h3>${rows.filter(r=>r.status===status).map(t=>taskCard(t)).join("")||'<div class="empty-column">Nenhuma tarefa</div>'}</section>`).join("")}</div>`;}
function taskCard(t){return `<article class="task-card" data-sector="${esc(t.sector)}"><div><span class="priority ${String(t.priority).toLowerCase()}">${esc(t.priority)}</span><small>${esc(t.sector)}</small></div><h4>${esc(t.title)}</h4><p>${esc(t.description||'Sem descrição')}</p><footer><span>${esc(t.responsible_name||'Não atribuída')}</span>${t.status!=="CONCLUIDA"?`<button class="small-btn ${t.status==='PENDENTE'?'primary':'success'}" onclick="advanceTask(${t.id},'${t.status==='PENDENTE'?'EM_ANDAMENTO':'CONCLUIDA'}')">${t.status==='PENDENTE'?'Iniciar':'Concluir'}</button>`:''}</footer></article>`;}
function filterTaskCards(){const s=$("taskSectorFilter").value;document.querySelectorAll(".task-card").forEach(c=>c.classList.toggle("hidden",s&&c.dataset.sector!==s));}
function showTaskForm(){$("taskForm").classList.remove("hidden");$("taskForm").innerHTML=`<div class="panel-body inline-form"><div class="field"><label>Título</label><input id="taskTitle"></div><div class="field"><label>Setor</label><select id="taskSector">${["RECEBIMENTO","QUALIDADE","PROCESSAMENTO","ETIQUETAGEM","ESTOCAGEM","EXPEDICAO","DEVOLUCOES"].map(s=>`<option>${s}</option>`).join("")}</select></div><div class="field"><label>Prioridade</label><select id="taskPriority"><option>NORMAL</option><option>ALTA</option><option>URGENTE</option></select></div><div class="field grow"><label>Descrição</label><input id="taskDescription"></div><button class="primary" onclick="createTask()">Criar tarefa</button></div>`;}
async function createTask(){try{await api("/api/unified/tasks",{method:"POST",body:JSON.stringify({user_id:currentUser.id,title:$("taskTitle").value,sector:$("taskSector").value,priority:$("taskPriority").value,description:$("taskDescription").value})});toast("Tarefa criada.");renderTasks();}catch(e){toast(e.message)}}
async function advanceTask(id,status){try{await api(`/api/unified/tasks/${id}`,{method:"PATCH",body:JSON.stringify({user_id:currentUser.id,status})});renderTasks();}catch(e){toast(e.message)}}

async function renderShipping(){
  setPage("Expedição","Preenchimento, conferência e liberação da saída");
  const rows=await api("/api/unified/shipments");unifiedCache.shipments=rows;
  const allowed=["expedicao","estocagem","supervisor","admin"].includes(currentUser.role);
  const preparing=rows.filter(s=>s.status!=="EXPEDIDO"&&s.status!=="PRONTO").length;
  const ready=rows.filter(s=>s.status==="PRONTO").length;
  const shipped=rows.filter(s=>s.status==="EXPEDIDO").length;
  const checked=rows.reduce((a,s)=>a+Number(s.checked_qty||0),0),total=rows.reduce((a,s)=>a+Number(s.total_qty||0),0);
  $("mainContent").innerHTML=`
    <div class="kpi-grid compact-kpis shipping-kpis">
      <div class="kpi"><div class="kpi-label">Em preenchimento</div><div class="kpi-value">${preparing}</div><div class="kpi-hint">Romaneios</div></div>
      <div class="kpi"><div class="kpi-label">Prontos para saída</div><div class="kpi-value">${ready}</div><div class="kpi-hint">Conferidos</div></div>
      <div class="kpi"><div class="kpi-label">Expedidos</div><div class="kpi-value">${shipped}</div><div class="kpi-hint">Concluídos</div></div>
      <div class="kpi"><div class="kpi-label">Conferência geral</div><div class="kpi-value">${total?Math.round(checked*100/total):0}%</div><div class="kpi-hint">${checked.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} peças</div></div>
    </div>
    <div class="panel shipping-panel">
      <div class="panel-header"><span>Controle de romaneios</span><div>${allowed?`<button class="ghost small-btn" onclick="document.getElementById('shipmentPdf').click()">Importar PDF</button> <button class="primary small-btn" onclick="showShipmentForm()">+ Novo romaneio</button><input id="shipmentPdf" class="hidden" type="file" accept=".pdf" onchange="importShipmentPdf(this)">`:''}</div></div>
      <div class="panel-body shipping-toolbar"><div class="queue-search"><span>⌕</span><input id="shipmentSearch" placeholder="Romaneio, destino, transportadora, placa ou motorista" oninput="filterShipmentRows()"></div><select id="shipmentStatus" onchange="filterShipmentRows()"><option value="">Todos os status</option><option>RASCUNHO</option><option>PREPARANDO</option><option>EM_CONFERENCIA</option><option>PRONTO</option><option>EXPEDIDO</option></select></div>
      <div id="shipmentForm" class="panel-body hidden"></div>
      <div class="table-wrap"><table class="compact-table"><thead><tr><th>Documento</th><th>Destino / transporte</th><th>Conferência</th><th>Volumes</th><th>Saída prevista</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map(s=>{const pct=s.total_qty?Math.min(100,Math.round(Number(s.checked_qty||0)*100/s.total_qty)):0;return `<tr class="shipment-row" data-status="${esc(s.status)}" data-search="${esc(normalizeSearch([s.document_no,s.destination,s.carrier,s.vehicle_plate,s.driver_name].join(' ')))}"><td><button class="link-button" onclick="openShipment(${s.id})"><b>${esc(s.document_no)}</b></button><small>${s.item_count||0} item(ns)</small></td><td><b>${esc(s.destination||'Pendente')}</b><small>${esc(s.carrier||'Transportadora não informada')} ${s.vehicle_plate?`• ${esc(s.vehicle_plate)}`:''}</small></td><td><div class="shipping-progress"><i style="width:${pct}%"></i></div><small>${Number(s.checked_qty||0).toLocaleString('pt-BR')} / ${Number(s.total_qty||0).toLocaleString('pt-BR')} peças • ${pct}%</small></td><td>${Number(s.volume_count||0)||'—'}</td><td>${s.scheduled_at?fmtDateTime(s.scheduled_at):'—'}</td><td>${statusBadge(s.status)}</td><td><button class="secondary small-btn" onclick="openShipment(${s.id})">Preencher</button></td></tr>`}).join("")||'<tr><td colspan="7">Nenhum romaneio cadastrado.</td></tr>'}
      </tbody></table></div>
    </div>`;
}
function filterShipmentRows(){const term=normalizeSearch($("shipmentSearch")?.value||""),status=$("shipmentStatus")?.value||"";document.querySelectorAll(".shipment-row").forEach(row=>row.classList.toggle("hidden",(term&&!row.dataset.search.includes(term))||(status&&row.dataset.status!==status)));}
function showShipmentForm(){
  $("shipmentForm").classList.remove("hidden");
  $("shipmentForm").innerHTML=`<div class="shipping-form-title"><div><b>Novo romaneio</b><span>Preencha os dados conhecidos agora; o restante pode ser concluído depois.</span></div><button class="ghost small-btn" onclick="$('shipmentForm').classList.add('hidden')">Fechar</button></div>
    <div class="shipping-form-grid"><div class="field"><label>Número do romaneio *</label><input id="shipDoc"></div><div class="field"><label>Destino</label><input id="shipDest"></div><div class="field"><label>Transportadora</label><input id="shipCarrier"></div><div class="field"><label>Placa</label><input id="shipPlate" maxlength="10"></div><div class="field"><label>Motorista</label><input id="shipDriver"></div><div class="field"><label>Saída prevista</label><input id="shipScheduled" type="datetime-local"></div><div class="field"><label>Volumes</label><input id="shipVolumes" type="number" min="0"></div><div class="field grow"><label>Observações</label><input id="shipNotes"></div></div>
    <div class="shipping-items-head"><b>Itens do romaneio</b><button class="secondary small-btn" onclick="addShipmentItemRow()">+ Adicionar item</button></div><div id="shipmentNewItems"></div><div class="actions"><button class="primary" onclick="createShipment()">Salvar romaneio</button></div>`;
  addShipmentItemRow();
}
function addShipmentItemRow(barcode="",description="",quantity=""){$("shipmentNewItems").insertAdjacentHTML("beforeend",`<div class="shipment-new-item"><div class="field"><label>Código de barras</label><input data-field="barcode" value="${esc(barcode)}"></div><div class="field grow"><label>Descrição</label><input data-field="description" value="${esc(description)}"></div><div class="field"><label>Quantidade *</label><input data-field="quantity" type="number" min="1" value="${esc(quantity)}"></div><button class="danger small-btn" onclick="this.parentElement.remove()">Remover</button></div>`);}
async function createShipment(){try{const items=[...document.querySelectorAll(".shipment-new-item")].map(row=>({barcode:row.querySelector('[data-field=barcode]').value,description:row.querySelector('[data-field=description]').value,quantity:Number(row.querySelector('[data-field=quantity]').value||0)})).filter(i=>i.quantity>0);const d=await api("/api/unified/shipments",{method:"POST",body:JSON.stringify({user_id:currentUser.id,document_no:$("shipDoc").value,destination:$("shipDest").value,carrier:$("shipCarrier").value,vehicle_plate:$("shipPlate").value,driver_name:$("shipDriver").value,scheduled_at:$("shipScheduled").value,volume_count:Number($("shipVolumes").value||0),notes:$("shipNotes").value,items})});toast("Romaneio salvo. Continue a conferência.");await renderShipping();openShipment(d.shipment_id);}catch(e){toast(e.message)}}
async function importShipmentPdf(input){if(!input.files?.[0])return;const form=new FormData();form.append("file",input.files[0]);try{const d=await api(`/api/unified/shipments/import-pdf?user_id=${currentUser.id}`,{method:"POST",body:form});toast(`${d.document_no}: ${d.total_qty} peças reconhecidas.`);renderShipping();}catch(e){toast(e.message)}}
async function openShipment(id){try{const d=await api(`/api/unified/shipments/${id}`),s=d.shipment;const allowed=["expedicao","estocagem","supervisor","admin"].includes(currentUser.role)&&s.status!=="EXPEDIDO";const pct=s.total_qty?Math.min(100,Math.round(Number(s.checked_qty||0)*100/s.total_qty)):0;const missing=[["Destino",s.destination],["Transportadora",s.carrier],["Placa",s.vehicle_plate],["Motorista",s.driver_name],["Saída prevista",s.scheduled_at],["Volumes",s.volume_count]].filter(([,v])=>!v).map(([k])=>k);$("modalBody").innerHTML=`<div class="card-title"><div><h2>Romaneio ${esc(s.document_no)}</h2><div class="card-subtitle">Preenchimento e conferência da Expedição</div></div>${statusBadge(s.status)}</div><div class="shipping-completion"><div><span>Progresso da conferência</span><b>${pct}%</b></div><div class="shipping-progress large"><i style="width:${pct}%"></i></div><small>${Number(s.checked_qty||0).toLocaleString('pt-BR')} de ${Number(s.total_qty||0).toLocaleString('pt-BR')} peças conferidas</small></div>${missing.length?`<div class="notice warn"><b>Faltam dados obrigatórios:</b> ${missing.join(', ')}.</div>`:'<div class="notice success-box"><b>Dados do transporte completos.</b></div>'}<div class="shipping-form-grid"><div class="field"><label>Romaneio *</label><input id="shipEditDoc" value="${esc(s.document_no||'')}" ${allowed?'':'readonly'}></div><div class="field"><label>Destino *</label><input id="shipEditDest" value="${esc(s.destination||'')}" ${allowed?'':'readonly'}></div><div class="field"><label>Transportadora *</label><input id="shipEditCarrier" value="${esc(s.carrier||'')}" ${allowed?'':'readonly'}></div><div class="field"><label>Placa *</label><input id="shipEditPlate" value="${esc(s.vehicle_plate||'')}" ${allowed?'':'readonly'}></div><div class="field"><label>Motorista *</label><input id="shipEditDriver" value="${esc(s.driver_name||'')}" ${allowed?'':'readonly'}></div><div class="field"><label>Saída prevista *</label><input id="shipEditScheduled" type="datetime-local" value="${esc((s.scheduled_at||'').slice(0,16))}" ${allowed?'':'readonly'}></div><div class="field"><label>Volumes *</label><input id="shipEditVolumes" type="number" min="1" value="${Number(s.volume_count||0)||''}" ${allowed?'':'readonly'}></div><div class="field grow"><label>Observações</label><input id="shipEditNotes" value="${esc(s.notes||'')}" ${allowed?'':'readonly'}></div></div><h3 class="section-heading">Conferência por item</h3><div class="table-wrap shipping-items"><table class="compact-table"><thead><tr><th>Código</th><th>Descrição</th><th>Prevista</th><th>Conferida</th><th>Pendente</th><th>Observação</th></tr></thead><tbody>${d.items.map(i=>`<tr class="shipment-edit-item" data-id="${i.id}"><td>${esc(i.barcode||'—')}</td><td><b>${esc(i.description||'Item sem descrição')}</b></td><td>${i.quantity}</td><td><input class="table-input" data-field="checked" type="number" min="0" max="${i.quantity}" value="${i.checked_qty}" ${allowed?'':'readonly'}></td><td><b class="${i.quantity-i.checked_qty?'text-danger':'text-success'}">${i.quantity-i.checked_qty}</b></td><td><input data-field="notes" value="${esc(i.notes||'')}" ${allowed?'':'readonly'}></td></tr>`).join('')||'<tr><td colspan="6">Nenhum item informado.</td></tr>'}</tbody></table></div>${allowed?`<div class="actions"><button class="primary" onclick="saveShipmentFilling(${id})">Salvar preenchimento</button>${s.status==='PRONTO'?`<button class="success" onclick="finishShipment(${id})">Confirmar saída</button>`:''}</div>`:''}`;$("modal").classList.remove("hidden");}catch(e){toast(e.message)}}
async function saveShipmentFilling(id){try{const items=[...document.querySelectorAll('.shipment-edit-item')].map(row=>({id:Number(row.dataset.id),checked_qty:Number(row.querySelector('[data-field=checked]').value||0),notes:row.querySelector('[data-field=notes]').value}));const d=await api(`/api/unified/shipments/${id}/filling`,{method:'PATCH',body:JSON.stringify({user_id:currentUser.id,document_no:$("shipEditDoc").value,destination:$("shipEditDest").value,carrier:$("shipEditCarrier").value,vehicle_plate:$("shipEditPlate").value,driver_name:$("shipEditDriver").value,scheduled_at:$("shipEditScheduled").value,volume_count:Number($("shipEditVolumes").value||0),notes:$("shipEditNotes").value,items})});toast(d.status==='PRONTO'?'Conferência completa. Romaneio liberado para saída.':'Preenchimento salvo. Ainda existem pendências.');await renderShipping();openShipment(id);}catch(e){toast(e.message)}}
async function finishShipment(id){try{await api(`/api/unified/shipments/${id}`,{method:"PATCH",body:JSON.stringify({user_id:currentUser.id,status:"EXPEDIDO"})});closeModal();toast("Saída confirmada e romaneio concluído.");renderShipping();}catch(e){toast(e.message)}}

async function renderReturns(){setPage("Devoluções","Conferência Loja × CD × Anápolis, pendências e tratativas");const rows=await api("/api/unified/returns");unifiedCache.returns=rows;const open=rows.filter(r=>r.status!=="CONCLUIDA");$("mainContent").innerHTML=`<div class="kpi-grid compact-kpis"><div class="kpi"><div class="kpi-label">Registradas</div><div class="kpi-value">${rows.length}</div></div><div class="kpi"><div class="kpi-label">Abertas</div><div class="kpi-value">${open.length}</div></div><div class="kpi"><div class="kpi-label">Divergentes</div><div class="kpi-value">${rows.filter(r=>r.status==='DIVERGENTE').length}</div></div><div class="kpi"><div class="kpi-label">Peças em Anápolis</div><div class="kpi-value">${rows.reduce((a,r)=>a+Number(r.total_anapolis||0),0)}</div></div></div><div class="panel" style="margin-top:14px"><div class="panel-header"><span>Devoluções</span><div><button class="ghost small-btn" onclick="showReturnPdfForm()">Comparar PDFs</button> <button class="primary small-btn" onclick="showReturnForm()">+ Registrar devolução</button></div></div><div id="returnForm" class="panel-body hidden"></div><div class="table-wrap"><table><thead><tr><th>Documento</th><th>Loja / cliente</th><th>Loja</th><th>CD</th><th>Anápolis</th><th>Diferença</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="link-button" onclick="openReturn(${r.id})"><b>${esc(r.document_no)}</b></button></td><td>${esc(r.store||r.customer||'—')}</td><td>${r.total_store}</td><td>${r.total_cd}</td><td>${r.total_anapolis}</td><td><b class="${r.difference?'text-danger':''}">${r.difference}</b></td><td>${statusBadge(r.status)}</td><td>${r.status!=="CONCLUIDA"?`<button class="success small-btn" onclick="finishReturn(${r.id})">Concluir</button>`:''}</td></tr>`).join("")||'<tr><td colspan="8">Nenhuma devolução.</td></tr>'}</tbody></table></div></div>`;}
function showReturnForm(){$("returnForm").classList.remove("hidden");$("returnForm").innerHTML=`<div class="return-form-grid"><div class="field"><label>Documento</label><input id="returnDoc"></div><div class="field"><label>Loja</label><input id="returnStore"></div><div class="field"><label>Código de barras</label><input id="returnBarcode"></div><div class="field"><label>Descrição</label><input id="returnDescription"></div><div class="field"><label>Quantidade Loja</label><input id="returnStoreQty" type="number" min="0"></div><div class="field"><label>Quantidade CD</label><input id="returnCdQty" type="number" min="0"></div><div class="field"><label>Quantidade Anápolis</label><input id="returnAnaQty" type="number" min="0"></div><button class="primary" onclick="createReturn()">Conferir e registrar</button></div>`;}
function showReturnPdfForm(){$("returnForm").classList.remove("hidden");$("returnForm").innerHTML=`<div class="notice">Selecione os relatórios da mesma devolução. O sistema compara por código de barras usando a regra <b>Loja = CD + Anápolis</b>.</div><div class="return-form-grid"><div class="field"><label>Relatório da Loja</label><input id="returnPdfStore" type="file" accept=".pdf"></div><div class="field"><label>Conferência do CD</label><input id="returnPdfCd" type="file" accept=".pdf"></div><div class="field"><label>Itens em Anápolis (opcional)</label><input id="returnPdfAna" type="file" accept=".pdf"></div><button class="primary" onclick="compareReturnPdfs()">Comparar e registrar</button></div>`;}
async function createReturn(){try{await api("/api/unified/returns",{method:"POST",body:JSON.stringify({user_id:currentUser.id,document_no:$("returnDoc").value,store:$("returnStore").value,items:[{barcode:$("returnBarcode").value,description:$("returnDescription").value,qty_store:Number($("returnStoreQty").value||0),qty_cd:Number($("returnCdQty").value||0),qty_anapolis:Number($("returnAnaQty").value||0)}]})});toast("Devolução registrada.");renderReturns();}catch(e){toast(e.message)}}
async function compareReturnPdfs(){const loja=$("returnPdfStore").files?.[0],cd=$("returnPdfCd").files?.[0],ana=$("returnPdfAna").files?.[0];if(!loja||!cd)return toast("Selecione os PDFs da Loja e do CD.");const form=new FormData();form.append("file_store",loja);form.append("file_cd",cd);if(ana)form.append("file_anapolis",ana);try{const d=await api(`/api/unified/returns/compare-pdf?user_id=${currentUser.id}`,{method:"POST",body:form});toast(`${d.items} itens comparados. Status: ${d.status}.`);renderReturns();}catch(e){toast(e.message)}}
async function openReturn(id){try{const d=await api(`/api/unified/returns/${id}`);$("modalBody").innerHTML=`<div class="card-title"><div><h2>Devolução ${esc(d.return.document_no)}</h2><div class="card-subtitle">Conferência e destino de cada item</div></div>${statusBadge(d.return.status)}</div><div class="summary-grid compact-summary"><div class="summary-box"><span>Loja</span><strong>${d.return.total_store}</strong></div><div class="summary-box"><span>CD + Anápolis</span><strong>${Number(d.return.total_cd)+Number(d.return.total_anapolis)}</strong></div><div class="summary-box"><span>Diferença</span><strong>${d.return.difference}</strong></div></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Descrição</th><th>Loja</th><th>CD</th><th>Anápolis</th><th>Dif.</th><th>Condição</th><th>Destino</th><th></th></tr></thead><tbody>${d.items.map(i=>`<tr><td>${esc(i.barcode||'—')}</td><td>${esc(i.description||'—')}</td><td>${i.qty_store}</td><td>${i.qty_cd}</td><td>${i.qty_anapolis}</td><td>${i.difference}</td><td><select id="returnCondition_${i.id}"><option ${i.condition_status==='OK'?'selected':''}>OK</option><option ${i.condition_status==='DIVERGENTE'?'selected':''}>DIVERGENTE</option><option ${i.condition_status==='AVARIA'?'selected':''}>AVARIA</option><option ${i.condition_status==='TRATADO'?'selected':''}>TRATADO</option></select></td><td><select id="returnDestination_${i.id}"><option value="">Revisar</option>${['ESTOQUE','AVARIA','DESCARTE','FORNECEDOR'].map(v=>`<option ${i.destination===v?'selected':''}>${v}</option>`).join('')}</select></td><td><button class="secondary small-btn" onclick="treatReturnItem(${id},${i.id})">Salvar</button></td></tr>`).join('')}</tbody></table></div>`;$("modal").classList.remove("hidden");}catch(e){toast(e.message)}}
async function treatReturnItem(returnId,itemId){try{await api(`/api/unified/returns/${returnId}/items/${itemId}`,{method:"PATCH",body:JSON.stringify({user_id:currentUser.id,condition_status:$(`returnCondition_${itemId}`).value,destination:$(`returnDestination_${itemId}`).value})});toast("Tratativa salva.");openReturn(returnId);}catch(e){toast(e.message)}}
async function finishReturn(id){try{await api(`/api/unified/returns/${id}`,{method:"PATCH",body:JSON.stringify({user_id:currentUser.id,status:"CONCLUIDA",decision:"TRATADA"})});renderReturns();}catch(e){toast(e.message)}}

async function safeApi(url, fallback) { try { return await api(url); } catch (error) { console.warn(url,error); return fallback; } }
const shortStatus = value => String(value||"—").replaceAll("_"," ");
const progressFor = card => card.status?.includes("FINAL")||card.status?.includes("CONCL")?100:card.status?.includes("PROCESS")?68:card.status?.includes("ETIQU")?82:card.status?.includes("QUAL")||card.status?.includes("INSPE")?38:card.status?.includes("RECEB")?18:12;

async function renderDashboard() {
  setPage("Central de Operações", "");
  const [data,unified,warehouse,sgo,quality,processing,returns] = await Promise.all([
    safeApi("/api/dashboard",{totals:{receiving:0,quality:0,processing:0,storage:0},recent:[],status_counts:[]}),
    safeApi("/api/unified/overview",{warehouse:{percentage:0},tasks:{},returns:{},sgo:{},recent_movements:[]}),
    safeApi("/api/unified/warehouse",{zones:[],locations:[]}),safeApi("/api/unified/sgo",[]),
    safeApi("/api/cards?scope=quality",[]),safeApi("/api/cards?scope=processing",[]),safeApi("/api/unified/returns",[])
  ]);
  const active=[...processing,...data.recent.filter(c=>["QUALIDADE","PROCESSAMENTO","ETIQUETAGEM"].includes(c.current_sector))].filter((c,i,a)=>a.findIndex(x=>x.id===c.id)===i).slice(0,5);
  const awaiting=sgo.filter(x=>x.status==="EM_TRANSITO").slice(0,5);
  $("mainContent").innerHTML=`<div class="reference-dashboard">
    <div class="hero-kpis">
      ${heroKpi("Aguardando recebimento",data.totals.receiving,"Pedidos","▣","blue","receiving")}
      ${heroKpi("Em qualidade",data.totals.quality,"Pedidos","◇","teal","quality")}
      ${heroKpi("Em processamento",data.totals.processing,"Pedidos","⚙","blue","processing")}
      <button class="hero-card" onclick="goTo('storage-hub')"><div><span>Capacidade do CD</span><strong>${unified.warehouse.percentage||0}%</strong><small>Utilizada</small><em>Ver capacidade ›</em></div><div class="capacity-ring" style="--pct:${Math.min(100,unified.warehouse.percentage||0)}"><b>⌂</b></div></button>
    </div>
    <div class="dash-row dash-row-main">
      ${dashboardPanel("⌁","Produção ativa",`<span class="live-indicator">◷ ${new Date().toLocaleTimeString('pt-BR')}</span>`,compactProductionTable(active))}
      ${dashboardPanel("⇩","Aguardando recebimento",`<span class="panel-count">${awaiting.length||data.totals.receiving}</span>`,awaitingTable(awaiting,data.recent))}
      ${dashboardPanel("⌁","Estoque conectado",`<span class="online-pill">Online</span>`,zonesTable(warehouse.zones))}
    </div>
    <div class="dash-row dash-row-secondary">
      ${dashboardPanel("◇","Qualidade",`<span class="panel-count">${quality.length}</span>`,qualityTable(quality.slice(0,5)))}
      ${dashboardPanel("⚙","Processamento",`<span class="panel-count">${processing.length}</span>`,processingTable(processing.slice(0,5)))}
      ${dashboardPanel("↩","Devoluções",`<span class="panel-count red-count">${returns.filter(r=>r.status!=="CONCLUIDA").length}</span>`,returnsTable(returns.slice(0,5)))}
    </div>
    <div class="flow-strip">${[["🛒","Compra / SGO","sgo-indicators"],["⇩","Recebimento","receiving"],["◇","Qualidade","quality"],["⚙","Processamento","processing"],["♢","Etiquetagem","labeling"],["⌂","Estocagem","storage-hub"],["▣","Expedição / Devolução","returns-hub"]].map(([icon,label,view],i)=>`${i?'<i>→</i>':''}<button onclick="goTo('${view}')"><b>${icon}</b><span>${label}</span>${i===1?'<small>+ 10%</small>':''}</button>`).join("")}</div>
  </div>`;
}

function heroKpi(title,value,hint,icon,tone,view){return `<button class="hero-card" onclick="goTo('${view}')"><div><span>${title}</span><strong>${value||0}</strong><small>${hint}</small><em>Ver ${title.replace('Em ','').toLowerCase()} ›</em></div><b class="hero-icon ${tone}">${icon}</b></button>`;}
function dashboardPanel(icon,title,action,body){return `<section class="dash-panel"><header><b>${icon}</b><strong>${title}</strong>${action}</header><div class="dash-panel-body">${body}</div></section>`;}
function emptyRows(cols,text="Nenhum registro nesta visão."){return `<tr><td colspan="${cols}" class="empty-cell">${text}</td></tr>`;}
function compactProductionTable(rows){return `<table class="dash-table"><thead><tr><th>Compra / SGO</th><th>Etapa atual</th><th>Progresso</th><th>Resp.</th></tr></thead><tbody>${rows.map(c=>`<tr onclick="openCard(${c.id})"><td>${esc(c.purchase_id)}</td><td>${esc(c.current_sector||'—')}</td><td><div class="tiny-progress"><i style="width:${progressFor(c)}%"></i></div><small>${progressFor(c)}%</small></td><td><span class="avatar">${esc((c.brand||'OP').slice(0,2).toUpperCase())}</span></td></tr>`).join('')||emptyRows(4)}</tbody></table><button class="panel-link" onclick="goTo('processing')">Ver toda produção ›</button>`;}
function awaitingTable(rows,recent){const source=rows.length?rows:recent.filter(c=>c.current_sector==='RECEBIMENTO').map(c=>({purchase_id:c.purchase_id,forecast_date:'—',origin:c.supplier,quantity:c.expected_total}));return `<table class="dash-table"><thead><tr><th>Compra / SGO</th><th>Prev. chegada</th><th>Fornecedor</th><th>Volumes</th></tr></thead><tbody>${source.slice(0,5).map(r=>`<tr><td>${esc(r.purchase_id||'—')}</td><td>${esc(r.forecast_date||'—')}</td><td>${esc(r.origin||r.brand||'—')}</td><td>${r.quantity||0}</td></tr>`).join('')||emptyRows(4)}</tbody></table><button class="panel-link" onclick="goTo('receiving')">Ver todos ›</button>`;}
function zonesTable(zones){return `<table class="dash-table"><thead><tr><th>Zona</th><th>Ocupação</th><th>Status</th></tr></thead><tbody>${zones.slice(0,5).map(z=>`<tr><td>${esc(z.code)}</td><td><div class="tiny-progress"><i class="${z.occupancy>90?'warn-bar':''}" style="width:${Math.min(100,z.occupancy)}%"></i></div><small>${z.occupancy}%</small></td><td><span class="dot-status ${z.occupancy>90?'attention':''}">${z.occupancy>90?'Atenção':'Normal'}</span></td></tr>`).join('')||emptyRows(3)}</tbody></table><button class="panel-link" onclick="goTo('warehouse')">Ver endereçamento ›</button>`;}
function qualityTable(rows){return `<table class="dash-table"><thead><tr><th>Compra / SGO</th><th>Itens</th><th>Lotes</th><th>Status</th></tr></thead><tbody>${rows.map(c=>`<tr onclick="openCard(${c.id},'quality')"><td>${esc(c.purchase_id)}</td><td>${c.expected_total}</td><td>${c.item_count}</td><td>${statusBadge(c.status_label)}</td></tr>`).join('')||emptyRows(4)}</tbody></table><button class="panel-link" onclick="goTo('quality')">Ver todos ›</button>`;}
function processingTable(rows){return `<table class="dash-table"><thead><tr><th>Compra / SGO</th><th>Tipo</th><th>Peças</th><th>Status</th></tr></thead><tbody>${rows.map(c=>`<tr onclick="openCard(${c.id},'processing')"><td>${esc(c.purchase_id)}</td><td><span class="type-tag">${c.purchase_mode==='GRADE'?'Grade':'Saldo'}</span></td><td>${c.expected_total}</td><td>${statusBadge(c.status_label)}</td></tr>`).join('')||emptyRows(4)}</tbody></table><button class="panel-link" onclick="goTo('processing')">Ver todos ›</button>`;}
function returnsTable(rows){return `<table class="dash-table"><thead><tr><th>Devolução</th><th>Loja</th><th>Motivo</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr onclick="openReturn(${r.id})"><td>${esc(r.document_no)}</td><td>${esc(r.store||'—')}</td><td>${r.difference?'Divergência':'Conferência'}</td><td>${statusBadge(r.status)}</td></tr>`).join('')||emptyRows(4)}</tbody></table><button class="panel-link" onclick="goTo('returns-hub')">Ver todas ›</button>`;}

async function renderStorageHub(){setPage("Estocagem","");const [cards,warehouse,analytics]=await Promise.all([safeApi('/api/cards?scope=storage',[]),safeApi('/api/unified/warehouse',{zones:[],locations:[]}),safeApi('/api/unified/warehouse/analytics',{structures:[],categories:[],brands:[],groups:[]})]);const occupied=warehouse.locations.filter(l=>l.occupied_qty>0);$("mainContent").innerHTML=`${moduleTabs([["Visão geral","storage-hub"],["Fila operacional","storage"],["Mapa de casulos","warehouse"],["Estatísticas","stock-stats"],["Simulador","capacity-simulator"]],"storage-hub")}<div class="hero-kpis storage-kpis">${heroKpi("Aguardando estocagem",cards.length,"Cards","⌂","blue","storage")}${heroKpi("Endereços ocupados",occupied.length,"Casulos","▦","teal","warehouse")}${heroKpi("Endereços livres",warehouse.locations.filter(l=>l.status==='DISPONIVEL').length,"Casulos","◇","blue","warehouse")}<div class="hero-card static-card"><div><span>Ocupação geral</span><strong>${warehouse.zones.length?Math.round(warehouse.zones.reduce((a,z)=>a+z.occupancy,0)/warehouse.zones.length):0}%</strong><small>Capacidade cadastrada</small></div></div></div><div class="dash-row storage-layout">${dashboardPanel("▦","Visualizador de casulos","",zonesTable(warehouse.zones))}${dashboardPanel("⌕","Consulta rápida","",`<div class="panel-search"><input id="stockQuickSearch" placeholder="Digite endereço, marca ou categoria" oninput="filterStockQuick()"></div><table class="dash-table"><tbody>${occupied.slice(0,12).map(l=>`<tr class="stock-quick-row" data-search="${esc(normalizeSearch([l.address,l.category,l.structure_type].join(' ')))}"><td><b>${esc(l.address)}</b></td><td>${esc(l.category||'Sem categoria')}</td><td>${l.occupied_qty}/${l.capacity}</td><td>${statusBadge(l.status)}</td></tr>`).join('')||emptyRows(4)}</tbody></table>`)}</div><section class="dash-panel stock-report-panel"><header><b>⇧</b><strong>Relatório de estoque por grupo</strong><button class="panel-action" onclick="document.getElementById('stockGroupPdf').click()">Importar PDF</button><input id="stockGroupPdf" class="hidden" type="file" accept=".pdf" onchange="importStockGroupReport(this)"></header><div class="dash-panel-body">${analytics.groups?.length?`<div class="group-summary">${['FEMININO','MASCULINO','OUTROS'].map(g=>`<div><span>${g}</span><strong>${analytics.groups.filter(x=>x.gender===g).reduce((a,x)=>a+Number(x.quantity),0).toLocaleString('pt-BR')}</strong></div>`).join('')}</div>`:'<div class="empty-visual">Importe o PDF “Resumo de Estoque do Grupo” para recuperar a visão por gênero e grupo.</div>'}</div></section>`;}
function moduleTabs(items,current){if(items.some(([,view])=>view==="warehouse")&&!items.some(([,view])=>view==="warehouse-heatmap")){const position=items.findIndex(([,view])=>view==="warehouse")+1;items=[...items.slice(0,position),["Mapa de Calor","warehouse-heatmap"],...items.slice(position)];}return `<div class="module-tabs">${items.map(([label,view])=>`<button class="${view===current?'active':''}" onclick="goTo('${view}')">${label}</button>`).join('')}</div>`;}
function filterStockQuick(){const t=normalizeSearch($("stockQuickSearch")?.value||'');document.querySelectorAll('.stock-quick-row').forEach(r=>r.classList.toggle('hidden',t&&!r.dataset.search.includes(t)));}
async function importStockGroupReport(input){if(!input.files?.[0])return;const form=new FormData();form.append('file',input.files[0]);try{const d=await api(`/api/unified/warehouse/import-group-report?user_id=${currentUser.id}`,{method:'POST',body:form});toast(`${d.groups} grupos e ${d.total_qty} peças importados.`);renderStorageHub();}catch(e){toast(e.message)}}

async function renderStockStatistics(){setPage("Estatísticas de Casulos","");const [warehouse,a]=await Promise.all([safeApi('/api/unified/warehouse',{zones:[],locations:[]}),safeApi('/api/unified/warehouse/analytics',{structures:[],categories:[],brands:[],groups:[]})]);const cap=warehouse.locations.reduce((s,l)=>s+Number(l.capacity),0),occ=warehouse.locations.reduce((s,l)=>s+Number(l.occupied_qty),0);$("mainContent").innerHTML=`${moduleTabs([["Visão geral","storage-hub"],["Fila operacional","storage"],["Mapa de casulos","warehouse"],["Estatísticas","stock-stats"],["Simulador","capacity-simulator"]],"stock-stats")}<div class="hero-kpis">${heroKpi("Total de casulos",warehouse.locations.length,"Estrutura física","▦","blue","warehouse")}${heroKpi("Capacidade estimada",cap.toLocaleString('pt-BR'),"Peças","⌂","teal","storage-hub")}${heroKpi("Ocupação real",occ.toLocaleString('pt-BR'),"Peças","◇","blue","storage-hub")}${heroKpi("Disponibilidade",Math.max(0,cap-occ).toLocaleString('pt-BR'),"Peças","＋","teal","capacity-simulator")}</div><div class="dash-row analytics-grid">${analyticsBars("Estruturas",a.structures.map(x=>({label:x.label,value:x.locations,hint:`${x.occupied}/${x.capacity}`})))}${analyticsBars("Estoque por categoria",a.categories.map(x=>({label:x.label,value:x.quantity})))}${analyticsBars("Estoque por marca",a.brands.map(x=>({label:x.label,value:x.quantity})))}</div>${a.groups?.length?dashboardPanel("▣","Último relatório por grupo",`<span>${esc(a.latest_report?.filename||'')}</span>`,analyticsBarsBody(a.groups.map(x=>({label:x.group_name,value:x.quantity,hint:x.gender})))):''}`;}
function analyticsBars(title,rows){return dashboardPanel("▥",title,"",analyticsBarsBody(rows));}
function analyticsBarsBody(rows){const max=Math.max(1,...rows.map(r=>Number(r.value)||0));return `<div class="analytics-bars">${rows.slice(0,15).map(r=>`<div><span>${esc(r.label)}</span><i><b style="width:${Number(r.value)*100/max}%"></b></i><strong>${Number(r.value).toLocaleString('pt-BR')}</strong><small>${esc(r.hint||'')}</small></div>`).join('')||'<div class="empty-visual">Sem dados para exibir.</div>'}</div>`;}

async function renderCapacitySimulator(){setPage("Simulador de Capacidade","");const w=await safeApi('/api/unified/warehouse',{locations:[],zones:[]});$("mainContent").innerHTML=`${moduleTabs([["Visão geral","storage-hub"],["Fila operacional","storage"],["Mapa de casulos","warehouse"],["Estatísticas","stock-stats"],["Simulador","capacity-simulator"]],"capacity-simulator")}<section class="dash-panel simulator-panel"><header><b>⌁</b><strong>Teste uma entrada sem alterar o estoque</strong></header><div class="dash-panel-body simulator-form"><div class="field"><label>Endereço</label><select id="simLocation" onchange="calculateCapacitySimulation()"><option value="">Selecione</option>${w.locations.map(l=>`<option value="${l.id}" data-cap="${l.capacity}" data-occ="${l.occupied_qty}">${esc(l.address)} • livre ${Math.max(0,l.capacity-l.occupied_qty)}</option>`).join('')}</select></div><div class="field"><label>Quantidade a armazenar</label><input id="simQty" type="number" min="0" value="10" oninput="calculateCapacitySimulation()"></div><div id="simResult" class="simulation-result"><span>Selecione um endereço para simular.</span></div></div></section>`;unifiedCache.warehouse=w;}
function calculateCapacitySimulation(){const option=$("simLocation")?.selectedOptions?.[0],qty=Number($("simQty")?.value||0);if(!option?.value)return;const cap=Number(option.dataset.cap),occ=Number(option.dataset.occ),after=occ+qty,pct=cap?Math.round(after*100/cap):0,excess=Math.max(0,after-cap);$("simResult").innerHTML=`<div class="capacity-gauge"><i style="width:${Math.min(100,pct)}%" class="${excess?'danger-fill':pct>80?'warn-fill':''}"></i></div><strong>${pct}% após a entrada</strong><span>${occ} atuais + ${qty} novas = ${after} de ${cap}</span>${excess?`<b class="text-danger">Excede a capacidade em ${excess} peças.</b>`:'<b class="text-success">Entrada compatível com a capacidade.</b>'}`;}

async function renderSgoIndicators(){setPage("SGO e Indicadores","");const [rows,tasks]=await Promise.all([safeApi('/api/unified/sgo',[]),safeApi('/api/unified/tasks',[])]);const total=rows.reduce((a,r)=>a+Number(r.quantity||0),0),late=rows.filter(r=>r.forecast_date&&new Date(r.forecast_date)<new Date()&&r.status!=='CONCLUIDO');const byStatus=Object.entries(rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+Number(r.quantity||0),a),{})).map(([label,value])=>({label,value}));$("mainContent").innerHTML=`${moduleTabs([["Indicadores","sgo-indicators"],["Entradas SGO","sgo"],["Quadro de tarefas","tasks"],["Importar compras","import"]],"sgo-indicators")}<div class="hero-kpis">${heroKpi("Entradas previstas",rows.length,"Compras / lotes","⇩","blue","sgo")}${heroKpi("Peças previstas",total.toLocaleString('pt-BR'),"Quantidade SGO","▣","teal","sgo")}${heroKpi("Previsões atrasadas",late.length,"Requer atenção","!","blue","sgo")}${heroKpi("Tarefas abertas",tasks.filter(t=>t.status!=='CONCLUIDA').length,"Operação","☑","teal","tasks")}</div><div class="dash-row indicators-layout">${analyticsBars("Distribuição por etapa",byStatus)}${dashboardPanel("⇩","Próximas entradas",`<span class="panel-count">${rows.length}</span>`,awaitingTable(rows.slice(0,10),[]))}</div>`;}

async function renderReturnsHub(){setPage("Devoluções","");const rows=await safeApi('/api/unified/returns',[]),movements=await safeApi('/api/unified/movements?limit=80',[]);const open=rows.filter(r=>r.status!=='CONCLUIDA'),div=open.filter(r=>r.status==='DIVERGENTE');$("mainContent").innerHTML=`${moduleTabs([["Dashboard","returns-hub"],["Conferência e tratamento","returns"],["Indicadores","return-indicators"],["Histórico","return-history"]],"returns-hub")}<div class="hero-kpis">${heroKpi("Devoluções registradas",rows.length,"Documentos","↩","blue","returns")}${heroKpi("Aguardando tratamento",open.length,"Pendências","!","teal","returns")}${heroKpi("Divergentes",div.length,"Conferir","◇","blue","returns")}${heroKpi("Concluídas",rows.filter(r=>r.status==='CONCLUIDA').length,"Finalizadas","✓","teal","returns")}</div><div class="dash-row returns-layout">${dashboardPanel("!","Pendências",`<span class="panel-count red-count">${open.length}</span>`,returnsTable(open.slice(0,10)))}${dashboardPanel("◷","Movimentos recentes","",`<div class="movement-list">${movements.filter(m=>m.domain==='DEVOLUCOES').slice(0,12).map(m=>`<div><b>${esc(m.event_type.replaceAll('_',' '))}</b><span>${esc(m.description)}</span><small>${fmtDateTime(m.created_at)}</small></div>`).join('')||'<div class="empty-visual">Nenhum movimento de devolução.</div>'}</div>`)}</div>`;}

async function renderReturnsV3(){await renderReturns();$("mainContent").insertAdjacentHTML("afterbegin",moduleTabs([["Dashboard","returns-hub"],["Conferência e tratamento","returns"],["Indicadores","return-indicators"],["Histórico","return-history"]],"returns"));}

async function renderReturnIndicators(){setPage("Indicadores de Devoluções","");const rows=await safeApi('/api/unified/returns',[]);const loja=rows.reduce((a,r)=>a+Number(r.total_store||0),0),found=rows.reduce((a,r)=>a+Number(r.total_cd||0)+Number(r.total_anapolis||0),0);const byStore=Object.entries(rows.reduce((a,r)=>{const k=r.store||r.customer||'Não informada';a[k]=(a[k]||0)+Number(r.total_store||0);return a},{})).map(([label,value])=>({label,value}));const byStatus=Object.entries(rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})).map(([label,value])=>({label,value}));$("mainContent").innerHTML=`${moduleTabs([["Dashboard","returns-hub"],["Conferência e tratamento","returns"],["Indicadores","return-indicators"],["Histórico","return-history"]],"return-indicators")}<div class="hero-kpis">${heroKpi("Devoluções",rows.length,"Registros","↩","blue","returns-hub")}${heroKpi("Peças da loja",loja.toLocaleString('pt-BR'),"Declaradas","▣","teal","returns")}${heroKpi("CD + Anápolis",found.toLocaleString('pt-BR'),"Encontradas","◇","blue","returns")}${heroKpi("Diferença",(found-loja).toLocaleString('pt-BR'),"Acumulada","!","teal","returns")}</div><div class="dash-row indicators-layout">${analyticsBars("Peças por loja",byStore)}${analyticsBars("Distribuição por status",byStatus)}</div>`;}

async function renderReturnHistory(){setPage("Histórico de Devoluções","");const [rows,moves]=await Promise.all([safeApi('/api/unified/returns',[]),safeApi('/api/unified/movements?limit=500',[])]);$("mainContent").innerHTML=`${moduleTabs([["Dashboard","returns-hub"],["Conferência e tratamento","returns"],["Indicadores","return-indicators"],["Histórico","return-history"]],"return-history")}<section class="dash-panel"><header><b>◷</b><strong>Documentos e movimentações</strong><span class="panel-count">${rows.length}</span></header><div class="dash-panel-body"><table class="dash-table"><thead><tr><th>Documento</th><th>Loja</th><th>Loja</th><th>CD</th><th>Anápolis</th><th>Diferença</th><th>Status</th><th>Data</th></tr></thead><tbody>${rows.map(r=>`<tr onclick="openReturn(${r.id})"><td>${esc(r.document_no)}</td><td>${esc(r.store||r.customer||'—')}</td><td>${r.total_store}</td><td>${r.total_cd}</td><td>${r.total_anapolis}</td><td>${r.difference}</td><td>${statusBadge(r.status)}</td><td>${fmtDateTime(r.created_at)}</td></tr>`).join('')||emptyRows(8)}</tbody></table></div></section><section class="dash-panel" style="margin-top:14px"><header><b>↯</b><strong>Auditoria das tratativas</strong></header><div class="dash-panel-body movement-list">${moves.filter(m=>m.domain==='DEVOLUCOES').map(m=>`<div><b>${esc(m.event_type.replaceAll('_',' '))}</b><span>${esc(m.description)}</span><small>${fmtDateTime(m.created_at)} • ${esc(m.user_name||'Sistema')}</small></div>`).join('')||'<div class="empty-visual">Nenhuma tratativa registrada.</div>'}</div></section>`;}

async function renderRegistrations(){setPage("Cadastros","");const [users,w,a]=await Promise.all([safeApi('/api/users',[]),safeApi('/api/unified/warehouse',{zones:[]}),safeApi('/api/unified/warehouse/analytics',{groups:[]})]);$("mainContent").innerHTML=`<div class="dash-row registrations-grid">${dashboardPanel("♙","Usuários e perfis",`<span class="panel-count">${users.length}</span>`,`<table class="dash-table"><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${statusBadge(u.role)}</td></tr>`).join('')}</tbody></table>`)}${dashboardPanel("▦","Zonas do CD",`<span class="panel-count">${w.zones.length}</span>`,`<table class="dash-table"><thead><tr><th>Zona</th><th>Descrição</th><th>Capacidade</th></tr></thead><tbody>${w.zones.map(z=>`<tr><td>${esc(z.code)}</td><td>${esc(z.name)}</td><td>${Number(z.capacity).toLocaleString('pt-BR')}</td></tr>`).join('')}</tbody></table>`)}${dashboardPanel("▣","Grupos do último relatório","",analyticsBarsBody((a.groups||[]).map(g=>({label:g.group_name,value:g.quantity,hint:g.gender}))))}</div>`;}

async function renderSettings(){setPage("Configurações","");$("mainContent").innerHTML=`<div class="settings-grid"><button onclick="goTo('import')"><b>⇧</b><strong>Importar compras</strong><span>Atualizar Cards a partir do relatório Excel.</span></button><button onclick="goTo('tasks')"><b>☑</b><strong>Quadro de tarefas</strong><span>Responsáveis, prioridades e andamento.</span></button><button onclick="goTo('test')"><b>⚙</b><strong>Administração e testes</strong><span>Ferramentas controladas para validação.</span></button><button onclick="goTo('history')"><b>◷</b><strong>Histórico global</strong><span>Rastreabilidade das movimentações.</span></button></div><div class="state-panel"><b>OutLog One V3</b><span>Uma interface, um backend e uma base SQLite. As regras congeladas de Recebimento, Qualidade e Processamento permanecem no motor operacional.</span></div>`;}

setInterval(() => { if ($("clock")) $("clock").textContent = new Date().toLocaleString("pt-BR"); }, 1000);
if (currentUser) enterApp();
