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
          <button class="primary" onclick="processGoatCard()" style="padding: 8px 16px; border-radius: 4px; border: none; background: #3699ff; color: #fff; cursor: pointer; font-weight: 600;">Criar card em trânsito</button>
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
  const say = (m) => (typeof toast === "function" ? toast(m) : alert(m));
  if (!text) return say("Cole o texto do card do GOAT antes de criar.");
  try {
    const d = await api("/api/goat/create-card", { method: "POST", body: JSON.stringify({ text }) });
    say(`Card da compra ${d.purchase_id} criado em trânsito (${d.quantidade_pecas} peças).`);
    closeGoatModal();
    if (typeof goTo === "function") goTo("receiving"); else location.reload();
  } catch (err) {
    say("Erro ao criar card: " + (err.message || err));
  }
}
