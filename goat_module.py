from __future__ import annotations

import json
import os
import sqlite3
from datetime import date, datetime, time as dtime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile
from openpyxl import load_workbook

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("OUTLOG_DATA_DIR", str(BASE_DIR / "data"))).resolve() / "controle_logistica.db"
router = APIRouter(prefix="/api/goat", tags=["GOAT"])

# Abas conhecidas do relatório "Tudo das operações" do GOAT. Se o GOAT mandar uma
# aba com outro nome, ela ainda é importada (fica em goat_records normalmente),
# só não recebe um rótulo amigável aqui.
SHEET_LABELS = {
    "Rejeitados": "Peças rejeitadas por lote/fornecedor",
    "Retrabalho": "Peças em retrabalho",
    "Concluídos": "Lotes concluídos",
    "Separado para foto": "Fila de amostras para foto",
    "Devoluções": "Devoluções ao fornecedor",
    "Crédito com fornecedor": "Créditos em aberto com fornecedor",
    "Acerto por fornecedor": "Resumo de acerto por fornecedor",
    "Abatimento no boleto": "Abatimentos no boleto",
    "Perdas": "Perdas registradas",
    "Desempenho de fornecedores": "Score de desempenho por fornecedor",
    "Entregas atrasadas": "Entregas em atraso",
    "Compra x recebido": "Divergência compra x recebido",
    "Estocagem x esperado": "Divergência de contagem física",
}


def db_connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


def init_goat_db() -> None:
    con = db_connect()
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS goat_imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            sheets_count INTEGER,
            rows_count INTEGER,
            imported_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS goat_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sheet TEXT NOT NULL,
            data TEXT NOT NULL,
            imported_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_goat_records_sheet ON goat_records(sheet);
        """
    )
    con.commit()
    con.close()


def _cell(v: Any) -> Any:
    if isinstance(v, (datetime, date, dtime)):
        return v.isoformat()
    return v


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


@router.post("/import")
async def import_report(file: UploadFile = File(...)) -> dict[str, Any]:
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Envie um arquivo Excel .xlsx ou .xlsm.")
    content = await file.read()
    tmp = BASE_DIR / "data" / "import_goat.xlsx"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(content)
    wb = load_workbook(tmp, read_only=True, data_only=True)

    con = db_connect()
    # Cada importação substitui o snapshot anterior — é um relatório fotográfico,
    # não um histórico incremental.
    con.execute("DELETE FROM goat_records")
    now = datetime.now().replace(microsecond=0).isoformat()
    total_rows = 0
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows_iter = ws.iter_rows(values_only=True)
        headers = next(rows_iter, None)
        if not headers:
            continue
        headers = [str(h).strip() if h else f"col{i}" for i, h in enumerate(headers)]
        for row in rows_iter:
            if not any(v is not None for v in row):
                continue
            record = {headers[i]: _cell(row[i]) for i in range(min(len(headers), len(row)))}
            con.execute(
                "INSERT INTO goat_records(sheet,data,imported_at) VALUES(?,?,?)",
                (sheet_name, json.dumps(record, ensure_ascii=False), now),
            )
            total_rows += 1
    con.execute(
        "INSERT INTO goat_imports(filename,sheets_count,rows_count,imported_at) VALUES(?,?,?,?)",
        (file.filename, len(wb.sheetnames), total_rows, now),
    )
    con.commit()
    con.close()
    return {"sheets": len(wb.sheetnames), "rows": total_rows, "imported_at": now}


def _sheet_rows(con: sqlite3.Connection, sheet: str) -> list[dict[str, Any]]:
    rows = con.execute("SELECT data FROM goat_records WHERE sheet=?", (sheet,)).fetchall()
    return [json.loads(r["data"]) for r in rows]


@router.get("/status")
def status() -> dict[str, Any]:
    con = db_connect()
    last = con.execute("SELECT * FROM goat_imports ORDER BY id DESC LIMIT 1").fetchone()
    sheets = con.execute("SELECT sheet, COUNT(*) c FROM goat_records GROUP BY sheet").fetchall()
    con.close()
    return {
        "last_import": dict(last) if last else None,
        "sheets": [{"sheet": s["sheet"], "label": SHEET_LABELS.get(s["sheet"], s["sheet"]), "rows": s["c"]} for s in sheets],
    }


@router.get("/sheet/{sheet}")
def sheet_rows(sheet: str, limit: int = 100) -> dict[str, Any]:
    con = db_connect()
    rows = _sheet_rows(con, sheet)
    con.close()
    return {"sheet": sheet, "label": SHEET_LABELS.get(sheet, sheet), "total": len(rows), "rows": rows[: max(1, min(limit, 500))]}


@router.get("/summary")
def summary() -> dict[str, Any]:
    con = db_connect()

    rejeitados = _sheet_rows(con, "Rejeitados")
    por_fornecedor: dict[str, dict[str, Any]] = {}
    for r in rejeitados:
        forn = r.get("Fornecedor") or "—"
        entry = por_fornecedor.setdefault(forn, {"name": forn, "pecas": 0, "valor": 0.0})
        entry["pecas"] += int(_num(r.get("Peças")))
        entry["valor"] += _num(r.get("Valor"))
    top_rejeitados = sorted(por_fornecedor.values(), key=lambda x: -x["pecas"])[:8]

    perdas = _sheet_rows(con, "Perdas")
    por_responsavel: dict[str, dict[str, Any]] = {}
    for r in perdas:
        quem = r.get("Quem") or "—"
        entry = por_responsavel.setdefault(quem, {"name": quem, "pecas": 0})
        entry["pecas"] += int(_num(r.get("Peças")))
    top_perdas = sorted(por_responsavel.values(), key=lambda x: -x["pecas"])[:8]

    desempenho = sorted(_sheet_rows(con, "Desempenho de fornecedores"), key=lambda x: -_num(x.get("Atrasadas hoje")))[:8]
    atrasadas = _sheet_rows(con, "Entregas atrasadas")
    divergencia_compra = _sheet_rows(con, "Compra x recebido")
    divergencia_estoque = _sheet_rows(con, "Estocagem x esperado")

    con.close()
    return {
        "totals": {
            "rejeitados_pecas": sum(int(_num(r.get("Peças"))) for r in rejeitados),
            "rejeitados_valor": round(sum(_num(r.get("Valor")) for r in rejeitados), 2),
            "perdas_pecas": sum(int(_num(r.get("Peças"))) for r in perdas),
            "entregas_atrasadas": len(atrasadas),
            "divergencias_compra": sum(1 for r in divergencia_compra if _num(r.get("Diferença")) != 0),
            "divergencias_estoque": sum(1 for r in divergencia_estoque if _num(r.get("Diferença")) != 0),
        },
        "top_rejeitados_fornecedor": top_rejeitados,
        "top_perdas_responsavel": top_perdas,
        "fornecedores_criticos": [
            {
                "name": d.get("Fornecedor"),
                "atrasadas_hoje": int(_num(d.get("Atrasadas hoje"))),
                "acerto_pct": _num(d.get("Acerto da data (%)")),
            }
            for d in desempenho
        ],
    }


def register_goat_routes(app: FastAPI) -> None:
    app.include_router(router)
