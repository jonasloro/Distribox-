from __future__ import annotations

import os
import sqlite3
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("OUTLOG_DATA_DIR", str(BASE_DIR / "data"))).resolve() / "controle_logistica.db"
router = APIRouter(prefix="/api", tags=["Processamento"])

PROCESSING_ROLES = {"processamento", "supervisor", "admin"}
SUPERVISOR_ROLES = {"supervisor", "admin"}


def db_connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


def iso_now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def get_user(con: sqlite3.Connection, user_id: int) -> sqlite3.Row:
    row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(401, "Usuário inválido.")
    return row


def require_role(con: sqlite3.Connection, user_id: int, allowed: set[str]) -> sqlite3.Row:
    user = get_user(con, user_id)
    if user["role"] not in allowed:
        raise HTTPException(403, "Seu perfil não possui permissão para esta ação.")
    return user


def add_history(
    con: sqlite3.Connection,
    card_id: int,
    event_type: str,
    description: str,
    user_id: Optional[int] = None,
) -> None:
    con.execute(
        "INSERT INTO history(card_id,user_id,event_type,description,created_at) VALUES(?,?,?,?,?)",
        (card_id, user_id, event_type, description, iso_now()),
    )


def business_seconds_between(start: datetime, end: datetime) -> int:
    if end <= start:
        return 0
    total = 0
    current_day = start.date()
    while current_day <= end.date():
        weekday = current_day.weekday()
        if weekday <= 3:
            work_start = datetime.combine(current_day, time(8, 0))
            work_end = datetime.combine(current_day, time(18, 0))
        elif weekday == 4:
            work_start = datetime.combine(current_day, time(8, 0))
            work_end = datetime.combine(current_day, time(17, 0))
        else:
            current_day += timedelta(days=1)
            continue
        interval_start = max(start, work_start)
        interval_end = min(end, work_end)
        if interval_end > interval_start:
            total += int((interval_end - interval_start).total_seconds())
        current_day += timedelta(days=1)
    return total


