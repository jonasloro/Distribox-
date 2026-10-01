"""Conversa entre colaboradores + calendário de compromissos.

Grava no Supabase (Postgres) quando SUPABASE_DATABASE_URL está configurada, para
sobreviver a redeploys; sem ela (ex.: teste local) usa um SQLite separado.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("OUTLOG_DATA_DIR", str(BASE_DIR / "data"))).resolve()
LOCAL_DB = DATA_DIR / "colaboracao.db"
USE_PG = bool(os.getenv("SUPABASE_DATABASE_URL"))

router = APIRouter(prefix="/api")

_PG_DDL = """
CREATE TABLE IF NOT EXISTS chat_messages(
  id BIGSERIAL PRIMARY KEY, channel TEXT NOT NULL, sender_id INTEGER NOT NULL,
  sender_name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel,id);
CREATE TABLE IF NOT EXISTS chat_reads(
  user_id INTEGER NOT NULL, channel TEXT NOT NULL, last_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,channel));
CREATE TABLE IF NOT EXISTS calendar_events(
  id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL, end_at TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'COMPROMISSO', created_by INTEGER NOT NULL,
  created_by_name TEXT NOT NULL, attendees TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_at);
"""
_SQLITE_DDL = _PG_DDL.replace("BIGSERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT").replace("BIGINT", "INTEGER")


class _Db:
    """Camada mínima que esconde a diferença entre Postgres e SQLite."""

    def __init__(self) -> None:
        if USE_PG:
            from supabase_module import pg_connect
            self.con = pg_connect()
        else:
            os.makedirs(LOCAL_DB.parent, exist_ok=True)
            self.con = sqlite3.connect(LOCAL_DB, timeout=10)
            self.con.row_factory = sqlite3.Row

    def __enter__(self) -> "_Db":
        return self

    def __exit__(self, *exc: Any) -> None:
        try:
            self.con.rollback() if exc[0] else self.con.commit()
        finally:
            self.con.close()

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if USE_PG else sql

    def rows(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        cur = self.con.cursor()
        cur.execute(self._sql(sql), params)
        return [dict(r) for r in cur.fetchall()]

    def one(self, sql: str, params: tuple = ()) -> dict[str, Any] | None:
        r = self.rows(sql, params)
        return r[0] if r else None

    def run(self, sql: str, params: tuple = ()) -> int:
        cur = self.con.cursor()
        if USE_PG and sql.lstrip().upper().startswith("INSERT"):
            cur.execute(self._sql(sql) + " RETURNING id", params)
            return int(cur.fetchone()["id"])
        cur.execute(self._sql(sql), params)
        return int(cur.lastrowid or 0) if not USE_PG else 0


def init_collab_db() -> None:
    try:
        with _Db() as db:
            for stmt in (_PG_DDL if USE_PG else _SQLITE_DDL).split(";"):
                if stmt.strip():
                    db.run(stmt)
    except Exception as exc:  # não derruba o app se o banco estiver indisponível
        print(f"[aviso] colaboração (chat/calendário) indisponível: {exc}")


def _user(uid: int, fallback: Any = "") -> dict[str, Any]:
    """Nome e perfil vêm da tabela de usuários do app; se não achar, usa o nome informado."""
    try:
        con = sqlite3.connect(DATA_DIR / "controle_logistica.db", timeout=10)
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT name,role FROM users WHERE id=?", (uid,)).fetchone()
        con.close()
        if row:
            return {"name": row["name"], "role": row["role"]}
    except sqlite3.Error:
        pass
    return {"name": str(fallback or "").strip()[:80] or f"Usuário {uid}", "role": ""}


def _now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def _channel(user_id: int, channel: str) -> str:
    """'geral' ou 'dm:<outro>' → chave canônica ('geral' | 'dm:menor:maior')."""
    if channel == "geral":
        return "geral"
    if channel.startswith("dm:"):
        try:
            other = int(channel[3:])
        except ValueError:
            raise HTTPException(400, "Conversa inválida.")
        a, b = sorted((int(user_id), other))
        return f"dm:{a}:{b}"
    raise HTTPException(400, "Conversa inválida.")


def _uid(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise HTTPException(400, "Usuário inválido.")
    if n <= 0:
        raise HTTPException(400, "Usuário inválido.")
    return n


# ---------------------------------------------------------------- chat
@router.get("/chat/messages")
def chat_messages(user_id: int, channel: str = "geral", after_id: int = 0) -> list[dict[str, Any]]:
    ch = _channel(_uid(user_id), channel)
    with _Db() as db:
        rows = db.rows(
            "SELECT id,sender_id,sender_name,body,created_at FROM chat_messages WHERE channel=? AND id>? ORDER BY id DESC LIMIT 200",
            (ch, int(after_id)),
        )
        rows.reverse()
        if rows:
            last = rows[-1]["id"]
            if db.one("SELECT 1 x FROM chat_reads WHERE user_id=? AND channel=?", (user_id, ch)):
                db.run("UPDATE chat_reads SET last_id=? WHERE user_id=? AND channel=? AND last_id<?", (last, user_id, ch, last))
            else:
                db.run("INSERT INTO chat_reads(user_id,channel,last_id) VALUES(?,?,?)", (user_id, ch, last))
    return rows


@router.post("/chat/messages")
def chat_send(payload: dict[str, Any]) -> dict[str, Any]:
    uid = _uid(payload.get("user_id"))
    name = _user(uid, payload.get("user_name"))["name"]
    body = str(payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "Escreva uma mensagem.")
    if len(body) > 2000:
        raise HTTPException(400, "Mensagem muito longa (máx. 2000 caracteres).")
    ch = _channel(uid, str(payload.get("channel") or "geral"))
    with _Db() as db:
        mid = db.run(
            "INSERT INTO chat_messages(channel,sender_id,sender_name,body,created_at) VALUES(?,?,?,?,?)",
            (ch, uid, name, body, _now()),
        )
    return {"ok": True, "id": mid}


@router.get("/chat/unread")
def chat_unread(user_id: int) -> dict[str, int]:
    """Mensagens não lidas por conversa (geral + DMs do usuário)."""
    uid = _uid(user_id)
    with _Db() as db:
        rows = db.rows(
            """SELECT m.channel, COUNT(*) n FROM chat_messages m
               LEFT JOIN chat_reads r ON r.channel=m.channel AND r.user_id=?
               WHERE m.sender_id<>? AND m.id>COALESCE(r.last_id,0)
                 AND (m.channel='geral' OR m.channel LIKE ? OR m.channel LIKE ?)
               GROUP BY m.channel""",
            (uid, uid, f"dm:{uid}:%", f"dm:%:{uid}"),
        )
    return {r["channel"]: int(r["n"]) for r in rows}


# ------------------------------------------------------------ calendário
def _valid_dt(value: Any, label: str) -> str:
    s = str(value or "").strip()
    try:
        datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, f"{label} inválido.")
    return s


@router.get("/calendar/events")
def calendar_events(user_id: int, start: str, end: str) -> list[dict[str, Any]]:
    """Eventos do intervalo [start, end) em que o usuário criou ou foi convidado."""
    uid = _uid(user_id)
    _valid_dt(start, "Início"), _valid_dt(end, "Fim")
    with _Db() as db:
        rows = db.rows(
            """SELECT * FROM calendar_events WHERE start_at<? AND end_at>=? ORDER BY start_at""",
            (end, start),
        )
    out = []
    for r in rows:
        att = [int(x) for x in str(r["attendees"] or "").split(",") if x.strip().isdigit()]
        if r["created_by"] == uid or uid in att or not att:  # sem convidados = evento geral da equipe
            r["attendee_ids"] = att
            out.append(r)
    return out


def _event_fields(payload: dict[str, Any]) -> dict[str, Any]:
    title = str(payload.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "Informe o título do compromisso.")
    start, end = _valid_dt(payload.get("start_at"), "Início"), _valid_dt(payload.get("end_at") or payload.get("start_at"), "Fim")
    if end < start:
        raise HTTPException(400, "O fim não pode ser antes do início.")
    att = ",".join(str(_uid(a)) for a in (payload.get("attendee_ids") or []))
    kind = str(payload.get("kind") or "COMPROMISSO").upper()
    if kind not in {"COMPROMISSO", "REUNIAO", "PRAZO", "LEMBRETE"}:
        kind = "COMPROMISSO"
    return {"title": title[:120], "description": str(payload.get("description") or "")[:1000], "start_at": start,
            "end_at": end, "all_day": 1 if payload.get("all_day") else 0, "kind": kind, "attendees": att}


@router.post("/calendar/events")
def calendar_create(payload: dict[str, Any]) -> dict[str, Any]:
    uid = _uid(payload.get("user_id"))
    f = _event_fields(payload)
    name = _user(uid, payload.get("user_name"))["name"]
    with _Db() as db:
        eid = db.run(
            """INSERT INTO calendar_events(title,description,start_at,end_at,all_day,kind,created_by,created_by_name,attendees,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (f["title"], f["description"], f["start_at"], f["end_at"], f["all_day"], f["kind"], uid, name, f["attendees"], _now()),
        )
    return {"ok": True, "id": eid}


