/* Conversa entre colaboradores + Calendário. Usa api(), esc(), toast(), $() e currentUser do app.js */
let chatState = { channel: "geral", lastId: 0, users: [], timer: null };
let calState = { y: new Date().getFullYear(), m: new Date().getMonth(), events: [], sel: null, users: [], editing: null };

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const KIND_LABEL = { COMPROMISSO: "Compromisso", REUNIAO: "Reunião", PRAZO: "Prazo", LEMBRETE: "Lembrete" };

/* ------------------------------ CHAT ------------------------------ */
async function renderChat() {
  stopChatTimer();
  chatState.users = (await api("/api/users")).filter((u) => u.id !== currentUser.id);
  chatState.lastId = 0;
  $("mainContent").innerHTML = `<div class="collab-chat">
    <aside class="collab-side" id="chatSide"></aside>
    <section class="collab-main"><header id="chatTitle" class="collab-title"></header>
      <div id="chatBox" class="collab-msgs"></div>
      <div class="collab-input"><input id="chatInput" maxlength="2000" placeholder="Escreva uma mensagem e tecle Enter" onkeydown="if(event.key==='Enter')sendChat()"><button class="primary" onclick="sendChat()">Enviar</button></div>
    </section></div>`;
  await openChannel(chatState.channel);
  chatState.timer = setInterval(() => { if (!$("chatBox")) return stopChatTimer(); pollChat(); }, 4000);
}
function stopChatTimer() { if (chatState.timer) clearInterval(chatState.timer); chatState.timer = null; }
function chatChannelTitle(ch) { return ch === "geral" ? "Geral — toda a equipe" : (chatState.users.find((u) => "dm:" + u.id === ch)?.name || "Conversa"); }
async function renderChatSide() {
  const unread = await api(`/api/chat/unread?user_id=${currentUser.id}`).catch(() => ({}));
  const dmCount = (uid) => { const a = Math.min(uid, currentUser.id), b = Math.max(uid, currentUser.id); return unread[`dm:${a}:${b}`] || 0; };
  const item = (ch, label, n) => `<button class="collab-contact ${chatState.channel === ch ? "active" : ""}" onclick="openChannel('${ch}')"><span>${esc(label)}</span>${n ? `<b class="collab-badge">${n}</b>` : ""}</button>`;
  $("chatSide").innerHTML = item("geral", "# Geral", unread.geral || 0) + '<div class="collab-sep">Conversas diretas</div>' + chatState.users.map((u) => item("dm:" + u.id, u.name, dmCount(u.id))).join("");
}
async function openChannel(ch) {
  chatState.channel = ch; chatState.lastId = 0;
  $("chatTitle").textContent = chatChannelTitle(ch); $("chatBox").innerHTML = "";
  await pollChat(true); renderChatSide(); $("chatInput")?.focus();
}
async function pollChat(initial) {
  if (!$("chatBox")) return;
  const ch = chatState.channel;
  const msgs = await api(`/api/chat/messages?user_id=${currentUser.id}&channel=${encodeURIComponent(ch)}&after_id=${chatState.lastId}`).catch(() => []);
  if (ch !== chatState.channel) return;
  if (msgs.length) {
    const box = $("chatBox"), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.insertAdjacentHTML("beforeend", msgs.map((m) => `<div class="collab-msg ${m.sender_id === currentUser.id ? "mine" : ""}"><small>${esc(m.sender_name)} · ${fmtDateTime(m.created_at)}</small><div>${esc(m.body)}</div></div>`).join(""));
    chatState.lastId = msgs[msgs.length - 1].id;
    if (atEnd || initial) box.scrollTop = box.scrollHeight;
    if (!initial) renderChatSide();
  } else if (initial && !$("chatBox").children.length) {
    $("chatBox").innerHTML = '<div class="collab-empty">Nenhuma mensagem ainda. Comece a conversa!</div>';
  }
}
async function sendChat() {
  const input = $("chatInput"), body = input.value.trim();
  if (!body) return;
  try {
    await api("/api/chat/messages", { method: "POST", body: JSON.stringify({ user_id: currentUser.id, user_name: currentUser.name, channel: chatState.channel, body }) });
    input.value = ""; $("chatBox").querySelector(".collab-empty")?.remove(); await pollChat();
  } catch (e) { toast(e.message); }
}
async function refreshChatBadge() {
  if (!currentUser) return;
  const un = await api(`/api/chat/unread?user_id=${currentUser.id}`).catch(() => null);
  if (!un) return;
  const n = Object.values(un).reduce((a, b) => a + b, 0), el = $("chatNavBadge");
  if (el) { el.textContent = n; el.style.display = n ? "inline-block" : "none"; }
}
setInterval(refreshChatBadge, 20000); setTimeout(refreshChatBadge, 3000);

