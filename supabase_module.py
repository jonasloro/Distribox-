"""Conexão com o Supabase (Postgres) e autenticação de usuários.

A lógica de hash de senha (gerar_hash_senha/verificar_senha) é uma cópia
exata do core/usuarios.py do OutLog-Distribox — PBKDF2-HMAC-SHA256 com
salt aleatório, 200 mil iterações, comparação segura contra timing attack.
Não usa bcrypt/passlib de propósito, só o que já vem no Python padrão
(mesma decisão do app original).

Além da autenticação e da estrutura física do CD, este módulo mantém no
Postgres do Supabase uma cópia persistente dos cards e itens operacionais.
O workflow continua usando SQLite local para compatibilidade com os módulos
existentes, mas cards e itens são sincronizados para sobreviver a redeploy.
"""
from __future__ import annotations

import binascii
import hashlib
import hmac
import os

import psycopg
from psycopg.rows import dict_row


def pg_connect():
    """Conecta no Postgres do Supabase. Lê a connection string da variável
    de ambiente SUPABASE_DATABASE_URL — precisa estar configurada no
    Railway (Variables) antes disso funcionar."""
    url = os.getenv("SUPABASE_DATABASE_URL")
    if not url:
        raise RuntimeError(
            "SUPABASE_DATABASE_URL não está configurada. Defina essa variável de "
            "ambiente com a connection string do Supabase (Settings → Database)."
        )
    return psycopg.connect(url, row_factory=dict_row)


def gerar_hash_senha(senha_texto_puro: str) -> str:
    """PBKDF2-HMAC-SHA256 com salt aleatório — mesma lógica do OutLog-Distribox."""
    salt = os.urandom(16)
    hash_bytes = hashlib.pbkdf2_hmac("sha256", senha_texto_puro.encode("utf-8"), salt, 200_000)
    return binascii.hexlify(salt).decode() + ":" + binascii.hexlify(hash_bytes).decode()


def verificar_senha(senha_texto_puro: str, hash_armazenado: str) -> bool:
    try:
        salt_hex, hash_hex = hash_armazenado.split(":")
        salt = binascii.unhexlify(salt_hex)
        hash_esperado = binascii.unhexlify(hash_hex)
        hash_calculado = hashlib.pbkdf2_hmac("sha256", senha_texto_puro.encode("utf-8"), salt, 200_000)
        return hmac.compare_digest(hash_calculado, hash_esperado)
    except Exception:
        return False


def verificar_login_supabase(usuario: str, senha_texto_puro: str) -> dict | None:
    """Confere usuário/senha no Postgres (Supabase). Se bater, devolve
    {"usuario": ..., "papel": ...} — quem chama essa função ainda precisa
    casar isso com a tabela local de users (SQLite) pra pegar o id que o
    resto do app usa (require_user, criado_por etc. continuam olhando pro
    SQLite, sem mudança)."""
    with pg_connect() as con:
        with con.cursor() as cur:
            cur.execute(
                "SELECT usuario, senha_hash, papel FROM usuarios WHERE usuario=%s",
                (usuario,),
            )
            linha = cur.fetchone()
    if not linha:
        return None
    if not verificar_senha(senha_texto_puro, linha["senha_hash"]):
        return None
    return {"usuario": linha["usuario"], "papel": linha["papel"]}


def criar_usuario_supabase(usuario: str, senha_texto_puro: str, papel: str) -> None:
    senha_hash = gerar_hash_senha(senha_texto_puro)
    with pg_connect() as con:
        with con.cursor() as cur:
            cur.execute(
                """INSERT INTO usuarios (usuario, senha_hash, papel) VALUES (%s, %s, %s)
                   ON CONFLICT (usuario) DO UPDATE SET senha_hash=EXCLUDED.senha_hash, papel=EXCLUDED.papel""",
                (usuario, senha_hash, papel),
            )
        con.commit()


def seed_usuarios_supabase(usuarios_padrao: list[tuple[str, str, str]]) -> None:
    """Popula a tabela usuarios no Supabase com a lista padrão (usuario,
    senha, papel) — só insere quem ainda não existir lá (ON CONFLICT DO
    NOTHING), então é seguro rodar isso toda vez que o app sobe."""
    with pg_connect() as con:
        with con.cursor() as cur:
            for usuario, senha_texto_puro, papel in usuarios_padrao:
                senha_hash = gerar_hash_senha(senha_texto_puro)
                cur.execute(
                    """INSERT INTO usuarios (usuario, senha_hash, papel) VALUES (%s, %s, %s)
                       ON CONFLICT (usuario) DO NOTHING""",
                    (usuario, senha_hash, papel),
                )
        con.commit()


