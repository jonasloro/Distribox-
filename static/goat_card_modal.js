// ==========================================
// CRIAÇÃO MANUAL DE CARD — 1 REFERÊNCIA POR CARD
// ==========================================

let manualGradeSizes = [];
let manualGradeColors = [];

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
          <div class="field full">
            <label style="display:block;font-weight:bold;margin-bottom:5px;font-size:.85rem;color:#a1a5b7;">REFERÊNCIA</label>
            <input id="manualCardReference" type="text" style="width:100%;box-sizing:border-box;padding:10px;background:#151521;color:#fff;border:1px solid #323248;border-radius:4px;" placeholder="Ex.: CONJUNTO Fem AUREAN ROAD MEL 22096-BLUSA">
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 8px;">
            <div><strong>GRADE</strong><div style="color:#92929f;font-size:.8rem;margin-top:3px;">Adicione somente as cores e tamanhos existentes nesta referência.</div></div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="secondary" onclick="addManualGradeSize()" style="padding:7px 11px;border-radius:4px;border:1px solid #323248;background:transparent;color:#fff;cursor:pointer;">+ Tamanho</button>
              <button type="button" class="secondary" onclick="addManualGradeColor()" style="padding:7px 11px;border-radius:4px;border:1px solid #323248;background:transparent;color:#fff;cursor:pointer;">+ Cor</button>
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
  initManualGrade();
  modal.classList.remove("hidden");
}

function closeGoatModal() {
  const modal = document.getElementById("goatModal");
  if (modal) modal.classList.add("hidden");
}

function initManualGrade() {
  manualGradeSizes = ["P", "M", "G"];
  manualGradeColors = ["PRETO", "BEGE", "CAFÉ"];
  renderManualGrade();
}

function addManualGradeSize() {
  const value = prompt("Nome do novo tamanho:");
  if (!value || !value.trim()) return;
  const normalized = value.trim();
  if (!manualGradeSizes.includes(normalized)) manualGradeSizes.push(normalized);
  renderManualGrade();
}

function addManualGradeColor() {
  const value = prompt("Nome da nova cor:");
  if (!value || !value.trim()) return;
  const normalized = value.trim();
  if (!manualGradeColors.includes(normalized)) manualGradeColors.push(normalized);
  renderManualGrade();
}

function removeManualGradeSize(index) {
  manualGradeSizes.splice(index, 1);
  renderManualGrade();
}

function removeManualGradeColor(index) {
  manualGradeColors.splice(index, 1);
  renderManualGrade();
}

function renderManualGrade() {
  const wrap = document.getElementById("manualGradeWrap");
  if (!wrap) return;
  if (!manualGradeSizes.length || !manualGradeColors.length) {
    wrap.innerHTML = '<div style="padding:18px;color:#92929f;">Adicione pelo menos uma cor e um tamanho.</div>';
    updateManualGradeTotal();
    return;
  }

  let html = '<table style="width:100%;border-collapse:collapse;min-width:560px;"><thead><tr>';
  html += '<th style="padding:9px;text-align:left;border-bottom:1px solid #323248;">Cor × Tam</th>';
  manualGradeSizes.forEach((size, si) => {
    html += '<th style="padding:9px;border-bottom:1px solid #323248;">' + esc(size) + ' <button type="button" onclick="removeManualGradeSize(' + si + ')" style="border:0;background:none;color:#92929f;cursor:pointer;">×</button></th>';
  });
  html += '<th style="padding:9px;border-bottom:1px solid #323248;">Total</th></tr></thead><tbody>';

  manualGradeColors.forEach((color, ci) => {
    html += '<tr><td style="padding:7px;border-bottom:1px solid #252536;font-weight:600;">' + esc(color) + ' <button type="button" onclick="removeManualGradeColor(' + ci + ')" style="border:0;background:none;color:#92929f;cursor:pointer;">×</button></td>';
    manualGradeSizes.forEach((size, si) => {
      const id = 'grade_' + ci + '_' + si;
      html += '<td style="padding:5px;border-bottom:1px solid #252536;"><input id="' + id + '" class="manual-grade-qty" type="number" min="0" step="1" value="0" oninput="updateManualGradeTotal()" style="width:90px;box-sizing:border-box;padding:8px;background:#1e1e2d;color:#fff;border:1px solid #323248;border-radius:4px;text-align:center;"></td>';
    });
    html += '<td id="row_total_' + ci + '" style="padding:7px;border-bottom:1px solid #252536;font-weight:700;">0</td></tr>';
  });

  html += '<tr><td style="padding:9px;font-weight:700;">Total</td>';
  manualGradeSizes.forEach((size, si) => html += '<td id="col_total_' + si + '" style="padding:9px;text-align:center;font-weight:700;">0</td>');
  html += '<td id="grand_total" style="padding:9px;font-weight:700;">0</td></tr></tbody></table>';
  wrap.innerHTML = html;
  updateManualGradeTotal();
}

function updateManualGradeTotal() {
  let grand = 0;
  manualGradeColors.forEach((color, ci) => {
    let row = 0;
    manualGradeSizes.forEach((size, si) => {
      const el = document.getElementById('grade_' + ci + '_' + si);
      const qty = Math.max(0, Math.floor(Number(el?.value || 0)));
      row += qty;
      const col = document.getElementById('col_total_' + si);
      if (col) {
        const total = Array.from(document.querySelectorAll('.manual-grade-qty')).reduce((sum, input) => {
          const ids = String(input.id || '').split('_');
          return ids[2] === String(si) ? sum + Math.max(0, Math.floor(Number(input.value || 0))) : sum;
        }, 0);
        col.textContent = total.toLocaleString('pt-BR');
      }
    });
    grand += row;
    const rowEl = document.getElementById('row_total_' + ci);
    if (rowEl) rowEl.textContent = row.toLocaleString('pt-BR');
  });
  const totalEl = document.getElementById('grand_total');
  if (totalEl) totalEl.textContent = grand.toLocaleString('pt-BR');
  const notice = document.getElementById('manualGradeTotal');
  if (notice) notice.innerHTML = 'Total da referência: <b>' + grand.toLocaleString('pt-BR') + '</b> peças';
}

function collectManualGrade() {
  const rows = [];
  manualGradeColors.forEach((color, ci) => {
    manualGradeSizes.forEach((size, si) => {
      const el = document.getElementById('grade_' + ci + '_' + si);
      const quantity = Math.max(0, Math.floor(Number(el?.value || 0)));
      if (quantity > 0) rows.push({ color, size, quantity });
    });
  });
  return rows;
}

async function processManualCard() {
  const say = (m) => (typeof toast === "function" ? toast(m) : alert(m));
  const reference = (document.getElementById("manualCardReference")?.value || "").trim();
  const grade = collectManualGrade();
  const total = grade.reduce((sum, row) => sum + row.quantity, 0);

  if (!reference) return say("Informe a referência.");
  if (!grade.length || total <= 0) return say("Informe pelo menos uma quantidade maior que zero na grade.");

  try {
    const d = await api("/api/goat/create-card", {
      method: "POST",
      body: JSON.stringify({ reference, grade })
    });
    say("Card criado para a referência " + d.reference + " (" + Number(d.expected_total || 0).toLocaleString("pt-BR") + " peças).");
    closeGoatModal();
    if (typeof goTo === "function") goTo("receiving"); else location.reload();
  } catch (err) {
    say("Erro ao criar card: " + (err.message || err));
  }
}
