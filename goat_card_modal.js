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
      <div class="modal-content" style="max-width: 600px; background: #1e1e2d; color: #fff; padding: 20px; border-radius: 8px; margin: 10% auto; border: 1px solid #323248;">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <h2 style="margin: 0; font-size: 1.25rem;">Importar Card do GOAT</h2>
          <button class="close-btn" onclick="closeGoatModal()" style="background: none; border: none; color: #fff; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        <div class="modal-body">
          <div class="notice" style="margin-bottom: 12px; background: #2b2b40; color: #8a8a9e; padding: 10px; border-radius: 4px; font-size: 0.9rem;">
            Copie todo o texto do card no GOAT e cole no campo abaixo.
          </div>
          <div class="field full">
            <label style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 0.85rem;">Texto Copiado do GOAT</label>
            <textarea id="goatCardText" rows="10" style="width: 100%; box-sizing: border-box; padding: 10px; background: #151521; color: #fff; border: 1px solid #323248; border-radius: 4px; font-family: inherit;" placeholder="Cole aqui o texto do card..."></textarea>
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

    // 1. Se houver um formulário de recebimento aberto na tela (modal de Card):
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

    // 2. Se a lista estiver na tela principal e for recarregar os dados:
    if (typeof loadReceivingQueue === "function") {
      loadReceivingQueue();
    } else if (typeof renderReceiving === "function") {
      renderReceiving();
    }

  } catch (err) {
    const errMsg = "Erro ao processar card: " + (err.message || err);
    if (typeof toast === "function") toast(errMsg);
    else alert(errMsg);
  }
}

// Injeta o botão tanto no topo do Recebimento quanto dentro do formulário de Card
function attachGoatButtonObserver() {
  const observer = new MutationObserver(() => {
    // A) Injeta o botão no cabeçalho principal da página de Recebimento
    const pageHeader = document.querySelector("h2") || document.querySelector("h1");
    if (pageHeader && pageHeader.innerText.includes("Recebimento")) {
      let headerContainer = pageHeader.parentElement;
      if (headerContainer && !document.getElementById("btnImportGoatHeader")) {
        const btn = document.createElement("button");
        btn.id = "btnImportGoatHeader";
        btn.type = "button";
        btn.className = "primary";
        btn.innerText = "+ Importar Card GOAT";
        btn.style.cssText = "margin-left: auto; padding: 8px 16px; background: #3699ff; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-weight: 600;";
        btn.onclick = openGoatCardModal;
        
        headerContainer.style.display = "flex";
        headerContainer.style.alignItems = "center";
        headerContainer.style.justifyContent = "space-between";
        headerContainer.appendChild(btn);
      }
    }

    // B) Injeta o botão dentro da modal de um card específico (se aberto)
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
