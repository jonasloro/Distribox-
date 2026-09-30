from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, FastAPI, HTTPException

from supabase_module import pg_connect

router = APIRouter(prefix="/api/positions", tags=["Endereçamento"])

# Zonas por setor — cada zona é um local físico distinto dentro do setor.
# EC usa 1=Feminino / 2=Masculino; os demais setores com mais de uma zona
# seguem os mesmos parâmetros (casulos 01–20, níveis A/B/C).
SECTOR_ZONES: dict[str, list[str]] = {
    "RM": ["1"],
    "QA": ["1", "2"],
    "PR": ["1"],
    "ET": ["1"],
    "EC": ["1", "2"],
}
ZONE_LABELS: dict[str, str] = {"EC:1": "Feminino", "EC:2": "Masculino"}
CASULOS = [f"{i:02d}" for i in range(1, 21)]
NIVEIS = ["A", "B", "C"]


def iso_now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def init_positions_db() -> None:
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sector_positions (
                        id SERIAL PRIMARY KEY,
                        address TEXT UNIQUE NOT NULL,
                        setor TEXT NOT NULL,
                        zona TEXT NOT NULL,
                        casulo TEXT NOT NULL,
                        nivel TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS card_allocations (
                        id SERIAL PRIMARY KEY,
                        card_id INTEGER NOT NULL,
                        setor TEXT NOT NULL,
                        address TEXT NOT NULL,
                        quantidade INTEGER NOT NULL,
                        responsavel TEXT,
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_card_allocations_card ON card_allocations(card_id, setor);
                    """
                )
                cur.execute("SELECT COUNT(*) c FROM sector_positions")
                if cur.fetchone()["c"] == 0:
                    rows = []
                    for setor, zonas in SECTOR_ZONES.items():
                        for zona in zonas:
                            for casulo in CASULOS:
                                for nivel in NIVEIS:
                                    address = f"{zona}{setor}{casulo}{nivel}"
                                    rows.append((address, setor, zona, casulo, nivel))
                    cur.executemany(
                        "INSERT INTO sector_positions(address,setor,zona,casulo,nivel) VALUES(%s,%s,%s,%s,%s) ON CONFLICT (address) DO NOTHING",
                        rows,
                    )
            con.commit()
    except RuntimeError as e:
        print(f"[aviso] Endereçamento: {e}")


@router.get("")
def list_positions(setor: str, zona: Optional[str] = None) -> list[dict[str, Any]]:
    setor = setor.upper()
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                sql = """SELECT p.address,p.setor,p.zona,p.casulo,p.nivel,
                         COALESCE(SUM(a.quantidade),0) AS ocupado
                         FROM sector_positions p
                         LEFT JOIN card_allocations a ON a.address=p.address
                         WHERE p.setor=%s"""
                args: list[Any] = [setor]
                if zona:
                    sql += " AND p.zona=%s"
                    args.append(zona)
                sql += " GROUP BY p.address,p.setor,p.zona,p.casulo,p.nivel ORDER BY p.zona,p.casulo,p.nivel"
                cur.execute(sql, args)
                rows = cur.fetchall()
    except RuntimeError:
        return []
    return [
        {
            "address": r["address"], "setor": r["setor"], "zona": r["zona"],
            "zona_label": ZONE_LABELS.get(f"{r['setor']}:{r['zona']}"),
            "casulo": r["casulo"], "nivel": r["nivel"], "ocupado": int(r["ocupado"] or 0),
        }
        for r in rows
    ]


@router.get("/suggest")
def suggest_position(setor: str, zona: Optional[str] = None) -> dict[str, Any]:
    """Sugere a posição menos ocupada do setor (e zona, se informada) — a
    pessoa pode aceitar ou escolher outra na hora de alocar."""
    positions = list_positions(setor, zona)
    if not positions:
        raise HTTPException(404, "Nenhuma posição cadastrada para esse setor/zona.")
    best = min(positions, key=lambda p: p["ocupado"])
    return best


def _card_or_404(cur, card_id: int) -> dict[str, Any]:
    cur.execute("SELECT * FROM cards WHERE id=%s", (card_id,))
    card = cur.fetchone()
    if not card:
        raise HTTPException(404, "Card não encontrado.")
    return card


@router.post("/cards/{card_id}/allocate")
def allocate(card_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    setor = str(payload.get("setor") or "").upper()
    responsavel = payload.get("responsavel")
    allocations = payload.get("allocations") or []
    if setor not in SECTOR_ZONES:
        raise HTTPException(400, "Setor inválido.")
    if not allocations:
        raise HTTPException(400, "Informe ao menos uma posição e quantidade.")
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                valid = {p["address"] for p in list_positions(setor)}
                now = iso_now()
                for a in allocations:
                    address = str(a.get("address") or "")
                    qty = int(a.get("quantidade") or 0)
                    if address not in valid:
                        raise HTTPException(400, f"Posição {address} não pertence ao setor {setor}.")
                    if qty <= 0:
                        raise HTTPException(400, "Quantidade precisa ser maior que zero.")
                    cur.execute(
                        "INSERT INTO card_allocations(card_id,setor,address,quantidade,responsavel,created_at) VALUES(%s,%s,%s,%s,%s,%s)",
                        (card_id, setor, address, qty, responsavel, now),
                    )
            con.commit()
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return allocation_status(card_id, setor)


@router.get("/cards/{card_id}/status")
def allocation_status(card_id: int, setor: str) -> dict[str, Any]:
    setor = setor.upper()
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT address,SUM(quantidade) qty FROM card_allocations WHERE card_id=%s AND setor=%s GROUP BY address",
                    (card_id, setor),
                )
                rows = cur.fetchall()
    except RuntimeError:
        rows = []
    total = sum(int(r["qty"] or 0) for r in rows)
    return {"card_id": card_id, "setor": setor, "total_alocado": total,
            "posicoes": [{"address": r["address"], "quantidade": int(r["qty"] or 0)} for r in rows]}


@router.get("/cards/{card_id}/trail")
def card_trail(card_id: int) -> list[dict[str, Any]]:
    """Trilha completa do card: toda alocação, em qualquer setor, em ordem
    cronológica — é o histórico de por onde o card passou fisicamente."""
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT setor,address,quantidade,responsavel,created_at FROM card_allocations WHERE card_id=%s ORDER BY created_at",
                    (card_id,),
                )
                rows = cur.fetchall()
    except RuntimeError:
        return []
    return [dict(r) for r in rows]


def total_allocated(setor: str, card_id: int) -> int:
    """Helper síncrono usado pelos gates de avanço de setor em app.py."""
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT COALESCE(SUM(quantidade),0) t FROM card_allocations WHERE card_id=%s AND setor=%s",
                    (card_id, setor.upper()),
                )
                return int(cur.fetchone()["t"] or 0)
    except RuntimeError:
        return 0


def release_card_allocations(card_id: int) -> int:
    """Libera os endereços do card quando a produção começa (mercadoria saiu do local)."""
    with pg_connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM card_allocations WHERE card_id=%s", (card_id,))
        n = cur.rowcount
        conn.commit()
    return n


def register_positions_routes(app: FastAPI) -> None:
    app.include_router(router)
