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
      <div class="modal-content" style="max-width: 600px; background: #fff; padding: 20px; border-radius: 8px; margin: 10% auto;">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <h2 style="margin: 0;">Importar Card do GOAT</h2>
          <button class="close-btn" onclick="closeGoatModal()" style="background: none; border: none; font-size: 20px; cursor: pointer;">&times;</button>
        </div>
        <div class="modal-body">
          <div class="notice" style="margin-bottom: 12px; background: #eef6ff; padding: 10px; border-radius: 4px;">
            Copie todo o texto do card no GOAT e cole no campo abaixo.
          </div>
          <div class="field full">
            <label style="display: block; font-weight: bold; margin-bottom: 5px;">Texto Copiado do GOAT</label>
            <textarea id="goatCardText" rows="10" style="width: 100%; box-sizing: border-box; padding: 8px;" placeholder="Cole aqui o texto do card..."></textarea>
          </div>
        </div>
        <div class="modal-footer actions" style="margin-top: 15px; display: flex; justify-content: flex-end; gap: 10px;">
          <button class="secondary" onclick="closeGoatModal()">Cancelar</button>
          <button class="primary" onclick="processGoatCard()">Processar e Preencher</button>
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

    // Preenche automaticamente os campos da tela de recebimento se estiverem abertos
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

// Injeta automaticamente o botão "+ Importar Card GOAT" assim que a tela de Recebimento abrir
function attachGoatButtonObserver() {
  const observer = new MutationObserver(() => {
    const recQty = document.getElementById("recQty");
    if (recQty) {
      const actionsDiv = recQty.closest(".panel-body")?.querySelector(".actions");
      if (actionsDiv && !document.getElementById("btnImportGoatCard")) {
        const btn = document.createElement("button");
        btn.id = "btnImportGoatCard";
        btn.type = "button";
        btn.className = "primary";
        btn.innerText = "+ Importar Card GOAT";
        btn.onclick = openGoatCardModal;
        actionsDiv.insertBefore(btn, actionsDiv.firstChild);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Inicia a observação da interface
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachGoatButtonObserver);
} else {
  attachGoatButtonObserver();
}