/* ---------------------------- CALENDÁRIO --------------------------- */
async function renderCalendar() {
  stopChatTimer();
  if (!calState.users.length) calState.users = await api("/api/users");
  const first = new Date(calState.y, calState.m, 1), start = new Date(first); start.setDate(1 - first.getDay());
  const end = new Date(start); end.setDate(start.getDate() + 42);
  calState.events = await api(`/api/calendar/events?user_id=${currentUser.id}&start=${ymd(start)}T00:00&end=${ymd(end)}T00:00`);
  const todayStr = ymd(new Date()), monthName = first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const ds = ymd(d);
    const evs = calState.events.filter((e) => e.start_at.slice(0, 10) <= ds && e.end_at.slice(0, 10) >= ds);
    cells.push(`<button class="collab-day ${d.getMonth() !== calState.m ? "other" : ""} ${ds === todayStr ? "today" : ""} ${calState.sel === ds ? "sel" : ""}" onclick="selectCalDay('${ds}')"><span>${d.getDate()}</span>${evs.slice(0, 3).map((e) => `<i class="collab-chip k-${e.kind}">${e.all_day ? "" : e.start_at.slice(11, 16) + " "}${esc(e.title)}</i>`).join("")}${evs.length > 3 ? `<em>+${evs.length - 3}</em>` : ""}</button>`);
  }
  $("mainContent").innerHTML = `<div class="collab-cal"><header class="collab-calhead"><button onclick="calNav(-1)">‹</button><h2>${esc(monthName)}</h2><button onclick="calNav(1)">›</button><button onclick="calNav(0)">Hoje</button><button class="primary" onclick="calForm(null,'${calState.sel || todayStr}')">+ Novo compromisso</button></header>
    <div class="collab-grid">${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((w) => `<div class="collab-wd">${w}</div>`).join("")}${cells.join("")}</div>
    <div id="calPanel" class="collab-panel"></div></div>`;
  if (calState.sel) renderCalDay();
}
function calNav(dir) {
  if (dir === 0) { const t = new Date(); calState.y = t.getFullYear(); calState.m = t.getMonth(); calState.sel = ymd(t); }
  else { calState.m += dir; if (calState.m < 0) { calState.m = 11; calState.y--; } if (calState.m > 11) { calState.m = 0; calState.y++; } }
  renderCalendar();
}
function selectCalDay(ds) { calState.sel = ds; calState.editing = null; renderCalendar(); }
function renderCalDay() {
  const ds = calState.sel, evs = calState.events.filter((e) => e.start_at.slice(0, 10) <= ds && e.end_at.slice(0, 10) >= ds);
  const label = new Date(ds + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const who = (e) => (e.attendee_ids.length ? e.attendee_ids.map((id) => calState.users.find((u) => u.id === id)?.name || "?").join(", ") : "Toda a equipe");
  $("calPanel").innerHTML = `<h3>${esc(label)}</h3>` + (evs.length ? evs.map((e) => `<div class="collab-event k-${e.kind}"><div><b>${esc(e.title)}</b> <small>${KIND_LABEL[e.kind]} · ${e.all_day ? "dia inteiro" : e.start_at.slice(11, 16) + "–" + e.end_at.slice(11, 16)}</small><br><small>Criado por ${esc(e.created_by_name)} · Participantes: ${esc(who(e))}</small>${e.description ? `<p>${esc(e.description)}</p>` : ""}</div>${e.created_by === currentUser.id || currentUser.role === "admin" ? `<div class="actions"><button onclick="calForm(${e.id},'${ds}')">Editar</button><button onclick="calDelete(${e.id})">Excluir</button></div>` : ""}</div>`).join("") : '<div class="collab-empty">Nada marcado para este dia.</div>') + '<div id="calFormBox"></div>';
}
function calForm(id, ds) {
  if (!calState.sel) { calState.sel = ds; }
  const e = id ? calState.events.find((x) => x.id === id) : null;
  const doForm = () => {
    if (!$("calFormBox")) { renderCalendar().then(doForm); return; }
    const att = e ? e.attendee_ids : [];
    $("calFormBox").innerHTML = `<div class="collab-form"><h4>${e ? "Editar" : "Novo"} compromisso</h4>
      <div class="form-grid"><div class="field"><label>Título</label><input id="evTitle" maxlength="120" value="${esc(e?.title || "")}"></div>
      <div class="field"><label>Tipo</label><select id="evKind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${e?.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Início</label><input id="evStart" type="datetime-local" value="${e ? e.start_at.slice(0, 16) : ds + "T09:00"}"></div>
      <div class="field"><label>Fim</label><input id="evEnd" type="datetime-local" value="${e ? e.end_at.slice(0, 16) : ds + "T10:00"}"></div>
      <div class="field"><label>Participantes (vazio = toda a equipe)</label><select id="evAtt" multiple size="5">${calState.users.filter((u) => u.id !== currentUser.id).map((u) => `<option value="${u.id}" ${att.includes(u.id) ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Descrição</label><textarea id="evDesc" rows="4" maxlength="1000">${esc(e?.description || "")}</textarea></div></div>
      <label class="collab-check"><input id="evAll" type="checkbox" ${e?.all_day ? "checked" : ""}> Dia inteiro</label>
      <div class="actions"><button class="primary" onclick="calSave(${id || "null"})">Salvar</button><button onclick="renderCalDay()">Cancelar</button></div></div>`;
  };
  doForm();
}
async function calSave(id) {
  const all = $("evAll").checked, day = (v) => v.slice(0, 10);
  const body = { user_id: currentUser.id, user_name: currentUser.name, title: $("evTitle").value, kind: $("evKind").value, description: $("evDesc").value, all_day: all,
    start_at: all ? day($("evStart").value) + "T00:00" : $("evStart").value, end_at: all ? day($("evEnd").value || $("evStart").value) + "T23:59" : $("evEnd").value,
    attendee_ids: [...$("evAtt").selectedOptions].map((o) => Number(o.value)) };
  try {
    await api(id ? `/api/calendar/events/${id}` : "/api/calendar/events", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
    toast("Compromisso salvo."); calState.sel = body.start_at.slice(0, 10); renderCalendar();
  } catch (e) { toast(e.message); }
}
async function calDelete(id) {
  if (!confirm("Excluir este compromisso?")) return;
  try { await api(`/api/calendar/events/${id}?user_id=${currentUser.id}`, { method: "DELETE" }); toast("Compromisso excluído."); renderCalendar(); } catch (e) { toast(e.message); }
}
