// ==========================================
// MÓDULO DE IMPORTAÇÃO DE CARD DO GOAT
// ==========================================

function openGoatCardModal() {
  let modal = document.getElementById("goatModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "goatModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px; background: #1e1e2d; color: #fff; padding: 20px; border-radius: 8px; margin: 8% auto; border: 1px solid #323248; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #323248; padding-bottom: 10px;">
          <h2 style="margin: 0; font-size: 1.25rem; color: #fff;">Importar Card do GOAT</h2>
          <button class="close-btn" onclick="closeGoatModal()" style="background: none; border: none; color: #a1a5b7; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        <div class="modal-body">
          <div class="notice" style="margin-bottom: 12px; background: #2b2b40; color: #92929f; padding: 10px; border-radius: 4px; font-size: 0.875rem;">
            Copie todo o texto do card no GOAT e cole no campo abaixo.
          </div>
          <div class="field full">
            <label style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 0.85rem; color: #a1a5b7;">Texto Copiado do GOAT</label>
            <textarea id="goatCardText" rows="10" style="width: 100%; box-sizing: border-box; padding: 10px; background: #151521; color: #fff; border: 1px solid #323248; border-radius: 4px; font-family: inherit; resize: vertical;" placeholder="Cole aqui o texto do card..."></textarea>
          </div>
        </div>
        <div class="modal-footer actions" style="margin-top: 15px; display: flex; justify-content: flex-end; gap: 10px;">
          <button class="secondary" onclick="closeGoatModal()" style="padding: 8px 16px; border-radius: 4px; border: 1px solid #323248; background: transparent; color: #fff; cursor: pointer;">Cancelar</button>
          <button class="primary" onclick="processGoatCard()" style="padding: 8px 16px; border-radius: 4px; border: none; background: #3699ff; color: #fff; cursor: pointer; font-weight: 600;">Processar e Preencher</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const textArea = document.getElementById("goatCardText");
  if (textArea) textArea.value = "";
  modal.classList.remove("hidden");
}

function closeGoatModal() {
  const modal = document.getElementById("goatModal");
  if (modal) modal.classList.add("hidden");
}

async function processGoatCard() {
  const textArea = document.getElementById("goatCardText");
  const text = textArea ? textArea.value.trim() : "";
  
  if (!text) {
    if (typeof toast === "function") toast("Cole o texto do card do GOAT antes de processar.");
    else alert("Cole o texto do card do GOAT antes de processar.");
    return;
  }

  try {
    const data = await api("/api/goat/parse-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (typeof toast === "function") toast("Card processado com sucesso!");
    closeGoatModal();

    const recQty = document.getElementById("recQty");
    const recVolumes = document.getElementById("recVolumes");
    const recNotes = document.getElementById("recNotes");

    if (recQty && data.quantidade_pecas) recQty.value = data.quantidade_pecas;
    if (recVolumes && data.quantidade_volumes) recVolumes.value = data.quantidade_volumes;
    if (recNotes) {
      const currentNotes = recNotes.value;
      const parsedNotes = `Lote: ${data.lote} | NF: ${data.nota_fiscal} | Compra: ${data.compra} | Fornecedor: ${data.fornecedor}`;
      recNotes.value = currentNotes ? `${currentNotes}\n${parsedNotes}` : parsedNotes;
    }

  } catch (err) {
    const errMsg = "Erro ao processar card: " + (err.message || err);
    if (typeof toast === "function") toast(errMsg);
    else alert(errMsg);
  }
}

// Cria o botão flutuante no canto superior direito para acesso imediato
function renderFloatingGoatButton() {
  if (document.getElementById("btnImportGoatFloating")) return;

  const btn = document.createElement("button");
  btn.id = "btnImportGoatFloating";
  btn.type = "button";
  btn.innerText = "+ Importar Card GOAT";
  btn.style.cssText = `
    position: fixed;
    top: 15px;
    right: 180px;
    z-index: 9999;
    padding: 8px 16px;
    background-color: #3699ff;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(54, 153, 255, 0.3);
    transition: all 0.2s ease;
  `;
  
  btn.onmouseover = () => btn.style.backgroundColor = "#187de4";
  btn.onmouseout = () => btn.style.backgroundColor = "#3699ff";
  btn.onclick = openGoatCardModal;

  document.body.appendChild(btn);
}

// Executa a injeção assim que o documento estiver pronto
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderFloatingGoatButton);
} else {
  renderFloatingGoatButton();
}
