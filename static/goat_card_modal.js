// ==========================================
// CRIAÇÃO MANUAL DE CARD — 1 REFERÊNCIA POR CARD
// ==========================================

let manualGradeSizes = [];
let manualGradeColors = [];
let manualGradeValues = {};
let manualGradeSizeSeq = 0;
let manualGradeColorSeq = 0;

function newManualGradeSize(name = "") {
  return { id: "s" + (++manualGradeSizeSeq), name };
}

function newManualGradeColor(name = "") {
  return { id: "c" + (++manualGradeColorSeq), name };
}

function openGoatCardModal() {
  let modal = document.getElementById("goatModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "goatModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:980px;background:#1e1e2d;color:#fff;padding:20px;border-radius:8px;margin:3% auto;border:1px solid #323248;box-shadow:0 10px 30px rgba(0,0,0,.5);">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;border-bottom:1px solid #323248;padding-bottom:10px;">
          <h2 style="margin:0;font-size:1.25rem;color:#fff;">Criar Card</h2>
          <button class="close-btn" onclick="closeGoatModal()" style="background:none;border:none;color:#a1a5b7;font-size:24px;cursor:pointer;">&times;</button>
        </div>
        <div class="modal-body">
          <div class="notice" style="margin-bottom:14px;background:#2b2b40;color:#c8c8d4;padding:10px;border-radius:4px;font-size:.875rem;">
            Criação manual. <b>1 Card = 1 referência.</b> Não existe leitura ou interpretação de texto copiado.
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
            <div class="field">
              <label style="display:block;font-weight:bold;margin-bottom:5px;font-size:.85rem;color:#a1a5b7;">REFERÊNCIA</label>
              <input id="manualCardReference" type="text" style="width:100%;box-sizing:border-box;padding:10px;background:#151521;color:#fff;border:1px solid #323248;border-radius:4px;" placeholder="Ex.: CONJUNTO Fem AUREAN ROAD MEL 22096-BLUSA">
            </div>
            <div class="field">
              <label style="display:block;font-weight:bold;margin-bottom:5px;font-size:.85rem;color:#a1a5b7;">FORNECEDOR</label>
              <input id="manualCardSupplier" type="text" style="width:100%;box-sizing:border-box;padding:10px;background:#151521;color:#fff;border:1px solid #323248;border-radius:4px;" placeholder="Nome do fornecedor">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px;">
            <div>
              <label style="display:block;font-weight:bold;margin-bottom:5px;font-size:.85rem;color:#a1a5b7;">NF <span style="font-weight:400;color:#777789;">(opcional)</span></label>
              <input id="manualCardNf" type="text" style="width:100%;box-sizing:border-box;padding:10px;background:#151521;color:#fff;border:1px solid #323248;border-radius:4px;" placeholder="Ex.: 123456">
            </div>
            <div>
              <label style="display:block;font-weight:bold;margin-bottom:5px;font-size:.85rem;color:#a1a5b7;">LOTE <span style="font-weight:400;color:#777789;">(opcional)</span></label>
              <input id="manualCardLot" type="text" style="width:100%;box-sizing:border-box;padding:10px;background:#151521;color:#fff;border:1px solid #323248;border-radius:4px;" placeholder="Ex.: 349.b">
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 8px;">
            <div><strong>GRADE</strong><div style="color:#92929f;font-size:.8rem;margin-top:3px;">Digite diretamente as cores e os tamanhos. Não existe cor ou tamanho pré-definido.</div></div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="secondary" onclick="addManualGradeSize()" style="padding:7px 11px;border-radius:4px;border:1px solid #323248;background:transparent;color:#fff;cursor:pointer;">+ Tamanho</button>
              <button type="button" class="secondary" onclick="addManualGradeRow()" style="padding:7px 11px;border-radius:4px;border:1px solid #323248;background:transparent;color:#fff;cursor:pointer;">+ Linha</button>
            </div>
          </div>
          <div id="manualGradeWrap" style="overflow:auto;border:1px solid #323248;border-radius:6px;background:#151521;"></div>
          <div id="manualGradeTotal" class="notice" style="margin-top:10px;background:#2b2b40;color:#fff;padding:10px;border-radius:4px;text-align:right;">Total da referência: <b>0</b> peças</div>
        </div>
        <div class="modal-footer actions" style="margin-top:15px;display:flex;justify-content:flex-end;gap:10px;">
          <button class="secondary" onclick="closeGoatModal()" style="padding:8px 16px;border-radius:4px;border:1px solid #323248;background:transparent;color:#fff;cursor:pointer;">Cancelar</button>
          <button class="primary" onclick="processManualCard()" style="padding:8px 16px;border-radius:4px;border:none;background:#3699ff;color:#fff;cursor:pointer;font-weight:600;">Criar Card</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  document.getElementById("manualCardReference").value = "";
  document.getElementById("manualCardSupplier").value = "";
  document.getElementById("manualCardNf").value = "";
  document.getElementById("manualCardLot").value = "";
  initManualGrade();
  modal.classList.remove("hidden");
}

function closeGoatModal() {
  const modal = document.getElementById("goatModal");
  if (modal) modal.classList.add("hidden");
}

function initManualGrade() {
  manualGradeSizeSeq = 0;
  manualGradeColorSeq = 0;
  manualGradeValues = {};
  manualGradeSizes = [newManualGradeSize()];
  manualGradeColors = [newManualGradeColor()];
  renderManualGrade();
}

function addManualGradeSize() {
  manualGradeSizes.push(newManualGradeSize());
  renderManualGrade();
}

function addManualGradeRow() {
  manualGradeColors.push(newManualGradeColor());
  renderManualGrade();
}

function removeManualGradeSize(index) {
  const size = manualGradeSizes[index];
  if (size) {
    manualGradeColors.forEach((color) => {
      delete manualGradeValues[color.id + "|" + size.id];
    });
  }
  manualGradeSizes.splice(index, 1);
  renderManualGrade();
}

function removeManualGradeColor(index) {
  const color = manualGradeColors[index];
  if (color) {
    manualGradeSizes.forEach((size) => {
      delete manualGradeValues[color.id + "|" + size.id];
    });
  }
  manualGradeColors.splice(index, 1);
  renderManualGrade();
}

function setManualGradeColor(index, value) {
  if (manualGradeColors[index]) manualGradeColors[index].name = value;
  updateManualGradeTotal();
}

function setManualGradeSize(index, value) {
  if (manualGradeSizes[index]) manualGradeSizes[index].name = value;
}

function setManualGradeQuantity(colorId, sizeId, value) {
  const quantity = Math.max(0, Math.floor(Number(value || 0)));
  manualGradeValues[colorId + "|" + sizeId] = Number.isFinite(quantity) ? quantity : 0;
  updateManualGradeTotal();
}

function getManualGradeQuantity(colorId, sizeId) {
  return Number(manualGradeValues[colorId + "|" + sizeId] || 0);
}

function renderManualGrade() {
  const wrap = document.getElementById("manualGradeWrap");
  if (!wrap) return;

  if (!manualGradeSizes.length || !manualGradeColors.length) {
    wrap.innerHTML = '<div style="padding:18px;color:#92929f;">Adicione pelo menos uma linha e um tamanho para montar a grade.</div>';
    updateManualGradeTotal();
    return;
  }

  let html = '<table style="width:100%;border-collapse:collapse;min-width:760px;"><thead><tr>';
  html += '<th style="padding:9px;text-align:left;border-bottom:1px solid #323248;min-width:190px;">Cor</th>';

  manualGradeSizes.forEach((size, si) => {
    html += '<th style="padding:7px;border-bottom:1px solid #323248;min-width:120px;">';
    html += '<div style="display:flex;gap:5px;align-items:center;">';
    html += '<input type="text" value="' + esc(size.name || "") + '" placeholder="Tamanho" oninput="setManualGradeSize(' + si + ', this.value)" style="width:100%;box-sizing:border-box;padding:7px;background:#1e1e2d;color:#fff;border:1px solid #323248;border-radius:4px;text-align:center;">';
    html += '<button type="button" onclick="removeManualGradeSize(' + si + ')" style="border:0;background:none;color:#92929f;cursor:pointer;font-size:18px;">×</button>';
    html += '</div></th>';
  });

  html += '<th style="padding:9px;border-bottom:1px solid #323248;">Total</th></tr></thead><tbody>';

  manualGradeColors.forEach((color, ci) => {
    html += '<tr><td style="padding:7px;border-bottom:1px solid #252536;">';
    html += '<div style="display:flex;gap:5px;align-items:center;">';
    html += '<input type="text" value="' + esc(color.name || "") + '" placeholder="Digite a cor" oninput="setManualGradeColor(' + ci + ', this.value)" style="width:100%;box-sizing:border-box;padding:8px;background:#1e1e2d;color:#fff;border:1px solid #323248;border-radius:4px;font-weight:600;">';
    html += '<button type="button" onclick="removeManualGradeColor(' + ci + ')" style="border:0;background:none;color:#92929f;cursor:pointer;font-size:18px;">×</button>';
    html += '</div></td>';

    manualGradeSizes.forEach((size) => {
      const id = 'grade_' + color.id + '_' + size.id;
      const quantity = getManualGradeQuantity(color.id, size.id);
      html += '<td style="padding:5px;border-bottom:1px solid #252536;">';
      html += '<input id="' + id + '" class="manual-grade-qty" type="number" min="0" step="1" value="' + quantity + '" oninput="setManualGradeQuantity(\'' + color.id + '\',\'' + size.id + '\',this.value)" style="width:100px;box-sizing:border-box;padding:8px;background:#1e1e2d;color:#fff;border:1px solid #323248;border-radius:4px;text-align:center;">';
      html += '</td>';
    });

    html += '<td id="row_total_' + color.id + '" style="padding:7px;border-bottom:1px solid #252536;font-weight:700;">0</td></tr>';
  });

  html += '<tr><td style="padding:9px;font-weight:700;">Total</td>';
  manualGradeSizes.forEach((size) => {
    html += '<td id="col_total_' + size.id + '" style="padding:9px;text-align:center;font-weight:700;">0</td>';
  });
  html += '<td id="grand_total" style="padding:9px;font-weight:700;">0</td></tr></tbody></table>';

  wrap.innerHTML = html;
  updateManualGradeTotal();
}

function updateManualGradeTotal() {
  let grand = 0;
  manualGradeColors.forEach((color) => {
    let row = 0;
    manualGradeSizes.forEach((size) => {
      row += getManualGradeQuantity(color.id, size.id);
    });
    grand += row;
    const rowEl = document.getElementById('row_total_' + color.id);
    if (rowEl) rowEl.textContent = row.toLocaleString('pt-BR');
  });

  manualGradeSizes.forEach((size) => {
    const total = manualGradeColors.reduce((sum, color) => {
      return sum + getManualGradeQuantity(color.id, size.id);
    }, 0);
    const col = document.getElementById('col_total_' + size.id);
    if (col) col.textContent = total.toLocaleString('pt-BR');
  });

  const totalEl = document.getElementById('grand_total');
  if (totalEl) totalEl.textContent = grand.toLocaleString('pt-BR');

  const notice = document.getElementById('manualGradeTotal');
  if (notice) notice.innerHTML = 'Total da referência: <b>' + grand.toLocaleString('pt-BR') + '</b> peças';
}

function collectManualGrade() {
  const rows = [];
  manualGradeColors.forEach((color) => {
    manualGradeSizes.forEach((size) => {
      const quantity = getManualGradeQuantity(color.id, size.id);
      if (quantity > 0) rows.push({
        color: String(color.name || "").trim(),
        size: String(size.name || "").trim(),
        quantity
      });
    });
  });
  return rows;
}

async function processManualCard() {
  const say = (m) => (typeof toast === "function" ? toast(m) : alert(m));
  const reference = (document.getElementById("manualCardReference")?.value || "").trim();
  const supplier = (document.getElementById("manualCardSupplier")?.value || "").trim();
  const nf = (document.getElementById("manualCardNf")?.value || "").trim();
  const lot = (document.getElementById("manualCardLot")?.value || "").trim();
  const grade = collectManualGrade();
  const total = grade.reduce((sum, row) => sum + row.quantity, 0);

  if (!reference) return say("Informe a referência.");
  if (!supplier) return say("Informe o fornecedor.");
  if (!manualGradeColors.some((row) => String(row.name || "").trim())) return say("Informe pelo menos uma cor.");
  if (!manualGradeSizes.some((col) => String(col.name || "").trim())) return say("Informe pelo menos um tamanho.");
  const invalid = grade.find((row) => !row.color || !row.size);
  if (invalid) return say("Toda quantidade preenchida precisa ter cor e tamanho.");
  if (!grade.length || total <= 0) return say("Informe pelo menos uma quantidade maior que zero na grade.");

  try {
    const d = await api("/api/goat/create-card", {
      method: "POST",
      body: JSON.stringify({ reference, supplier, nf, lot, grade })
    });
    say("Card criado para a referência " + d.reference + " (" + Number(d.expected_total || 0).toLocaleString("pt-BR") + " peças).");
    closeGoatModal();
    if (typeof goTo === "function") goTo("receiving"); else location.reload();
  } catch (err) {
    say("Erro ao criar card: " + (err.message || err));
  }
}
