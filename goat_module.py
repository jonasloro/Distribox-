from __future__ import annotations

import json
import os
import sqlite3
import re
from datetime import date, datetime, time as dtime
from pathlib import Path
from typing import Any
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile
from openpyxl import load_workbook

from supabase_module import pg_connect

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("OUTLOG_DATA_DIR", str(BASE_DIR / "data"))).resolve() / "controle_logistica.db"
router = APIRouter(prefix="/api/goat", tags=["GOAT"])

# Abas conhecidas do relatório "Tudo das operações" do GOAT. Se o GOAT mandar uma
# aba com outro nome, ela ainda é importada (fica em goat_records normalmente),
# só não recebe um rótulo amigável aqui.
# aba com outro nome, ela ainda é importada, só não recebe um rótulo amigável aqui.
SHEET_LABELS = {
    "Rejeitados": "Peças rejeitadas por lote/fornecedor",
    "Retrabalho": "Peças em retrabalho",
@@ -34,36 +32,34 @@
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
    """Cria as tabelas no Supabase se ainda não existirem. Se o Supabase não
    estiver configurado (SUPABASE_DATABASE_URL ausente), só avisa e segue —
    mesmo comportamento do resto do app nessa situação."""
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS goat_imports (
                        id SERIAL PRIMARY KEY,
                        filename TEXT,
                        sheets_count INTEGER,
                        rows_count INTEGER,
                        imported_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS goat_records (
                        id SERIAL PRIMARY KEY,
                        sheet TEXT NOT NULL,
                        data TEXT NOT NULL,
                        imported_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_goat_records_sheet ON goat_records(sheet);
                    """
                )
            con.commit()
    except RuntimeError as e:
        print(f"[aviso] GOAT: {e}")


def _cell(v: Any) -> Any:
@@ -89,48 +85,58 @@ async def import_report(file: UploadFile = File(...)) -> dict[str, Any]:
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
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                # Cada importação substitui o snapshot anterior — é um relatório
                # fotográfico, não um histórico incremental (igual o SGO fazia).
                cur.execute("DELETE FROM goat_records")
                for sheet_name in wb.sheetnames:
                    ws = wb[sheet_name]
                    rows_iter = ws.iter_rows(values_only=True)
                    headers = next(rows_iter, None)
                    if not headers:
                        continue
                    headers = [str(h).strip() if h else f"col{i}" for i, h in enumerate(headers)]
                    batch: list[tuple[str, str, str]] = []
                    for row in rows_iter:
                        if not any(v is not None for v in row):
                            continue
                        record = {headers[i]: _cell(row[i]) for i in range(min(len(headers), len(row)))}
                        batch.append((sheet_name, json.dumps(record, ensure_ascii=False), now))
                    if batch:
                        cur.executemany(
                            "INSERT INTO goat_records(sheet,data,imported_at) VALUES(%s,%s,%s)", batch
                        )
                        total_rows += len(batch)
                cur.execute(
                    "INSERT INTO goat_imports(filename,sheets_count,rows_count,imported_at) VALUES(%s,%s,%s,%s)",
                    (file.filename, len(wb.sheetnames), total_rows, now),
                )
            con.commit()
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return {"sheets": len(wb.sheetnames), "rows": total_rows, "imported_at": now}


def _sheet_rows(con: sqlite3.Connection, sheet: str) -> list[dict[str, Any]]:
    rows = con.execute("SELECT data FROM goat_records WHERE sheet=?", (sheet,)).fetchall()
    return [json.loads(r["data"]) for r in rows]
def _sheet_rows(cur, sheet: str) -> list[dict[str, Any]]:
    cur.execute("SELECT data FROM goat_records WHERE sheet=%s", (sheet,))
    return [json.loads(r["data"]) for r in cur.fetchall()]


@router.get("/status")
def status() -> dict[str, Any]:
    con = db_connect()
    last = con.execute("SELECT * FROM goat_imports ORDER BY id DESC LIMIT 1").fetchone()
    sheets = con.execute("SELECT sheet, COUNT(*) c FROM goat_records GROUP BY sheet").fetchall()
    con.close()
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute("SELECT * FROM goat_imports ORDER BY id DESC LIMIT 1")
                last = cur.fetchone()
                cur.execute("SELECT sheet, COUNT(*) c FROM goat_records GROUP BY sheet")
                sheets = cur.fetchall()
    except RuntimeError:
        return {"last_import": None, "sheets": []}
    return {
        "last_import": dict(last) if last else None,
        "sheets": [{"sheet": s["sheet"], "label": SHEET_LABELS.get(s["sheet"], s["sheet"]), "rows": s["c"]} for s in sheets],
@@ -139,17 +145,26 @@ def status() -> dict[str, Any]:

@router.get("/sheet/{sheet}")
def sheet_rows(sheet: str, limit: int = 100) -> dict[str, Any]:
    con = db_connect()
    rows = _sheet_rows(con, sheet)
    con.close()
    with pg_connect() as con:
        with con.cursor() as cur:
            rows = _sheet_rows(cur, sheet)
    return {"sheet": sheet, "label": SHEET_LABELS.get(sheet, sheet), "total": len(rows), "rows": rows[: max(1, min(limit, 500))]}


@router.get("/summary")
def summary() -> dict[str, Any]:
    con = db_connect()
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                rejeitados = _sheet_rows(cur, "Rejeitados")
                perdas = _sheet_rows(cur, "Perdas")
                desempenho = _sheet_rows(cur, "Desempenho de fornecedores")
                atrasadas = _sheet_rows(cur, "Entregas atrasadas")
                divergencia_compra = _sheet_rows(cur, "Compra x recebido")
                divergencia_estoque = _sheet_rows(cur, "Estocagem x esperado")
    except RuntimeError:
        rejeitados = perdas = desempenho = atrasadas = divergencia_compra = divergencia_estoque = []

    rejeitados = _sheet_rows(con, "Rejeitados")
    por_fornecedor: dict[str, dict[str, Any]] = {}
    for r in rejeitados:
        forn = r.get("Fornecedor") or "—"
@@ -158,20 +173,15 @@ def summary() -> dict[str, Any]:
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
    top_desempenho = sorted(desempenho, key=lambda x: -_num(x.get("Atrasadas hoje")))[:8]

    con.close()
    return {
        "totals": {
            "rejeitados_pecas": sum(int(_num(r.get("Peças"))) for r in rejeitados),
@@ -189,7 +199,7 @@ def summary() -> dict[str, Any]:
                "atrasadas_hoje": int(_num(d.get("Atrasadas hoje"))),
                "acerto_pct": _num(d.get("Acerto da data (%)")),
            }
            for d in desempenho
            for d in top_desempenho
        ],
    }
def parse_goat_card_text(raw_text: str) -> dict:
    """
    Processa o texto copiado diretamente do card do GOAT e retorna um
    dicionário estruturado para a criação manual do card em trânsito.
    """
    # Extração do Lote (ex: 394.a)
    lote_match = re.search(r'Lote\s+([\w\.]+)', raw_text, re.IGNORECASE)
    lote = lote_match.group(1) if lote_match else "N/A"

    # Extração do Código LE (ex: LE2e81f397)
    codigo_le_match = re.search(r'código\s+([\w]+)', raw_text, re.IGNORECASE)
    codigo_le = codigo_le_match.group(1) if codigo_le_match else None

    # Extração da Nota Fiscal (ex: 5298364)
    nf_match = re.search(r'NF\s+(\d+)', raw_text, re.IGNORECASE)
    nota_fiscal = nf_match.group(1) if nf_match else "N/A"

    # Extração da Compra (ex: 394)
    compra_match = re.search(r'Compra\s+#(\d+)', raw_text, re.IGNORECASE)
    compra = compra_match.group(1) if compra_match else "N/A"

    # Extração do Fornecedor (ex: LUPO S A)
    fornecedor_match = re.search(r'Fornecedor\n+([^\n]+)', raw_text)
    fornecedor = fornecedor_match.group(1).strip() if fornecedor_match else "N/A"

    # Extração do Tipo (ex: Private Label / Saldo)
    tipo_match = re.search(r'Tipo\n+([^\n]+)', raw_text)
    tipo_compra = tipo_match.group(1).strip() if tipo_match else "Private Label"

    # Extração da Quantidade de Peças Confirmadas (ex: 96)
    qtd_match = re.search(r'(\d+)\n+confirmado p/ envio', raw_text, re.IGNORECASE)
    qtd_pecas = int(qtd_match.group(1)) if qtd_match else 0

    # Extração de SKUs
    skus = re.findall(r'(\d{3}\.\d{3}\.\d{2}\.\d{2}\.[\w-]+)', raw_text)

    return {
        "lote": lote,
        "codigo_le": codigo_le,
        "compra": compra,
        "nota_fiscal": nota_fiscal,
        "fornecedor": fornecedor,
        "tipo_compra": tipo_compra,
        "quantidade_pecas": qtd_pecas,
        "quantidade_volumes": 1,  # Valor padrão a ser ajustado na entrada física
        "skus": list(set(skus)),
        "status": "EM TRÂNSITO"
    }
