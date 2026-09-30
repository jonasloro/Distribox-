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


def parse_goat_card_text(raw_text: str) -> dict:
    lote_match = re.search(r'Lote\s+([\w\.]+)', raw_text, re.IGNORECASE)
    lote = lote_match.group(1) if lote_match else "N/A"

    codigo_le_match = re.search(r'código\s+([\w]+)', raw_text, re.IGNORECASE)
    codigo_le = codigo_le_match.group(1) if codigo_le_match else None

    nf_match = re.search(r'NF\s+(\d+)', raw_text, re.IGNORECASE)
    nota_fiscal = nf_match.group(1) if nf_match else "N/A"

    compra_match = re.search(r'Compra\s+#(\d+)', raw_text, re.IGNORECASE)
    compra = compra_match.group(1) if compra_match else "N/A"

    fornecedor_match = re.search(r'Fornecedor\n+([^\n]+)', raw_text)
    fornecedor = fornecedor_match.group(1).strip() if fornecedor_match else "N/A"

    tipo_match = re.search(r'Tipo\n+([^\n]+)', raw_text)
    tipo_compra = tipo_match.group(1).strip() if tipo_match else "Private Label"

    qtd_match = re.search(r'(\d+)\n+confirmado p/ envio', raw_text, re.IGNORECASE)
    qtd_pecas = int(qtd_match.group(1)) if qtd_match else 0

    skus = re.findall(r'(\d{3}\.\d{3}\.\d{2}\.\d{2}\.[\w-]+)', raw_text)

    return {
        "lote": lote,
        "codigo_le": codigo_le,
        "compra": compra,
        "nota_fiscal": nota_fiscal,
        "fornecedor": fornecedor,
        "tipo_compra": tipo_compra,
        "quantidade_pecas": qtd_pecas,
        "quantidade_volumes": 1,
        "skus": list(set(skus)),
        "status": "EM TRÂNSITO"
    }


@router.post("/parse-card")
def parse_goat_card_endpoint(payload: dict[str, str]) -> dict[str, Any]:
    raw_text = payload.get("text", "")
    if not raw_text:
        raise HTTPException(400, "O campo 'text' é obrigatório.")
    return parse_goat_card_text(raw_text)


def _iso_now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


@router.post("/create-card")
def create_transit_card(payload: dict[str, str]) -> dict[str, Any]:
    """Cria de verdade um card 'Em Trânsito' no Recebimento a partir do texto do card do GOAT."""
    raw = (payload.get("text") or "").strip()
    if not raw:
        raise HTTPException(400, "Cole o texto do card do GOAT.")
    d = parse_goat_card_text(raw)
    purchase_id = d["compra"] if d["compra"] != "N/A" else (d["lote"] if d["lote"] != "N/A" else "")
    if not purchase_id:
        raise HTTPException(422, "Não encontrei o número da compra (#...) nem o lote no texto colado.")
    now = _iso_now()
    notes = f"Lote {d['lote']} | NF {d['nota_fiscal']} | criado via card GOAT"
    con = db_connect()
    try:
        con.execute("PRAGMA foreign_keys=ON")
        if con.execute("SELECT 1 FROM cards WHERE purchase_id=?", (purchase_id,)).fetchone():
            raise HTTPException(409, f"Já existe um card para a compra {purchase_id}.")
        cur = con.execute(
            """INSERT INTO cards(purchase_id,source_created_date,supplier,original_type,purchase_mode,status_compra,
               qtd_itens,source_notes,current_sector,status,receiving_type,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (purchase_id, now[:10], d["fornecedor"], d["tipo_compra"], d["tipo_compra"], "Em Trânsito",
             d["quantidade_pecas"], notes, "RECEBIMENTO", "AGUARDANDO_RECEBIMENTO", "NOVA", now, now),
        )
        card_id = cur.lastrowid
        sku = ", ".join(d["skus"])
        con.execute(
            """INSERT INTO items(card_id,source_key,product,sku,lot,nf,expected_qty,status_kanban,source_stage,source_status_purchase)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (card_id, f"{purchase_id}|{d['lote']}|goat", f"Lote {d['lote']}", sku, d["lote"],
             "" if d["nota_fiscal"] == "N/A" else d["nota_fiscal"], d["quantidade_pecas"],
             "1.3 Compras - Em Trânsito", "TRANSITO", "Em Trânsito"),
        )
        con.execute(
            "INSERT INTO history(card_id,user_id,event_type,description,created_at) VALUES(?,?,?,?,?)",
            (card_id, None, "CRIACAO_GOAT", f"Card em trânsito criado a partir do GOAT (compra {purchase_id}).", now),
        )
        con.commit()
    finally:
        con.close()
    return {"card_id": card_id, "purchase_id": purchase_id, **d}