def init_processing_db() -> None:
    con = db_connect()
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS processing_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'ABERTO',
            purchase_mode TEXT NOT NULL,
            brand TEXT NOT NULL,
            operation_profile TEXT NOT NULL,
            needs_triage INTEGER NOT NULL,
            needs_labeling INTEGER NOT NULL,
            label_type TEXT,
            quantity_deferred_to_storage INTEGER NOT NULL DEFAULT 0,
            processed_qty_general INTEGER NOT NULL DEFAULT 0,
            stored_qty_general INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            source_subset INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER NOT NULL,
            completed_by INTEGER,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
            FOREIGN KEY(created_by) REFERENCES users(id),
            FOREIGN KEY(completed_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS processing_item_quantities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            processing_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            processed_qty INTEGER NOT NULL DEFAULT 0,
            stored_qty INTEGER NOT NULL DEFAULT 0,
            UNIQUE(processing_id,item_id),
            FOREIGN KEY(processing_id) REFERENCES processing_records(id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS processing_workers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            processing_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'NAO_INICIADA',
            produced_qty INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE(processing_id,user_id),
            FOREIGN KEY(processing_id) REFERENCES processing_records(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS processing_timer_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            worker_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            event_at TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY(worker_id) REFERENCES processing_workers(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        """
    )
    columns = {row["name"] for row in con.execute("PRAGMA table_info(processing_records)").fetchall()}
    if "source_subset" not in columns:
        con.execute("ALTER TABLE processing_records ADD COLUMN source_subset INTEGER NOT NULL DEFAULT 0")
    con.commit()
    con.close()


def worker_timer_events(con: sqlite3.Connection, worker_id: int) -> list[sqlite3.Row]:
    return con.execute(
        "SELECT * FROM processing_timer_events WHERE worker_id=? ORDER BY id", (worker_id,)
    ).fetchall()


def worker_timer_summary(con: sqlite3.Connection, worker_id: int) -> dict[str, Any]:
    events = worker_timer_events(con, worker_id)
    state = "NAO_INICIADA"
    first_start: Optional[datetime] = None
    open_start: Optional[datetime] = None
    pause_start: Optional[datetime] = None
    final_end: Optional[datetime] = None
    business = 0
    paused = 0
    for event in events:
        moment = datetime.fromisoformat(event["event_at"])
        kind = event["event_type"]
        if kind == "START":
            state = "EM_ANDAMENTO"
            first_start = first_start or moment
            open_start = moment
        elif kind == "PAUSE" and open_start:
            business += business_seconds_between(open_start, moment)
            open_start = None
            pause_start = moment
            state = "PAUSADA"
        elif kind == "RESUME":
            if pause_start:
                paused += int((moment - pause_start).total_seconds())
            pause_start = None
            open_start = moment
            state = "EM_ANDAMENTO"
        elif kind == "FINISH":
            if open_start:
                business += business_seconds_between(open_start, moment)
                open_start = None
            if pause_start:
                paused += int((moment - pause_start).total_seconds())
                pause_start = None
            final_end = moment
            state = "CONCLUIDA"
    now = datetime.now().replace(microsecond=0)
    if state == "EM_ANDAMENTO" and open_start:
        business += business_seconds_between(open_start, now)
    if state == "PAUSADA" and pause_start:
        paused += int((now - pause_start).total_seconds())
    permanence = int(((final_end or now) - first_start).total_seconds()) if first_start else 0
    return {
        "state": state,
        "business_seconds": max(0, business),
        "paused_seconds": max(0, paused),
        "permanence_seconds": max(0, permanence),
        "started_at": first_start.isoformat() if first_start else None,
        "finished_at": final_end.isoformat() if final_end else None,
        "events": [dict(row) for row in events],
    }


def refresh_processing_card_status(con: sqlite3.Connection, processing_id: int) -> None:
    record = con.execute("SELECT * FROM processing_records WHERE id=?", (processing_id,)).fetchone()
    if not record or record["status"] != "ABERTO":
        return
    if "source_subset" in record.keys() and record["source_subset"]:
        # Uma compra importada pode ter tamanhos em setores diferentes. Nesse caso,
        # o status-mãe continua no Recebimento e somente os itens selecionados avançam.
        return
    workers = con.execute(
        "SELECT status FROM processing_workers WHERE processing_id=?", (processing_id,)
    ).fetchall()
    if not workers:
        status = "AGUARDANDO_INICIO_PROCESSAMENTO"
    elif all(row["status"] == "CONCLUIDA" for row in workers):
        status = "AGUARDANDO_CONCLUSAO_PROCESSAMENTO"
    elif any(row["status"] == "EM_ANDAMENTO" for row in workers):
        status = "EM_PROCESSAMENTO"
    elif all(row["status"] in {"PAUSADA", "CONCLUIDA"} for row in workers):
        status = "PROCESSAMENTO_PAUSADO"
    else:
        status = "AGUARDANDO_INICIO_PROCESSAMENTO"
    con.execute(
        "UPDATE cards SET status=?,updated_at=? WHERE id=?",
        (status, iso_now(), record["card_id"]),
    )


def processing_validation(con: sqlite3.Connection, processing_id: int) -> list[str]:
    record = con.execute("SELECT * FROM processing_records WHERE id=?", (processing_id,)).fetchone()
    if not record:
        return ["Processamento não encontrado."]
    errors: list[str] = []
    if not str(record["brand"] or "").strip():
        errors.append("Informe a Marca.")
    if record["operation_profile"] not in {"CADASTRO_ENTRADA", "SOMENTE_ENTRADA"}:
        errors.append("Informe o perfil da compra.")
    if record["needs_labeling"] and record["label_type"] not in {"BRANCA", "VERMELHA", "PERSONALIZADA"}:
        errors.append("Informe o tipo de etiqueta.")
    workers = con.execute(
        "SELECT * FROM processing_workers WHERE processing_id=? ORDER BY id", (processing_id,)
    ).fetchall()
    if not workers:
        errors.append("Nenhum colaborador assumiu o Processamento.")
    elif any(row["status"] != "CONCLUIDA" for row in workers):
        errors.append("Todos os colaboradores precisam finalizar sua produção.")

    worker_total = sum(int(row["produced_qty"] or 0) for row in workers)
    if record["purchase_mode"] == "SALDO":
        processed_total = int(record["processed_qty_general"] or 0)
        if processed_total <= 0:
            errors.append("Informe a quantidade geral processada.")
    else:
        item_rows = con.execute(
            """SELECT pi.*,i.product,i.color,i.size FROM processing_item_quantities pi
               JOIN items i ON i.id=pi.item_id WHERE pi.processing_id=? ORDER BY pi.id""",
            (processing_id,),
        ).fetchall()
        processed_total = sum(int(row["processed_qty"] or 0) for row in item_rows)
        if not record["quantity_deferred_to_storage"]:
            pending = [row for row in item_rows if int(row["processed_qty"] or 0) <= 0]
            if pending:
                errors.append(f"Informe a quantidade processada de todos os itens da Grade ({len(pending)} pendente(s)).")
        elif processed_total == 0:
            # Regra aprovada: em algumas Grades a quantidade final será conhecida somente na Estocagem.
            processed_total = 0

    if processed_total > 0 and worker_total != processed_total:
        errors.append(
            f"A produção dos colaboradores ({worker_total}) deve fechar a quantidade processada ({processed_total})."
        )
    if processed_total == 0 and worker_total > 0:
        errors.append("Há produção apontada por colaboradores, mas nenhuma quantidade processada registrada.")
    return errors


def processing_card_data(con: sqlite3.Connection, card_id: int) -> Optional[dict[str, Any]]:
    record = con.execute(
        """SELECT pr.*,u1.name created_by_name,u2.name completed_by_name
           FROM processing_records pr
           LEFT JOIN users u1 ON u1.id=pr.created_by
           LEFT JOIN users u2 ON u2.id=pr.completed_by
           WHERE pr.card_id=? ORDER BY pr.id DESC LIMIT 1""",
        (card_id,),
    ).fetchone()
    if not record:
        return None
    data = dict(record)
    item_rows = con.execute(
        """SELECT pi.*,i.product,i.reference,i.sku,i.color,i.size,i.expected_qty
           FROM processing_item_quantities pi JOIN items i ON i.id=pi.item_id
           WHERE pi.processing_id=? ORDER BY i.product,i.color,i.size,i.id""",
        (record["id"],),
    ).fetchall()
    data["items"] = [dict(row) for row in item_rows]
    worker_rows = con.execute(
        """SELECT pw.*,u.name user_name FROM processing_workers pw
           JOIN users u ON u.id=pw.user_id WHERE pw.processing_id=? ORDER BY pw.id""",
        (record["id"],),
    ).fetchall()
    workers: list[dict[str, Any]] = []
    for row in worker_rows:
        worker = dict(row)
        worker["timer"] = worker_timer_summary(con, row["id"])
        workers.append(worker)
    data["workers"] = workers
    if data.get("source_subset"):
        expected_total = sum(int(row["expected_qty"] or 0) for row in item_rows)
    else:
        expected_total = con.execute(
            "SELECT COALESCE(SUM(expected_qty),0) total FROM items WHERE card_id=?", (card_id,)
        ).fetchone()["total"]
    processed_total = (
        int(record["processed_qty_general"] or 0)
        if record["purchase_mode"] == "SALDO"
        else sum(int(row["processed_qty"] or 0) for row in item_rows)
    )
    stored_total = (
        int(record["stored_qty_general"] or 0)
        if record["purchase_mode"] == "SALDO"
        else sum(int(row["stored_qty"] or 0) for row in item_rows)
    )
    data["totals"] = {
        "expected": int(expected_total or 0),
        "processed": processed_total,
        "stored": stored_total,
        "worker_production": sum(int(row["produced_qty"] or 0) for row in worker_rows),
    }
    data["validation_errors"] = processing_validation(con, record["id"]) if record["status"] == "ABERTO" else []
    return data


@router.get("/processing/users")
def list_processing_users():
    con = db_connect()
    rows = con.execute(
        "SELECT id,username,name,role FROM users WHERE role='processamento' ORDER BY name"
    ).fetchall()
    con.close()
    return [dict(row) for row in rows]


@router.post("/cards/{card_id}/processing")
async def create_processing(card_id: int, request: Request):
    payload = await request.json()
    user_id = int(payload.get("user_id") or 0)
    brand = str(payload.get("brand") or "").strip()
    profile = str(payload.get("operation_profile") or "").strip().upper()
    needs_triage_raw = payload.get("needs_triage")
    needs_labeling_raw = payload.get("needs_labeling")
    label_type = str(payload.get("label_type") or "").strip().upper() or None
    defer = bool(payload.get("quantity_deferred_to_storage"))
    notes = str(payload.get("notes") or "").strip()
    requested_item_ids = {int(value) for value in (payload.get("item_ids") or []) if str(value).isdigit()}
    if not brand:
        raise HTTPException(400, "Informe a Marca.")
    if profile not in {"CADASTRO_ENTRADA", "SOMENTE_ENTRADA"}:
        raise HTTPException(400, "Selecione Cadastro + Entrada ou Somente Entrada.")
    if needs_triage_raw is None or needs_labeling_raw is None:
        raise HTTPException(400, "Informe se a compra precisa de Triagem e Etiquetagem.")
    needs_triage = 1 if bool(needs_triage_raw) else 0
    needs_labeling = 1 if bool(needs_labeling_raw) else 0
    if needs_labeling and label_type not in {"BRANCA", "VERMELHA", "PERSONALIZADA"}:
        raise HTTPException(400, "Selecione o tipo de etiqueta.")
    if not needs_labeling:
        label_type = None

    con = db_connect()
    actor = require_role(con, user_id, PROCESSING_ROLES)
    card = con.execute("SELECT * FROM cards WHERE id=?", (card_id,)).fetchone()
    if not card:
        con.close()
        raise HTTPException(404, "Card não encontrado.")
    source_subset = bool(card["source_snapshot_at"] and card["current_sector"] != "PROCESSAMENTO")
    eligible_items = []
    if source_subset:
        eligible_items = con.execute(
            """SELECT id,expected_qty FROM items WHERE card_id=?
               AND source_stage IN ('AGUARDANDO_PROCESSAMENTO','PROCESSAMENTO') ORDER BY id""",
            (card_id,),
        ).fetchall()
        eligible_ids = {int(row["id"]) for row in eligible_items}
        if requested_item_ids:
            if not requested_item_ids.issubset(eligible_ids):
                con.close()
                raise HTTPException(400, "Um ou mais itens selecionados não estão disponíveis para o Processamento.")
            eligible_items = [row for row in eligible_items if int(row["id"]) in requested_item_ids]
        if not eligible_items:
            con.close()
            raise HTTPException(400, "Não há itens importados disponíveis para o Processamento.")
    elif card["current_sector"] != "PROCESSAMENTO":
        con.close()
        raise HTTPException(400, "O Card não está no Processamento.")
    mode = str(card["purchase_mode"] or "").upper()
    if mode not in {"GRADE", "SALDO"}:
        con.close()
        raise HTTPException(400, "O tipo da compra não foi reconhecido na importação.")
    if mode == "SALDO":
        defer = False
    existing = con.execute(
        "SELECT id FROM processing_records WHERE card_id=? AND status='ABERTO'", (card_id,)
    ).fetchone()
    if existing:
        con.close()
        raise HTTPException(400, "Já existe um Processamento aberto para este Card.")
    cur = con.execute(
        """INSERT INTO processing_records(card_id,status,purchase_mode,brand,operation_profile,needs_triage,
           needs_labeling,label_type,quantity_deferred_to_storage,notes,source_subset,created_by,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            card_id,
            "ABERTO",
            mode,
            brand,
            profile,
            needs_triage,
            needs_labeling,
            label_type,
            1 if defer else 0,
            notes,
            1 if source_subset else 0,
            user_id,
            iso_now(),
        ),
    )
    processing_id = cur.lastrowid
    if mode == "GRADE" or source_subset:
        items = eligible_items if source_subset else con.execute(
            "SELECT id FROM items WHERE card_id=? ORDER BY id", (card_id,)
        ).fetchall()
        for item in items:
            con.execute(
                "INSERT INTO processing_item_quantities(processing_id,item_id) VALUES(?,?)",
                (processing_id, item["id"]),
            )
    if source_subset:
        item_ids = [int(row["id"]) for row in eligible_items]
        marks = ",".join("?" for _ in item_ids)
        con.execute(f"UPDATE items SET source_stage='PROCESSAMENTO' WHERE id IN ({marks})", item_ids)
        con.execute("UPDATE cards SET brand=?,updated_at=? WHERE id=?", (brand, iso_now(), card_id))
    else:
        con.execute(
            "UPDATE cards SET brand=?,status='AGUARDANDO_INICIO_PROCESSAMENTO',updated_at=? WHERE id=?",
            (brand, iso_now(), card_id),
        )
    defer_text = " Quantidade final será confirmada na Estocagem." if defer else ""
    add_history(
        con,
        card_id,
        "PROCESSAMENTO_CONFIGURADO",
        f"{actor['name']} configurou o Processamento: tipo {mode}, perfil {profile.replace('_', ' + ')}, "
        f"Triagem {'Sim' if needs_triage else 'Não'}, Etiquetagem {'Sim' if needs_labeling else 'Não'}."
        + (f" {len(eligible_items)} item(ns) importado(s) selecionado(s)." if source_subset else "") + defer_text,
        user_id,
    )
    con.commit()
    detail = processing_card_data(con, card_id)
    con.close()
    return detail


@router.patch("/processing/{processing_id}/configuration")
async def update_processing_configuration(processing_id: int, request: Request):
    payload = await request.json()
    user_id = int(payload.get("user_id") or 0)
    brand = str(payload.get("brand") or "").strip()
    profile = str(payload.get("operation_profile") or "").strip().upper()
    needs_triage_raw = payload.get("needs_triage")
    needs_labeling_raw = payload.get("needs_labeling")
    label_type = str(payload.get("label_type") or "").strip().upper() or None
    defer = bool(payload.get("quantity_deferred_to_storage"))
    notes = str(payload.get("notes") or "").strip()
    if not brand or profile not in {"CADASTRO_ENTRADA", "SOMENTE_ENTRADA"}:
        raise HTTPException(400, "Informe Marca e perfil da compra.")
    if needs_triage_raw is None or needs_labeling_raw is None:
        raise HTTPException(400, "Informe Triagem e Etiquetagem.")
    needs_triage = 1 if bool(needs_triage_raw) else 0
    needs_labeling = 1 if bool(needs_labeling_raw) else 0
    if needs_labeling and label_type not in {"BRANCA", "VERMELHA", "PERSONALIZADA"}:
        raise HTTPException(400, "Selecione o tipo de etiqueta.")
    if not needs_labeling:
        label_type = None
    con = db_connect()
    actor = require_role(con, user_id, PROCESSING_ROLES)
    record = con.execute("SELECT * FROM processing_records WHERE id=?", (processing_id,)).fetchone()
    if not record or record["status"] != "ABERTO":
        con.close()
        raise HTTPException(400, "O Processamento não está aberto.")
    if record["purchase_mode"] == "SALDO":
        defer = False
    con.execute(
        """UPDATE processing_records SET brand=?,operation_profile=?,needs_triage=?,needs_labeling=?,label_type=?,
           quantity_deferred_to_storage=?,notes=? WHERE id=?""",
        (brand, profile, needs_triage, needs_labeling, label_type, 1 if defer else 0, notes, processing_id),
    )
    con.execute("UPDATE cards SET brand=?,updated_at=? WHERE id=?", (brand, iso_now(), record["card_id"]))
    add_history(con, record["card_id"], "PROCESSAMENTO_CONFIGURADO", f"{actor['name']} atualizou a configuração do Processamento.", user_id)
    con.commit()
    detail = processing_card_data(con, record["card_id"])
    con.close()
    return detail


@router.post("/processing/{processing_id}/workers")
async def add_processing_worker(processing_id: int, request: Request):
    payload = await request.json()
    user_id = int(payload.get("user_id") or 0)
    worker_user_id = int(payload.get("worker_user_id") or 0)
    con = db_connect()
    actor = require_role(con, user_id, PROCESSING_ROLES)
    record = con.execute("SELECT * FROM processing_records WHERE id=?", (processing_id,)).fetchone()
    if not record or record["status"] != "ABERTO":
        con.close()
        raise HTTPException(400, "O Processamento não está aberto.")
    target = con.execute("SELECT * FROM users WHERE id=?", (worker_user_id,)).fetchone()
    if not target or target["role"] != "processamento":
        con.close()
        raise HTTPException(400, "Selecione um operador do Processamento.")
    if actor["role"] == "processamento" and worker_user_id != user_id:
        con.close()
        raise HTTPException(403, "O operador pode assumir somente para si próprio.")
    try:
        con.execute(
            "INSERT INTO processing_workers(processing_id,user_id,created_at) VALUES(?,?,?)",
            (processing_id, worker_user_id, iso_now()),
        )
    except sqlite3.IntegrityError:
        con.close()
        raise HTTPException(400, "Este colaborador já está no Processamento.")
    add_history(
        con,
        record["card_id"],
        "PROCESSAMENTO_ASSUMIDO",
        f"{target['name']} foi incluído no Processamento por {actor['name']}.",
        user_id,
    )
    refresh_processing_card_status(con, processing_id)
    con.commit()
    detail = processing_card_data(con, record["card_id"])
    con.close()
    return detail


@router.patch("/processing/workers/{worker_id}/production")
async def save_worker_production(worker_id: int, request: Request):
    payload = await request.json()
    user_id = int(payload.get("user_id") or 0)
    produced_qty = int(payload.get("produced_qty") or 0)
    if produced_qty < 0:
        raise HTTPException(400, "A quantidade produzida não pode ser negativa.")
    con = db_connect()
    actor = require_role(con, user_id, PROCESSING_ROLES)
    worker = con.execute(
        """SELECT pw.*,pr.card_id,pr.status processing_status,u.name worker_name
           FROM processing_workers pw JOIN processing_records pr ON pr.id=pw.processing_id
           JOIN users u ON u.id=pw.user_id WHERE pw.id=?""",
        (worker_id,),
    ).fetchone()
    if not worker or worker["processing_status"] != "ABERTO":
        con.close()
        raise HTTPException(400, "O apontamento não está disponível.")
    if actor["role"] == "processamento" and worker["user_id"] != user_id:
        con.close()
        raise HTTPException(403, "Você pode alterar somente a sua produção.")
    con.execute("UPDATE processing_workers SET produced_qty=? WHERE id=?", (produced_qty, worker_id))
    add_history(con, worker["card_id"], "PRODUCAO_PROCESSAMENTO", f"Produção de {worker['worker_name']} atualizada para {produced_qty} peças.", user_id)
    con.commit()
    detail = processing_card_data(con, worker["card_id"])
    con.close()
    return detail


@router.post("/processing/workers/{worker_id}/timer/{action}")
async def processing_timer_action(worker_id: int, action: str, request: Request):
    payload = await request.json()
    user_id = int(payload.get("user_id") or 0)
    con = db_connect()
    actor = require_role(con, user_id, PROCESSING_ROLES)
    worker = con.execute(
        """SELECT pw.*,pr.card_id,pr.status processing_status,u.name worker_name
           FROM processing_workers pw JOIN processing_records pr ON pr.id=pw.processing_id
           JOIN users u ON u.id=pw.user_id WHERE pw.id=?""",
        (worker_id,),
    ).fetchone()
    if not worker or worker["processing_status"] != "ABERTO":
        con.close()
        raise HTTPException(400, "O Processamento não está aberto.")
    if actor["role"] == "processamento" and worker["user_id"] != user_id:
        con.close()
        raise HTTPException(403, "Você pode controlar somente o seu cronômetro.")
    state = worker_timer_summary(con, worker_id)["state"]
    rules = {
        "start": ("NAO_INICIADA", "START", "EM_ANDAMENTO"),
        "pause": ("EM_ANDAMENTO", "PAUSE", "PAUSADA"),
        "resume": ("PAUSADA", "RESUME", "EM_ANDAMENTO"),
        "finish": (("EM_ANDAMENTO", "PAUSADA"), "FINISH", "CONCLUIDA"),
    }
    if action not in rules:
        con.close()
        raise HTTPException(400, "Ação inválida.")
    allowed, event_type, new_state = rules[action]
    valid = state in allowed if isinstance(allowed, tuple) else state == allowed
    if not valid:
        con.close()
        raise HTTPException(400, f"Ação incompatível com o estado atual: {state}.")
    if action == "finish" and int(worker["produced_qty"] or 0) < 0:
        con.close()
        raise HTTPException(400, "Informe a produção do colaborador.")
    con.execute(
        "INSERT INTO processing_timer_events(worker_id,event_type,event_at,user_id) VALUES(?,?,?,?)",
        (worker_id, event_type, iso_now(), user_id),
    )
    con.execute(
        "UPDATE processing_workers SET status=?,completed_at=? WHERE id=?",
        (new_state, iso_now() if new_state == "CONCLUIDA" else None, worker_id),
    )
    verbs = {"start": "iniciou", "pause": "pausou", "resume": "retomou", "finish": "finalizou"}
    add_history(con, worker["card_id"], "TEMPO_PROCESSAMENTO", f"{worker['worker_name']} {verbs[action]} o Processamento.", user_id)
    refresh_processing_card_status(con, worker["processing_id"])
    con.commit()
    detail = processing_card_data(con, worker["card_id"])
    con.close()
    return detail


@router.patch("/processing/{processing_id}/quantities")
async def save_processing_quantities(processing_id: int, request: Request):
    payload = await request.json()
    user_id = int(payload.get("user_id") or 0)
    con = db_connect()
    actor = require_role(con, user_id, PROCESSING_ROLES)
    record = con.execute("SELECT * FROM processing_records WHERE id=?", (processing_id,)).fetchone()
    if not record or record["status"] != "ABERTO":
        con.close()
        raise HTTPException(400, "O Processamento não está aberto.")
    if record["purchase_mode"] == "SALDO":
        qty = int(payload.get("processed_qty_general") or 0)
        if qty < 0:
            con.close()
            raise HTTPException(400, "A quantidade não pode ser negativa.")
        con.execute("UPDATE processing_records SET processed_qty_general=? WHERE id=?", (qty, processing_id))
        description = f"{actor['name']} registrou {qty} peças processadas na compra Saldo."
    else:
        entries = payload.get("items") or []
        valid_ids = {
            int(row["item_id"]): row
            for row in con.execute(
                "SELECT * FROM processing_item_quantities WHERE processing_id=?", (processing_id,)
            ).fetchall()
        }
        seen: set[int] = set()
        for entry in entries:
            item_id = int(entry.get("item_id") or 0)
            qty = int(entry.get("processed_qty") or 0)
            if item_id not in valid_ids:
                con.close()
                raise HTTPException(400, "Foi informado um item que não pertence ao Processamento.")
            if item_id in seen:
                con.close()
                raise HTTPException(400, "O mesmo item foi informado mais de uma vez.")
            if qty < 0:
                con.close()
                raise HTTPException(400, "As quantidades não podem ser negativas.")
            seen.add(item_id)
            con.execute(
                "UPDATE processing_item_quantities SET processed_qty=? WHERE processing_id=? AND item_id=?",
                (qty, processing_id, item_id),
            )
        description = f"{actor['name']} atualizou as quantidades processadas por item da Grade."
    add_history(con, record["card_id"], "QUANTIDADE_PROCESSADA", description, user_id)
    con.commit()
    detail = processing_card_data(con, record["card_id"])
    con.close()
    return detail


@router.post("/processing/{processing_id}/copy-stored")
async def copy_stored_to_processed(processing_id: int, request: Request):
    payload = await request.json()
    user_id = int(payload.get("user_id") or 0)
    con = db_connect()
    actor = require_role(con, user_id, PROCESSING_ROLES)
    record = con.execute("SELECT * FROM processing_records WHERE id=?", (processing_id,)).fetchone()
    if not record or record["status"] != "ABERTO":
        con.close()
        raise HTTPException(400, "O Processamento não está aberto.")
    if record["purchase_mode"] == "SALDO":
        stored = int(record["stored_qty_general"] or 0)
        if stored <= 0:
            con.close()
            raise HTTPException(400, "Ainda não existe quantidade estocada para copiar.")
        con.execute("UPDATE processing_records SET processed_qty_general=? WHERE id=?", (stored, processing_id))
    else:
        rows = con.execute(
            "SELECT * FROM processing_item_quantities WHERE processing_id=?", (processing_id,)
        ).fetchall()
        if not rows or sum(int(row["stored_qty"] or 0) for row in rows) <= 0:
            con.close()
            raise HTTPException(400, "Ainda não existem quantidades estocadas por item para copiar.")
        con.execute(
            "UPDATE processing_item_quantities SET processed_qty=stored_qty WHERE processing_id=?",
            (processing_id,),
        )
    add_history(con, record["card_id"], "COPIA_ESTOCAGEM_PROCESSAMENTO", f"{actor['name']} copiou a quantidade estocada para a quantidade processada.", user_id)
    con.commit()
    detail = processing_card_data(con, record["card_id"])
    con.close()
    return detail


@router.post("/processing/{processing_id}/complete")
async def complete_processing(processing_id: int, request: Request):
    payload = await request.json()
    user_id = int(payload.get("user_id") or 0)
    con = db_connect()
    actor = require_role(con, user_id, PROCESSING_ROLES)
    record = con.execute("SELECT * FROM processing_records WHERE id=?", (processing_id,)).fetchone()
    if not record:
        con.close()
        raise HTTPException(404, "Processamento não encontrado.")
    if record["status"] != "ABERTO":
        con.close()
        raise HTTPException(400, "O Processamento já foi concluído.")
    errors = processing_validation(con, processing_id)
    if errors:
        con.close()
        raise HTTPException(400, "Não é possível concluir: " + " | ".join(errors[:12]))
    if record["needs_triage"]:
        next_sector, next_status, route_text = "TRIAGEM", "AGUARDANDO_TRIAGEM", "Card encaminhado à Triagem."
    elif record["needs_labeling"]:
        next_sector, next_status, route_text = "ETIQUETAGEM", "AGUARDANDO_ETIQUETAGEM", "Card encaminhado à Etiquetagem."
    else:
        next_sector, next_status, route_text = "ESTOCAGEM", "AGUARDANDO_ESTOCAGEM", "Card encaminhado à Estocagem."
    now = iso_now()
    con.execute(
        "UPDATE processing_records SET status='CONCLUIDO',completed_by=?,completed_at=? WHERE id=?",
        (user_id, now, processing_id),
    )
    if "source_subset" in record.keys() and record["source_subset"]:
        stage = "TRIAGEM" if record["needs_triage"] else "ETIQUETAGEM" if record["needs_labeling"] else "ESTOCAGEM"
        item_ids = [row["item_id"] for row in con.execute(
            "SELECT item_id FROM processing_item_quantities WHERE processing_id=?", (processing_id,)
        ).fetchall()]
        if item_ids:
            marks = ",".join("?" for _ in item_ids)
            con.execute(f"UPDATE items SET source_stage=? WHERE id IN ({marks})", (stage, *item_ids))
        con.execute("UPDATE cards SET updated_at=? WHERE id=?", (now, record["card_id"]))
        route_text = f"Itens selecionados encaminhados a {stage.title()}; o Card-mãe permanece no Recebimento."
    else:
        con.execute(
            "UPDATE cards SET current_sector=?,status=?,updated_at=? WHERE id=?",
            (next_sector, next_status, now, record["card_id"]),
        )
    add_history(con, record["card_id"], "PROCESSAMENTO_CONCLUIDO", f"{actor['name']} concluiu o Processamento. {route_text}", user_id)
    con.commit()
    detail = processing_card_data(con, record["card_id"])
    con.close()
    return detail


def register_processing_routes(app: FastAPI) -> None:
    app.include_router(router)

