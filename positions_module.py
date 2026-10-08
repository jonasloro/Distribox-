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
                        created_at TEXT NOT NULL,
                        item_id INTEGER
                    );
                    CREATE INDEX IF NOT EXISTS idx_card_allocations_card ON card_allocations(card_id, setor);
                    """
                )
                cur.execute(
                    "ALTER TABLE card_allocations ADD COLUMN IF NOT EXISTS item_id INTEGER"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_card_allocations_item "
                    "ON card_allocations(item_id, setor, address)"
                )
                cur.execute(
                    """CREATE TABLE IF NOT EXISTS outlog_migrations (
                        version TEXT PRIMARY KEY,
                        applied_at TEXT NOT NULL DEFAULT now()::text
                    )"""
                )
                cur.execute(
                    """INSERT INTO outlog_migrations(version)
                       VALUES(%s) ON CONFLICT (version) DO NOTHING""",
                    ("reset-card-allocations-2026-10-01",),
                )
                if cur.rowcount == 1:
                    cur.execute("DELETE FROM card_allocations")
                    print("[migracao] Alocações de peças zeradas; tabela card_allocations preservada.")
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
                         LEFT JOIN card_allocations a ON a.address=p.address AND a.setor=p.setor
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


GLOBAL_ALLOCATION_SECTORS = ("RM", "QA", "PR")


def _card_or_404(cur, card_id: int, lock: bool = False) -> dict[str, Any]:
    # lock=True serializa alocações simultâneas do mesmo card (evita estourar o saldo)
    cur.execute("SELECT * FROM outlog_cards WHERE id=%s" + (" FOR UPDATE" if lock else ""), (card_id,))
    card = cur.fetchone()
    if not card:
        raise HTTPException(404, "Card não encontrado.")
    return card


def _card_total_volumes(cur, card_id: int) -> Optional[int]:
    """Volumes do Card informados no Recebimento (espelho no Supabase).
    Retorna None enquanto ainda não foram informados — sem limite a aplicar."""
    cur.execute(
        "SELECT volumes FROM outlog_receivings WHERE card_id=%s ORDER BY id DESC LIMIT 1",
        (card_id,),
    )
    row = cur.fetchone()
    vol = int(row["volumes"]) if row and row["volumes"] is not None else 0
    return vol if vol > 0 else None


def _global_allocated(cur, card_id: int) -> int:
    """Total alocado do Card somando RM + QA + PR (saldo único, em volumes)."""
    cur.execute(
        "SELECT COALESCE(SUM(quantidade),0) t FROM card_allocations WHERE card_id=%s AND setor = ANY(%s)",
        (card_id, list(GLOBAL_ALLOCATION_SECTORS)),
    )
    return int(cur.fetchone()["t"] or 0)


def _sector_scope(setor: Optional[str]) -> list[str]:
    """RM, QA e PR dividem um saldo global; qualquer outro setor conta isolado."""
    s = (setor or "RM").upper()
    return list(GLOBAL_ALLOCATION_SECTORS) if s in GLOBAL_ALLOCATION_SECTORS else [s]


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
                _card_or_404(cur, card_id, lock=True)
                valid = {p["address"] for p in list_positions(setor)}
                now = iso_now()
                is_global = setor in GLOBAL_ALLOCATION_SECTORS
                total_volumes = _card_total_volumes(cur, card_id) if is_global else None
                alocado_global = _global_allocated(cur, card_id) if is_global else 0

                for a in allocations:
                    address = str(a.get("address") or "")
                    qty = int(a.get("quantidade") or 0)
                    item_id = int(a.get("item_id") or 0)

                    if address not in valid:
                        raise HTTPException(400, f"Posição {address} não pertence ao setor {setor}.")
                    if qty <= 0:
                        raise HTTPException(400, "Quantidade precisa ser maior que zero.")
                    if item_id <= 0:
                        raise HTTPException(400, "Selecione a referência antes de alocar.")

                    cur.execute(
                        "SELECT id,expected_qty,product,reference,sku,color,size FROM outlog_items WHERE id=%s AND card_id=%s",
                        (item_id, card_id),
                    )
                    item = cur.fetchone()
                    if not item:
                        raise HTTPException(400, "A referência selecionada não pertence a este Card.")

                    if is_global:
                        # Saldo único do Card (volumes): RM, QA e PR saem do mesmo total.
                        if total_volumes is not None and alocado_global + qty > total_volumes:
                            restante = max(0, total_volumes - alocado_global)
                            raise HTTPException(
                                400,
                                f"Saldo insuficiente: o Card tem {total_volumes} volume(s), "
                                f"{alocado_global} já alocado(s) (RM + QA + PR) e restam {restante}.",
                            )
                        alocado_global += qty
                    else:
                        cur.execute(
                            """SELECT COALESCE(SUM(quantidade),0) qty
                               FROM card_allocations
                               WHERE card_id=%s AND setor=%s AND item_id=%s""",
                            (card_id, setor, item_id),
                        )
                        already = int(cur.fetchone()["qty"] or 0)
                        expected = int(item["expected_qty"] or 0)
                        if already + qty > expected:
                            label = item["reference"] or item["sku"] or item["product"] or str(item_id)
                            raise HTTPException(
                                400,
                                f"A referência {label} possui {expected} peças previstas e já tem {already} alocadas.",
                            )

                    cur.execute(
                        """INSERT INTO card_allocations(
                               card_id,setor,address,quantidade,responsavel,created_at,item_id
                           ) VALUES(%s,%s,%s,%s,%s,%s,%s)""",
                        (card_id, setor, address, qty, responsavel, now, item_id),
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
                    """SELECT address,SUM(quantidade) qty
                       FROM card_allocations
                       WHERE card_id=%s AND setor=%s
                       GROUP BY address
                       ORDER BY address""",
                    (card_id, setor),
                )
                rows = cur.fetchall()

                cur.execute(
                    """SELECT a.item_id,SUM(a.quantidade) qty,
                              i.product,i.reference,i.sku,i.color,i.size,i.expected_qty
                       FROM card_allocations a
                       LEFT JOIN outlog_items i ON i.id=a.item_id
                       WHERE a.card_id=%s AND a.setor=%s
                       GROUP BY a.item_id,i.product,i.reference,i.sku,i.color,i.size,i.expected_qty
                       ORDER BY i.product,i.reference,i.color,i.size,a.item_id""",
                    (card_id, setor),
                )
                item_rows = cur.fetchall()

                cur.execute(
                    """SELECT item_id,address,SUM(quantidade) qty
                       FROM card_allocations
                       WHERE card_id=%s AND setor=%s AND item_id IS NOT NULL
                       GROUP BY item_id,address
                       ORDER BY item_id,address""",
                    (card_id, setor),
                )
                item_positions = cur.fetchall()

                cur.execute(
                    """SELECT COALESCE(SUM(quantidade),0) total
                       FROM card_allocations
                       WHERE card_id=%s AND setor IN (%s,%s,%s)""",
                    (card_id, *GLOBAL_ALLOCATION_SECTORS),
                )
                global_total = int(cur.fetchone()["total"] or 0)

                cur.execute(
                    """SELECT a.item_id,SUM(a.quantidade) qty,
                              i.product,i.reference,i.sku,i.color,i.size,i.expected_qty
                       FROM card_allocations a
                       LEFT JOIN outlog_items i ON i.id=a.item_id
                       WHERE a.card_id=%s
                         AND a.setor IN (%s,%s,%s)
                         AND a.item_id IS NOT NULL
                       GROUP BY a.item_id,i.product,i.reference,i.sku,i.color,i.size,i.expected_qty
                       ORDER BY i.product,i.reference,i.color,i.size,a.item_id""",
                    (card_id, *GLOBAL_ALLOCATION_SECTORS),
                )
                global_item_rows = cur.fetchall()

                cur.execute(
                    """SELECT setor,COALESCE(SUM(quantidade),0) qty
                       FROM card_allocations
                       WHERE card_id=%s AND setor = ANY(%s)
                       GROUP BY setor""",
                    (card_id, list(GLOBAL_ALLOCATION_SECTORS)),
                )
                por_setor_rows = cur.fetchall()
                volumes_total = _card_total_volumes(cur, card_id)
    except RuntimeError:
        rows, item_rows, item_positions = [], [], []
        global_total, global_item_rows = 0, []
        por_setor_rows, volumes_total = [], None

    total = sum(int(r["qty"] or 0) for r in rows)
    grouped: dict[int, dict[str, Any]] = {}
    for r in item_rows:
        item_id = int(r["item_id"]) if r["item_id"] is not None else 0
        if item_id not in grouped:
            grouped[item_id] = {
                "item_id": item_id,
                "product": r["product"],
                "reference": r["reference"],
                "sku": r["sku"],
                "color": r["color"],
                "size": r["size"],
                "expected_qty": int(r["expected_qty"] or 0),
                "total_alocado": int(r["qty"] or 0),
                "posicoes": [],
            }

    for r in item_positions:
        item_id = int(r["item_id"])
        grouped.setdefault(item_id, {
            "item_id": item_id, "product": None, "reference": None, "sku": None,
            "color": None, "size": None, "expected_qty": 0, "total_alocado": 0,
            "posicoes": [],
        })
        grouped[item_id]["posicoes"].append({
            "address": r["address"],
            "quantidade": int(r["qty"] or 0),
        })

    global_item_grouped: dict[int, dict[str, Any]] = {}
    for r in global_item_rows:
        item_id = int(r["item_id"]) if r["item_id"] is not None else 0
        global_item_grouped[item_id] = {
            "item_id": item_id,
            "product": r["product"],
            "reference": r["reference"],
            "sku": r["sku"],
            "color": r["color"],
            "size": r["size"],
            "expected_qty": int(r["expected_qty"] or 0),
            "total_alocado": int(r["qty"] or 0),
        }

    return {
        "card_id": card_id,
        "setor": setor,
        "total_alocado": total,
        "global_total_alocado": global_total,
        "volumes_total": volumes_total,
        "volumes_restante": max(0, volumes_total - global_total) if volumes_total is not None else None,
        "global_por_setor": {
            s: next((int(r["qty"] or 0) for r in por_setor_rows if r["setor"] == s), 0)
            for s in GLOBAL_ALLOCATION_SECTORS
        },
        "posicoes": [{"address": r["address"], "quantidade": int(r["qty"] or 0)} for r in rows],
        "item_allocations": list(grouped.values()),
        "global_item_allocations": list(global_item_grouped.values()),
    }


@router.get("/cards/{card_id}/trail")
def card_trail(card_id: int) -> list[dict[str, Any]]:
    """Trilha completa do card: toda alocação, em qualquer setor, em ordem
    cronológica — é o histórico de por onde o card passou fisicamente."""
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute(
                    """SELECT a.setor,a.address,a.quantidade,a.responsavel,a.created_at,a.item_id,
                              i.product,i.reference,i.sku,i.color,i.size
                       FROM card_allocations a
                       LEFT JOIN outlog_items i ON i.id=a.item_id
                       WHERE a.card_id=%s
                       ORDER BY a.created_at""",
                    (card_id,),
                )
                rows = cur.fetchall()
    except RuntimeError:
        return []
    return [dict(r) for r in rows]



def item_allocation_totals(card_id: int, setor: str = "RM") -> dict[int, int]:
    """Retorna a quantidade física alocada por item, em volumes (caixa/bag).

    RM, QA e PR dividem um saldo global: pedir qualquer um deles soma os três,
    porque o Card pode ser endereçado direto em outro setor a partir do RM.
    O módulo não transforma quantidade de peças em volume.
    """
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute(
                    """SELECT item_id,COALESCE(SUM(quantidade),0) qty
                       FROM card_allocations
                       WHERE card_id=%s AND setor = ANY(%s) AND item_id IS NOT NULL
                       GROUP BY item_id""",
                    (card_id, _sector_scope(setor)),
                )
                return {
                    int(row["item_id"]): int(row["qty"] or 0)
                    for row in cur.fetchall()
                }
    except RuntimeError:
        return {}


def total_allocated(setor: str, card_id: int) -> int:
    """Helper síncrono usado pelos gates de avanço de setor em app.py.
    RM, QA e PR contam como saldo global (ver _sector_scope)."""
    try:
        with pg_connect() as con:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT COALESCE(SUM(quantidade),0) t FROM card_allocations WHERE card_id=%s AND setor = ANY(%s)",
                    (card_id, _sector_scope(setor)),
                )
                return int(cur.fetchone()["t"] or 0)
    except RuntimeError:
        return 0


def release_card_allocations(card_id: int, keep_quality_qty: int = 0) -> int:
    """Libera o endereço do card quando a produção começa. Os 10% ficam na Qualidade
    (registrados no setor QUALIDADE); o restante sai do endereço original."""
    with pg_connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT COALESCE(SUM(quantidade),0) t FROM card_allocations WHERE card_id=%s AND setor<>'QUALIDADE'", (card_id,))
        total = int(cur.fetchone()["t"] or 0)
        if total <= 0:
            return 0
        cur.execute("DELETE FROM card_allocations WHERE card_id=%s AND setor<>'QUALIDADE'", (card_id,))
        keep = max(0, min(int(keep_quality_qty or 0), total))
        if keep:
            cur.execute(
                "INSERT INTO card_allocations(card_id,setor,address,quantidade,responsavel,created_at) VALUES(%s,%s,%s,%s,%s,%s)",
                (card_id, "QUALIDADE", "QUALIDADE (10%)", keep, "sistema", iso_now()),
            )
        conn.commit()
    return total - keep


def register_positions_routes(app: FastAPI) -> None:
    app.include_router(router)