def register_goat_routes(app: FastAPI) -> None:
    init_goat_db()
    app.include_router(router)

# ==========================================
# TRATATIVA E CONFIRMAÇÃO DE RECEBIMENTO
# ==========================================

def process_receiving_checkin(db, item_id, casulo, qtd_volumes, qtd_pecas_recebidas, status_conferencia, observacao=""):
    """
    Processa a conferência física do item do GOAT, aloca no casulo 
    e atualiza o status de recebimento.
    """
    if not item_id:
        raise ValueError("ID do item não informado.")
    
    if not casulo or not str(casulo).strip():
        raise ValueError("É necessário informar o casulo/endereço de destino.")

    casulo_clean = str(casulo).strip().upper()
    qtd_vol = int(qtd_volumes) if qtd_volumes else 0
    qtd_pecas = int(qtd_pecas_recebidas) if qtd_pecas_recebidas else 0
    
    # Define o status do registro com base na conferência
    # Ex: 'Conforme', 'Divergente', 'Avaria'
    status_final = "Recebido" if status_conferencia == "Conforme" else f"Recebido ({status_conferencia})"

    # 1. Atualiza a tabela de recebimento
    # Funciona tanto para SQLite quanto para Supabase via interface db
    try:
        # Busca item original para manter histórico de notas
        item_atual = db.table("recebimento").select("*").eq("id", item_id).execute() if hasattr(db, "table") else None
        
        update_data = {
            "casulo": casulo_clean,
            "qtd_volumes": qtd_vol,
            "quantidade_pecas": qtd_pecas,
            "status": status_final,
            "observacao_tratativa": observacao,
            "data_recebimento": "NOW()"
        }

        if hasattr(db, "table"):
            # Supabase Client
            response = db.table("recebimento").update(update_data).eq("id", item_id).execute()
        else:
            # SQLite / Cursor direto
            cursor = db.cursor()
            cursor.execute("""
                UPDATE recebimento 
                SET casulo = ?, quantidade_volumes = ?, quantidade_pecas = ?, status = ?, observacoes = ?
                WHERE id = ?
            """, (casulo_clean, qtd_vol, qtd_pecas, status_final, observacao, item_id))
            db.commit()

        return {
            "success": True,
            "message": f"Item alocado no casulo {casulo_clean} com sucesso!",
            "casulo": casulo_clean,
            "status": status_final
        }

    except Exception as e:
        raise RuntimeError(f"Erro ao atualizar banco de dados: {str(e)}")

def process_receiving_checkin(item_id, casulo, qtd_volumes, qtd_pecas_recebidas, status_conferencia, observacao=""):
    """
    Processa a conferência física do item do GOAT, aloca no casulo 
    e atualiza o status no Supabase/SQLite.
    """
    if not item_id:
        raise ValueError("ID do item não informado.")
    
    if not casulo or not str(casulo).strip():
        raise ValueError("É necessário informar o casulo/endereço de destino.")

    casulo_clean = str(casulo).strip().upper()
    qtd_vol = int(qtd_volumes) if qtd_volumes else 0
    qtd_pecas = int(qtd_pecas_recebidas) if qtd_pecas_recebidas else 0
    
    status_final = "Recebido" if status_conferencia == "Conforme" else f"Recebido ({status_conferencia})"

    payload = {
        "casulo": casulo_clean,
        "quantidade_volumes": qtd_vol,
        "quantidade_pecas": qtd_pecas,
        "status": status_final,
        "observacao_tratativa": observacao
    }

    # Utiliza a função de atualização nativa do próprio goat_module.py
    resultado = update_recebimento(item_id, payload)
    
    if not resultado:
        raise RuntimeError("Não foi possível atualizar o registro no banco de dados.")

    return {
        "success": True,
        "message": f"Item alocado no casulo {casulo_clean} com sucesso!",
        "casulo": casulo_clean,
        "status": status_final
    }