CARD_COLUMNS = [
    "id", "purchase_id", "source_created_date", "supplier", "original_type",
    "purchase_mode", "status_compra", "original_destination", "forecast_date",
    "qtd_itens", "source_notes", "brand", "collection", "current_sector",
    "status", "receiving_type", "quality_destination", "casulo_current",
    "source_location_summary", "source_snapshot_at", "created_at", "updated_at",
]

ITEM_COLUMNS = [
    "id", "card_id", "source_key", "product", "reference", "sku", "group_name",
    "collection", "brand", "gender", "color", "size", "capsule", "lot", "lot_id",
    "nf", "expected_qty", "url_photo", "status_kanban", "source_stage",
    "source_status_purchase", "source_status_lot", "source_status_quality",
    "source_inspection_phase", "source_status_pcp", "source_seamstress",
    "source_status_logistics", "source_received_qty",
]


def init_card_persistence() -> None:
    """Cria as tabelas persistentes dos cards no Supabase sem substituir dados."""
    with pg_connect() as con:
        with con.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS outlog_cards (
                    id BIGINT PRIMARY KEY,
                    purchase_id TEXT NOT NULL UNIQUE,
                    source_created_date TEXT, supplier TEXT, original_type TEXT,
                    purchase_mode TEXT, status_compra TEXT, original_destination TEXT,
                    forecast_date TEXT, qtd_itens INTEGER DEFAULT 0, source_notes TEXT,
                    brand TEXT, collection TEXT, current_sector TEXT NOT NULL,
                    status TEXT NOT NULL, receiving_type TEXT NOT NULL,
                    quality_destination TEXT, casulo_current TEXT,
                    source_location_summary TEXT, source_snapshot_at TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS outlog_items (
                    id BIGINT PRIMARY KEY,
                    card_id BIGINT NOT NULL REFERENCES outlog_cards(id) ON DELETE CASCADE,
                    source_key TEXT NOT NULL, product TEXT, reference TEXT, sku TEXT,
                    group_name TEXT, collection TEXT, brand TEXT, gender TEXT,
                    color TEXT, size TEXT, capsule TEXT, lot TEXT, lot_id TEXT, nf TEXT,
                    expected_qty INTEGER NOT NULL DEFAULT 0, url_photo TEXT,
                    status_kanban TEXT, source_stage TEXT, source_status_purchase TEXT,
                    source_status_lot TEXT, source_status_quality TEXT,
                    source_inspection_phase TEXT, source_status_pcp TEXT,
                    source_seamstress TEXT, source_status_logistics TEXT,
                    source_received_qty INTEGER DEFAULT 0,
                    UNIQUE(card_id, source_key)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_outlog_items_card ON outlog_items(card_id)")
        con.commit()


def _card_tuple(row) -> tuple:
    return tuple(row[column] for column in CARD_COLUMNS)


def _item_tuple(row) -> tuple:
    return tuple(row[column] for column in ITEM_COLUMNS)


def sync_card_to_supabase(sqlite_con, card_id: int) -> None:
    row = sqlite_con.execute("SELECT * FROM cards WHERE id=?", (card_id,)).fetchone()
    if not row:
        return
    columns_sql = ",".join(CARD_COLUMNS)
    placeholders = ",".join(["%s"] * len(CARD_COLUMNS))
    updates = ", ".join(f"{column}=EXCLUDED.{column}" for column in CARD_COLUMNS if column != "id")
    sql = (
        f"INSERT INTO outlog_cards ({columns_sql}) VALUES ({placeholders})"
        f" ON CONFLICT (id) DO UPDATE SET {updates}"
    )
    with pg_connect() as con:
        with con.cursor() as cur:
            cur.execute(sql, _card_tuple(row))
        con.commit()


def delete_card_from_supabase(card_id: int) -> None:
    with pg_connect() as con:
        with con.cursor() as cur:
            cur.execute("DELETE FROM card_allocations WHERE card_id=%s", (card_id,))
            cur.execute("DELETE FROM outlog_cards WHERE id=%s", (card_id,))
        con.commit()


def sync_all_cards_to_supabase(sqlite_con, include_items: bool = False) -> None:
    """Sincroniza o estado local dos cards; itens entram quando solicitado (importação)."""
    cards = sqlite_con.execute("SELECT * FROM cards ORDER BY id").fetchall()
    if not cards:
        return
    card_columns_sql = ",".join(CARD_COLUMNS)
    item_columns_sql = ",".join(ITEM_COLUMNS)
    placeholders = ",".join(["%s"] * len(CARD_COLUMNS))
    item_placeholders = ",".join(["%s"] * len(ITEM_COLUMNS))
    updates = ", ".join(f"{column}=EXCLUDED.{column}" for column in CARD_COLUMNS if column != "id")
    item_updates = ", ".join(f"{column}=EXCLUDED.{column}" for column in ITEM_COLUMNS if column != "id")
    card_sql = (
        f"INSERT INTO outlog_cards ({card_columns_sql}) VALUES ({placeholders})"
        f" ON CONFLICT (id) DO UPDATE SET {updates}"
    )
    item_sql = (
        f"INSERT INTO outlog_items ({item_columns_sql}) VALUES ({item_placeholders})"
        f" ON CONFLICT (id) DO UPDATE SET {item_updates}"
    )
    with pg_connect() as con:
        with con.cursor() as cur:
            cur.executemany(card_sql, [_card_tuple(row) for row in cards])
            if include_items:
                items = sqlite_con.execute("SELECT * FROM items ORDER BY id").fetchall()
                cur.executemany(item_sql, [_item_tuple(row) for row in items])
        con.commit()


def bootstrap_card_persistence(sqlite_con) -> dict:
    """Inicializa o espelho e decide se deve enviar a base local ou restaurar do Supabase."""
    init_card_persistence()
    local_count = int(sqlite_con.execute("SELECT COUNT(*) AS n FROM cards").fetchone()["n"] or 0)
    with pg_connect() as con:
        with con.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM outlog_cards")
            remote_count = int(cur.fetchone()["n"] or 0)
    if local_count > 0 and remote_count == 0:
        sync_all_cards_to_supabase(sqlite_con, include_items=True)
        return {"mode": "seeded_remote", "cards": local_count}
    if local_count > 0:
        sync_all_cards_to_supabase(sqlite_con, include_items=False)
        return {"mode": "local", "cards": local_count}
    if remote_count == 0:
        return {"mode": "empty", "cards": 0}

    with pg_connect() as con:
        with con.cursor() as cur:
            cur.execute("SELECT * FROM outlog_cards ORDER BY id")
            cards = cur.fetchall()
            cur.execute("SELECT * FROM outlog_items ORDER BY id")
            items = cur.fetchall()
    columns = ",".join(CARD_COLUMNS)
    marks = ",".join(["?"] * len(CARD_COLUMNS))
    for row in cards:
        sqlite_con.execute(f"INSERT OR IGNORE INTO cards ({columns}) VALUES ({marks})", _card_tuple(row))
    item_columns = ",".join(ITEM_COLUMNS)
    item_marks = ",".join(["?"] * len(ITEM_COLUMNS))
    for row in items:
        sqlite_con.execute(f"INSERT OR IGNORE INTO items ({item_columns}) VALUES ({item_marks})", _item_tuple(row))
    return {"mode": "restored", "cards": len(cards), "items": len(items)}


def seed_warehouse_supabase(gerar_todos_casulos) -> None:
    """Popula warehouse_zones/warehouse_locations no Supabase com a
    estrutura física real do CD — só roda se a tabela ainda estiver vazia
    (não sobrescreve ocupação real já lançada). Recebe a própria função
    gerar_todos_casulos() do warehouse_structure.py como parâmetro, pra não
    duplicar a lógica de estrutura em dois lugares — este módulo só cuida
    de gravar no Postgres, não sabe nada sobre rua/coluna/capacidade.

    Grava em blocos multi-valor (não linha por linha) — 19.582 casulos um
    por vez seria muito mais lento e já vimos esse problema acontecer com
    outra tabela antes."""
    with pg_connect() as con:
        with con.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM warehouse_zones")
            if cur.fetchone()["n"] > 0:
                return  # já tem estrutura — não mexe em ocupação real

            casulos = gerar_todos_casulos()

            capacidade_por_zona: dict[str, int] = {}
            genero_por_zona: dict[str, str] = {}
            for c in casulos:
                capacidade_por_zona[c["rua"]] = capacidade_por_zona.get(c["rua"], 0) + c["capacidade"]
                genero_por_zona.setdefault(c["rua"], c["genero"])

            zona_id_por_nome: dict[str, int] = {}
            for rua_nome, capacidade_total in capacidade_por_zona.items():
                cur.execute(
                    """INSERT INTO warehouse_zones (code, name, gender, capacity)
                       VALUES (%s, %s, %s, %s) RETURNING id""",
                    (rua_nome, rua_nome, genero_por_zona[rua_nome], capacidade_total),
                )
                zona_id_por_nome[rua_nome] = cur.fetchone()["id"]

            linhas = [
                (
                    zona_id_por_nome[c["rua"]], c["address"], c["rua"], c["lado"],
                    c["coluna"], c["nivel"], c["tipo_estrutural"], c["capacidade"],
                )
                for c in casulos
            ]
            tamanho_bloco = 500
            for i in range(0, len(linhas), tamanho_bloco):
                bloco = linhas[i:i + tamanho_bloco]
                marcadores = ", ".join(["(%s, %s, %s, %s, %s, %s, %s, %s)"] * len(bloco))
                valores = [v for linha in bloco for v in linha]
                cur.execute(
                    f"""INSERT INTO warehouse_locations
                        (zone_id, address, aisle, side, column_no, level_no, structure_type, capacity)
                        VALUES {marcadores}""",
                    valores,
                )
        con.commit()
