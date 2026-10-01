from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile
from openpyxl import load_workbook

from supabase_module import pg_connect

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("OUTLOG_DATA_DIR", str(BASE_DIR / "data"))).resolve() / "controle_logistica.db"
router = APIRouter(prefix="/api/goat", tags=["GOAT"])

SHEET_LABELS = {
    "Rejeitados": "Peças rejeitadas por lote/fornecedor",
    "Retrabalho": "Peças em retrabalho",
    "Perdas": "Perdas gerais de processo",
    "Desempenho de fornecedores": "Acompanhamento de entregas e atrasos por fornecedor",
    "Entregas atrasadas": "Lista de lotes com entrega em atraso",
    "Compra x recebido": "Divergências entre pedido de compra e físico recebido",
    "Estocagem x esperado": "Divergências no momento do endereçamento",
}


def db_connect() -> sqlite3.Connection:
    os.makedirs(DB_PATH.parent, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


def init_goat_db() -> None:
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
    except Exception as e:
        print(f"[aviso] GOAT PG init fallback to SQLite: {e}")

    try:
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
    except Exception as e:
        print(f"[erro] GOAT SQLite init error: {e}")


def _cell(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (datetime,)):
        return v.isoformat()
    return str(v)


def _num(v: Any) -> float:
    if v is None:
        return 0.0
    try:
        s = str(v).replace("R$", "").replace(".", "").replace(",", ".").strip()
        return float(s)
    except ValueError:
        return 0.0


def _get_sheet_records(sheet_name: str) -> list[dict[str, Any]]:
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute("SELECT data FROM goat_records WHERE sheet=%s", (sheet_name,))
                rows = cur.fetchall()
                res = []
                for r in rows:
                    try:
                        res.append(json.loads(r[0]))
                    except Exception:
                        pass
                if res:
                    return res
    except Exception:
        pass

    try:
        con = db_connect()
        rows = con.execute("SELECT data FROM goat_records WHERE sheet=?", (sheet_name,)).fetchall()
        con.close()
        res = []
        for r in rows:
            try:
                res.append(json.loads(r["data"]))
            except Exception:
                pass
        return res
    except Exception:
        return []


@router.post("/import")
async def import_report(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(400, "Envie um arquivo .xlsx exportado do GOAT.")

    content = await file.read()
    tmp = BASE_DIR / "_tmp_goat.xlsx"
    tmp.write_bytes(content)
    wb = load_workbook(tmp, read_only=True, data_only=True)

    now = datetime.now().replace(microsecond=0).isoformat()
    total_rows = 0

    try:
        with pg_connect() as con:
            with con.cursor() as cur:
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
                        cur.executemany("INSERT INTO goat_records(sheet,data,imported_at) VALUES(%s,%s,%s)", batch)
                        total_rows += len(batch)
                cur.execute(
                    "INSERT INTO goat_imports(filename,sheets_count,rows_count,imported_at) VALUES(%s,%s,%s,%s)",
                    (file.filename, len(wb.sheetnames), total_rows, now),
                )
            con.commit()
    except Exception as e:
        print(f"[aviso] Falha ao importar no Supabase: {e}")

    try:
        con = db_connect()
        con.execute("DELETE FROM goat_records")
        sq_total = 0
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
                sq_total += 1
        con.execute(
            "INSERT INTO goat_imports(filename,sheets_count,rows_count,imported_at) VALUES(?,?,?,?)",
            (file.filename, len(wb.sheetnames), sq_total, now),
        )
        con.commit()
        con.close()
        if total_rows == 0:
            total_rows = sq_total
    except Exception as e:
        print(f"[erro] Falha no SQLite import: {e}")
    finally:
        if tmp.exists():
            tmp.unlink()

    return {"sheets": len(wb.sheetnames), "rows": total_rows, "imported_at": now}


@router.get("/status")
def status() -> dict[str, Any]:
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute("SELECT id, filename, sheets_count, rows_count, imported_at FROM goat_imports ORDER BY id DESC LIMIT 1")
                last = cur.fetchone()
                cur.execute("SELECT sheet, COUNT(*) FROM goat_records GROUP BY sheet")
                sheets = cur.fetchall()

                last_dict = None
                if last:
                    last_dict = {
                        "id": last[0],
                        "filename": last[1],
                        "sheets_count": last[2],
                        "rows_count": last[3],
                        "imported_at": last[4],
                    }

                sheets_list = [{"sheet": s[0], "label": SHEET_LABELS.get(s[0], s[0]), "rows": s[1]} for s in sheets if s]
                return {"last_import": last_dict, "sheets": sheets_list}
    except Exception:
        pass

    try:
        con = db_connect()
        last = con.execute("SELECT * FROM goat_imports ORDER BY id DESC LIMIT 1").fetchone()
        sheets = con.execute("SELECT sheet, COUNT(*) c FROM goat_records GROUP BY sheet").fetchall()
        con.close()

        last_dict = dict(last) if last else None
        sheets_list = [{"sheet": s["sheet"], "label": SHEET_LABELS.get(s["sheet"], s["sheet"]), "rows": s["c"]} for s in sheets if s]
        return {"last_import": last_dict, "sheets": sheets_list}
    except Exception as e:
        print(f"[aviso] GOAT status error: {e}")
        return {"last_import": None, "sheets": []}


@router.get("/sheet/{sheet}")
def sheet_rows(sheet: str, limit: int = 100) -> dict[str, Any]:
    rows = _get_sheet_records(sheet)
    return {"sheet": sheet, "label": SHEET_LABELS.get(sheet, sheet), "total": len(rows), "rows": rows[: max(1, min(limit, 500))]}


@router.get("/summary")
def summary() -> dict[str, Any]:
    rejeitados = _get_sheet_records("Rejeitados")
    perdas = _get_sheet_records("Perdas")
    desempenho = _get_sheet_records("Desempenho de fornecedores")
    atrasadas = _get_sheet_records("Entregas atrasadas")
    divergencia_compra = _get_sheet_records("Compra x recebido")
    divergencia_estoque = _get_sheet_records("Estocagem x esperado")

    # Rejeitados por fornecedor
    por_fornecedor: dict[str, dict[str, Any]] = {}
    for r in rejeitados:
        if isinstance(r, dict):
            forn = r.get("Fornecedor") or "—"
            entry = por_fornecedor.setdefault(forn, {"name": forn, "pecas": 0, "valor": 0.0})
            entry["pecas"] += int(_num(r.get("Peças")))
            entry["valor"] += _num(r.get("Valor"))
    top_rejeitados = sorted(por_fornecedor.values(), key=lambda x: -x["pecas"])[:8]

    # Perdas por responsável
    por_responsavel: dict[str, dict[str, Any]] = {}
    for r in perdas:
        if isinstance(r, dict):
            quem = r.get("Quem") or "—"
            entry = por_responsavel.setdefault(quem, {"name": quem, "pecas": 0})
            entry["pecas"] += int(_num(r.get("Peças")))
    top_perdas = sorted(por_responsavel.values(), key=lambda x: -x["pecas"])[:8]

    # Fornecedores críticos (desempenho)
    desempenho_filtrado = [d for d in desempenho if isinstance(d, dict)]
    top_desempenho = sorted(desempenho_filtrado, key=lambda x: -_num(x.get("Atrasadas hoje")) if isinstance(x, dict) else 0)[:8]

    fornecedores_criticos = [
        {
            "name": d.get("Fornecedor") or "—",
            "atrasadas_hoje": int(_num(d.get("Atrasadas hoje"))),
            "acerto_pct": _num(d.get("Acerto da data (%)")),
        }
        for d in top_desempenho
    ]

    # Retorna exatamente as chaves esperadas por: renderGoatIndicators()
    return {
        "totals": {
            "rejeitados_pecas": sum(int(_num(r.get("Peças"))) for r in rejeitados if isinstance(r, dict)),
            "rejeitados_valor": sum(_num(r.get("Valor")) for r in rejeitados if isinstance(r, dict)),
            "perdas_pecas": sum(int(_num(r.get("Peças"))) for r in perdas if isinstance(r, dict)),
            "entregas_atrasadas": len(atrasadas),
            "divergencias_compra": len(divergencia_compra),
            "divergencias_estoque": len(divergencia_estoque),
        },
        "top_rejeitados_fornecedor": top_rejeitados,
        "top_perdas_responsavel": top_perdas,
        "fornecedores_criticos": fornecedores_criticos,
    }


def _manual_card_purchase_id(reference: str) -> str:
    """Gera identificador técnico único para cards criados manualmente."""
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    return f"MANUAL-{stamp}-{abs(hash(reference)) % 10000:04d}"


@router.post("/parse-card")
def parse_manual_card_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    """Valida dados manuais da grade; não interpreta texto copiado."""
    reference = str(payload.get("reference") or "").strip()
    grade = payload.get("grade") or []
    if not reference:
        raise HTTPException(400, "Informe a referência.")
    if not isinstance(grade, list) or not grade:
        raise HTTPException(400, "Informe a grade da referência.")
    normalized=[]; total=0
    for row in grade:
        color=str(row.get("color") or "").strip(); size=str(row.get("size") or "").strip()
        try: quantity=int(row.get("quantity") or 0)
        except (TypeError,ValueError): raise HTTPException(400,"As quantidades da grade precisam ser números inteiros.")
        if not color or not size: raise HTTPException(400,"Cada item da grade precisa ter cor e tamanho.")
        if quantity < 0: raise HTTPException(400,"As quantidades da grade não podem ser negativas.")
        if quantity: normalized.append({"color":color,"size":size,"quantity":quantity}); total += quantity
    if total <= 0: raise HTTPException(400,"A grade precisa ter pelo menos uma quantidade maior que zero.")
    return {"reference":reference,"grade":normalized,"expected_total":total}


def _iso_now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


@router.post("/create-card")
def create_manual_card(payload: dict[str, Any]) -> dict[str, Any]:
    """Cria um Card manual: uma única referência com uma grade dinâmica."""
    reference=str(payload.get("reference") or "").strip()
    grade=payload.get("grade") or []
    if not reference: raise HTTPException(400,"Informe a referência.")
    if not isinstance(grade,list) or not grade: raise HTTPException(400,"Informe a grade da referência.")
    normalized=[]; total=0
    for row in grade:
        color=str(row.get("color") or "").strip(); size=str(row.get("size") or "").strip()
        try: quantity=int(row.get("quantity") or 0)
        except (TypeError,ValueError): raise HTTPException(400,"As quantidades da grade precisam ser números inteiros.")
        if not color or not size: raise HTTPException(400,"Cada item da grade precisa ter cor e tamanho.")
        if quantity < 0: raise HTTPException(400,"As quantidades da grade não podem ser negativas.")
        if quantity: normalized.append((color,size,quantity)); total += quantity
    if total <= 0: raise HTTPException(400,"A grade precisa ter pelo menos uma quantidade maior que zero.")
    now=_iso_now(); purchase_id=_manual_card_purchase_id(reference)
    con=db_connect()
    try:
        con.execute("PRAGMA foreign_keys=ON")
        cur=con.execute("""INSERT INTO cards(purchase_id,source_created_date,supplier,original_type,purchase_mode,status_compra,qtd_itens,source_notes,current_sector,status,receiving_type,created_at,updated_at)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (purchase_id,now[:10],"Cadastro manual","Grade","GRADE","Em Trânsito",total,f"Referência criada manualmente: {reference}","RECEBIMENTO","EM_TRANSITO","NOVA",now,now))
        card_id=cur.lastrowid
        for color,size,quantity in normalized:
            con.execute("""INSERT INTO items(card_id,source_key,product,reference,sku,color,size,expected_qty,status_kanban,source_stage,source_status_purchase)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                        (card_id,f"{purchase_id}|{reference}|{color}|{size}",reference,reference,"",color,size,quantity,"1.3 Compras - Em Trânsito","TRANSITO","Em Trânsito"))
        con.execute("INSERT INTO history(card_id,user_id,event_type,description,created_at) VALUES(?,?,?,?,?)",
                    (card_id,None,"CRIACAO_MANUAL",f"Card criado manualmente para a referência {reference}, com {total} peças.",now))
        con.commit()
    finally: con.close()
    return {"card_id":card_id,"purchase_id":purchase_id,"reference":reference,
            "grade":[{"color":c,"size":s,"quantity":q} for c,s,q in normalized],"expected_total":total}


def register_goat_routes(app: FastAPI) -> None:
    init_goat_db()
    app.include_router(router)
# ==========================================
# TRATATIVA E CONFIRMAÇÃO DE RECEBIMENTO
# ==========================================

@router.post("/confirm-receiving")
def confirm_receiving(payload: dict[str, Any]) -> dict[str, Any]:
    """Confirma o recebimento físico de um card: volumes, peças, casulo e tratativa."""
    card_id = payload.get("id") or payload.get("item_id") or payload.get("card_id")
    casulo = str(payload.get("casulo") or "").strip().upper()
    if not card_id:
        raise HTTPException(400, "ID do card é obrigatório.")
    if not casulo:
        raise HTTPException(400, "Informe o casulo de destino.")
    try:
        card_id = int(card_id)
        vol = int(payload.get("qtd_volumes") or 0)
        pecas = int(payload.get("qtd_pecas") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "Volumes, peças e ID precisam ser números.")
    status = str(payload.get("status_conferencia") or "Conforme")
    obs = str(payload.get("observacao") or "").strip()
    now = _iso_now()
    con = db_connect()
    try:
        con.execute("PRAGMA foreign_keys=ON")
        if not con.execute("SELECT 1 FROM cards WHERE id=?", (card_id,)).fetchone():
            raise HTTPException(404, "Card não encontrado.")
        rec = con.execute(
            "SELECT id FROM receivings WHERE card_id=? AND closed_at IS NULL ORDER BY id DESC LIMIT 1", (card_id,)
        ).fetchone()
        note = f"[{status}] {obs}".strip()
        if rec:
            con.execute("UPDATE receivings SET volumes=?, received_qty=?, notes=? WHERE id=?", (vol, pecas, note, rec["id"]))
        else:
            con.execute(
                "INSERT INTO receivings(card_id,receiving_type,volumes,received_qty,notes,created_at) VALUES(?,?,?,?,?,?)",
                (card_id, "NOVA", vol, pecas, note, now),
            )
        con.execute("UPDATE cards SET casulo_current=?, updated_at=? WHERE id=?", (casulo, now, card_id))
        con.execute(
            "INSERT INTO history(card_id,user_id,event_type,description,created_at) VALUES(?,?,?,?,?)",
            (card_id, None, "CONFERENCIA", f"Conferência {status}: {pecas} peças, {vol} volumes, casulo {casulo}. {obs}".strip(), now),
        )
        con.commit()
    finally:
        con.close()
    return {"success": True, "message": f"Card alocado no casulo {casulo} com sucesso!", "casulo": casulo, "status": status}