def _owned(db: _Db, event_id: int, uid: int) -> dict[str, Any]:
    ev = db.one("SELECT * FROM calendar_events WHERE id=?", (event_id,))
    if not ev:
        raise HTTPException(404, "Compromisso não encontrado.")
    if ev["created_by"] != uid and _user(uid)["role"] != "admin":
        raise HTTPException(403, "Só quem criou (ou o administrador) pode alterar este compromisso.")
    return ev


@router.patch("/calendar/events/{event_id}")
def calendar_update(event_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    uid = _uid(payload.get("user_id"))
    f = _event_fields(payload)
    with _Db() as db:
        _owned(db, event_id, uid)
        db.run(
            "UPDATE calendar_events SET title=?,description=?,start_at=?,end_at=?,all_day=?,kind=?,attendees=? WHERE id=?",
            (f["title"], f["description"], f["start_at"], f["end_at"], f["all_day"], f["kind"], f["attendees"], event_id),
        )
    return {"ok": True}


@router.delete("/calendar/events/{event_id}")
def calendar_delete(event_id: int, user_id: int) -> dict[str, Any]:
    with _Db() as db:
        _owned(db, event_id, _uid(user_id))
        db.run("DELETE FROM calendar_events WHERE id=?", (event_id,))
    return {"ok": True}


def register_collab_routes(app: FastAPI) -> None:
    app.include_router(router)
