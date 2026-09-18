"""
warehouse_structure.py
=======================

Porte FIEL da estrutura física real do CD, extraída diretamente de
`app.py` do repositório original (jonasloro/OutLog-Distribox), variáveis
`ESTRUTURA_CD_PADRAO` (linhas 123-230), `RUA_GENERO_PADRAO` (235-243) e
`CAPACIDADE_FIXA_POR_RUA_PADRAO` (351-370), e das funções
`obter_especificacao_casulo` (432-511) e `_obter_capacidade_fixa`
(526-541).

Nada aqui foi inventado ou estimado — é cópia literal dos dados e da
lógica já validados no app original. A única coisa NOVA neste arquivo é
a função `gerar_todos_casulos()`, que percorre essa estrutura e devolve
a lista completa de casulos físicos do CD (um item por rua+coluna+nível),
pronta para popular o banco do backend unificado.

Propositalmente DE FORA deste arquivo (por pedido explícito):
- Integração com a API ID Brasil (leitura de posição/quantidade real).
  Fica para uma etapa futura, à parte.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Estrutura física de cada rua: quais colunas existem, de que lado
# (par/ímpar/sequencial) e exceções pontuais (metal, madeira).
# Cópia literal de ESTRUTURA_CD_PADRAO em app.py.
# ---------------------------------------------------------------------------

ESTRUTURA_CD: dict[str, dict] = {
    # Rua 01 — porta-palete, fora do escopo do Visualizador de Casulos
    "Rua 01": {"tipo": "Morta", "cols_impar": [], "cols_par": []},

    # Rua 02 — Par 22-102 (P) | Ímpar 21-93 (P) | Seq 103-139 (G unilateral)
    "Rua 02": {
        "tipo": "Misto_Transicao_R02",
        "cols_par": list(range(22, 104, 2)),
        "cols_impar": list(range(21, 94, 2)),
        "cols_seq": list(range(103, 140)),
    },

    # Rua 03 — Par 22-102 (P) | Ímpar 19-103 (P)
    "Rua 03": {
        "tipo": "P",
        "cols_par": list(range(22, 104, 2)),
        "cols_impar": list(range(19, 104, 2)),
    },

    # Rua 04 — Ímpar 21-105 (P) | Par 22-100 (G)
    "Rua 04": {
        "tipo": "Misto_Lado",
        "cols_impar": list(range(21, 106, 2)),
        "cols_par": list(range(22, 102, 2)),
    },

    # Rua 05 — Ímpar 21-101 (M) | Par 22-100 (M)
    "Rua 05": {
        "tipo": "M",
        "cols_impar": list(range(21, 102, 2)),
        "cols_par": list(range(22, 102, 2)),
    },

    # Rua 06 — Ímpar 1-81 (M) | Par 2-82 (M)
    "Rua 06": {
        "tipo": "M",
        "cols_impar": list(range(1, 82, 2)),
        "cols_par": list(range(2, 84, 2)),
    },

    # Rua 07 — Ímpar 59-139 (M) | Par 60-140 (M)
    "Rua 07": {
        "tipo": "M",
        "cols_impar": list(range(59, 140, 2)),
        "cols_par": list(range(60, 142, 2)),
    },

    # Rua 08 — Par 2-80 (M) | Ímpar 1-81 (M)
    "Rua 08": {
        "tipo": "M",
        "cols_par": list(range(2, 82, 2)),
        "cols_impar": list(range(1, 82, 2)),
    },

    # Rua 09 — Ímpar 21-103 (M) | Par 22-100 (M)
    "Rua 09": {
        "tipo": "M",
        "cols_impar": list(range(21, 104, 2)),
        "cols_par": list(range(22, 102, 2)),
    },

    # Rua 10 — Ímpar 21-103 (G) | Par 22-100 (G)
    "Rua 10": {
        "tipo": "G",
        "cols_impar": list(range(21, 104, 2)),
        "cols_par": list(range(22, 102, 2)),
    },

    # Rua 11 — Par 22-94 (G) unilateral + apêndice metal 129,131,133
    "Rua 11": {
        "tipo": "G_Unilateral",
        "cols_impar": [],
        "cols_par": list(range(22, 96, 2)),
        "metal": [129, 131, 133],
    },

    "Rua 12": {"tipo": "Inexistente", "cols_impar": [], "cols_par": []},
    "Rua 13": {"tipo": "Inexistente", "cols_impar": [], "cols_par": []},

    # Rua 14 — seq: 1-23 madeira | 26-32 metal profundo | 42-48 metal raso
    "Rua 14": {
        "tipo": "Especial_Rua_14",
        "cols_impar": [],
        "cols_par": [],
        "cols_seq": list(range(1, 24)) + list(range(26, 33)) + list(range(42, 49)),
    },

    # Rua 15 — Par 2-138 (M) | Ímpar 1-87 (M) + 89,91 madeira + 93 metal
    "Rua 15": {
        "tipo": "Misto_Lado_15",
        "cols_par": list(range(2, 140, 2)),
        "cols_impar": list(range(1, 88, 2)),
        "madeira": [89, 91],
        "metal": [93],
    },

    # Rua 16 — Par: 36,38,40 metal | 42-100 G | 102-140 M
    #           Ímpar: 43 metal | 45-139 G (inteiro, sem virar M)
    "Rua 16": {
        "tipo": "G",
        "metal": [43],
        "metal_cols": [36, 38, 40],
        "cols_impar": list(range(45, 140, 2)),
        "cols_par": list(range(42, 142, 2)),
    },

    # Rua 17 — Ímpar 1-99 (G) + 101,103,105 metal | Par 2-100 (G) + 102,104,106 metal
    "Rua 17": {
        "tipo": "G",
        "cols_impar": list(range(1, 100, 2)),
        "cols_par": list(range(2, 102, 2)),
        "metal": [101, 103, 105],
        "metal_cols": [102, 104, 106],
    },

    # Rua 18 — Ímpar 35,37,39 metal + 41-139 (M) | Par 36,38,40 metal + 42-140 (M)
    "Rua 18": {
        "tipo": "M",
        "cols_impar": list(range(41, 140, 2)),
        "cols_par": list(range(42, 142, 2)),
        "metal": [35, 37, 39],
        "metal_cols": [36, 38, 40],
    },

    # Rua 19 — Ímpar 1-99 (P) + 101,103,105 metal | Par 2-100 (P) + 102,104,106 metal
    "Rua 19": {
        "tipo": "P",
        "cols_impar": list(range(1, 100, 2)),
        "cols_par": list(range(2, 102, 2)),
        "metal": [101, 103, 105],
        "metal_cols": [102, 104, 106],
    },

    # Rua 20 — APENAS ÍMPAR: 35,37,39 metal + 41-139 (P)
    "Rua 20": {
        "tipo": "Aramado_P_Seq_20",
        "cols_impar": [],
        "cols_par": [],
        "cols_seq": [35, 37, 39] + list(range(41, 140, 2)),
        "metal_cols": [35, 37, 39],
    },

    # Rua 21 — APENAS ÍMPAR: 1-77 metal sequencial
    "Rua 21": {
        "tipo": "Metal_Seq_21",
        "cols_impar": [],
        "cols_par": [],
        "cols_seq": list(range(1, 78, 2)),
    },
}

# Gênero de cada rua — cópia literal de RUA_GENERO_PADRAO em app.py.
RUA_GENERO: dict[str, str] = {
    "Rua 02": "Feminino", "Rua 03": "Feminino", "Rua 04": "Feminino",
    "Rua 05": "Feminino", "Rua 06": "Feminino", "Rua 07": "Feminino",
    "Rua 08": "Feminino", "Rua 09": "Feminino", "Rua 10": "Feminino",
    "Rua 11": "Feminino", "Rua 14": "Feminino",
    "Rua 15": "Masculino", "Rua 16": "Masculino", "Rua 17": "Masculino",
    "Rua 18": "Masculino", "Rua 19": "Masculino", "Rua 20": "Masculino",
    "Rua 21": "Masculino",
}

# Densidade FIXA por rua x tipo estrutural — cópia literal de
# CAPACIDADE_FIXA_POR_RUA_PADRAO em app.py. É a fonte de verdade da
# capacidade de cada casulo (não a tabela por categoria de peça).
CAPACIDADE_FIXA_POR_RUA: dict[str, dict] = {
    "Rua 02": {"aramado_P": 6, "aramado_G": 10},
    "Rua 03": {"aramado_P": 6},
    "Rua 04": {"aramado_P": 6, "aramado_G": 10},
    "Rua 05": {"aramado_M": 6},
    "Rua 06": {"aramado_M": 6},
    "Rua 07": {"aramado_M": 6},
    "Rua 08": {"aramado_M": {"par": 6, "impar": 8}},
    "Rua 09": {"aramado_M": 12},
    "Rua 10": {"aramado_G": 15},
    "Rua 11": {"aramado_G": 10, "metal_raso": 50},
    "Rua 14": {"madeira": 100, "metal_profundo": 100, "metal_raso": 100},
    "Rua 15": {"aramado_M": 7, "aramado_G": 12},
    "Rua 16": {"aramado_G": 10, "aramado_M": 6},
    "Rua 17": {"aramado_G": 12},
    "Rua 18": {"aramado_M": 12},
    "Rua 19": {"aramado_P": 6},
    "Rua 20": {"aramado_P": 6, "metal_raso": 50},
    "Rua 21": {"metal_raso": 40},
}

# Níveis (alturas) válidos por tipo estrutural — cópia literal das
# constantes NIVEIS_G/NIVEIS_M/NIVEIS_P/NIVEIS_METAL_5 em app.py, mais os
# níveis de madeira usados dentro de obter_especificacao_casulo.
NIVEIS_G = ["B", "E", "H", "K", "N", "Q", "T"]
NIVEIS_M = ["B", "D", "E", "G", "H", "J", "K", "M", "N", "P", "Q", "S", "T", "V"]
NIVEIS_P = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
            "P", "Q", "R", "S", "T", "U", "V"]
NIVEIS_METAL_5 = ["B", "C", "D", "E", "F"]
NIVEIS_MADEIRA = ["D", "G", "J", "M", "P"]

# Fallback de capacidade quando uma combinação rua/tipo ainda não tem
# densidade fixa cadastrada (mesmo valor genérico usado em
# obter_capacidade_estimada_exibicao no app original — 20 — só para não
# deixar o casulo sem número; fica sinalizado explicitamente no retorno de
# gerar_todos_casulos via "capacidade_estimada": True).
CAPACIDADE_FALLBACK = 20


def obter_genero_rua(rua_nome: str) -> str:
    return RUA_GENERO.get(rua_nome, "Feminino")


def obter_especificacao_casulo(rua_nome: str, coluna: int, lado: str = "impar") -> dict:
    """
    Porte fiel de obter_especificacao_casulo (app.py, linhas 432-511).
    Retorna: niveis (lista), tipo_estrutural, tipo_desc.
    """
    try:
        col = int(coluna)
    except (ValueError, TypeError):
        col = 1

    config = ESTRUTURA_CD.get(rua_nome, {})
    tipo = config.get("tipo", "")
    vazio = {"niveis": [], "tipo_estrutural": None, "tipo_desc": "Inexistente"}

    if tipo in ("Inexistente", "Morta"):
        return vazio

    # Metal tem prioridade sobre qualquer tipo estrutural
    if "metal" in config and col in config["metal"]:
        return {"niveis": NIVEIS_METAL_5, "tipo_estrutural": "metal_raso", "tipo_desc": "Metal"}
    if "metal_cols" in config and col in config["metal_cols"]:
        return {"niveis": NIVEIS_METAL_5, "tipo_estrutural": "metal_raso", "tipo_desc": "Metal"}

    # Madeira (Rua 15: cols 89, 91)
    if "madeira" in config and col in config["madeira"]:
        return {"niveis": NIVEIS_MADEIRA, "tipo_estrutural": "madeira", "tipo_desc": "Madeira"}

    if tipo in ("Aramado_P_Seq_20", "P"):
        return {"niveis": NIVEIS_P, "tipo_estrutural": "aramado_P", "tipo_desc": "Pequeno (P)"}

    if tipo == "G":
        # Rua 16: lado ÍMPAR é G o tempo todo (45-139).
        # Só o lado PAR vira M a partir da col 102.
        if rua_nome == "Rua 16" and lado == "par" and col >= 102:
            return {"niveis": NIVEIS_M, "tipo_estrutural": "aramado_M", "tipo_desc": "Médio (M)"}
        return {"niveis": NIVEIS_G, "tipo_estrutural": "aramado_G", "tipo_desc": "Grande (G)"}

    if tipo == "M":
        return {"niveis": NIVEIS_M, "tipo_estrutural": "aramado_M", "tipo_desc": "Médio (M)"}

    if tipo == "G_Unilateral":
        if lado == "par":
            return {"niveis": NIVEIS_G, "tipo_estrutural": "aramado_G", "tipo_desc": "Grande (G) — Unilateral"}
        return vazio

    if tipo == "Metal_Seq_21":
        return {"niveis": NIVEIS_METAL_5, "tipo_estrutural": "metal_raso", "tipo_desc": "Metal Sequencial"}

    if tipo == "Especial_Rua_14":
        if 1 <= col <= 23:
            return {"niveis": NIVEIS_MADEIRA, "tipo_estrutural": "madeira", "tipo_desc": "Rua 14 — Madeira Gigante"}
        if col in range(26, 33):
            return {"niveis": NIVEIS_METAL_5, "tipo_estrutural": "metal_profundo", "tipo_desc": "Rua 14 — Metal Profundo"}
        if col in range(42, 49):
            return {"niveis": NIVEIS_METAL_5, "tipo_estrutural": "metal_raso", "tipo_desc": "Rua 14 — Metal Raso"}
        return vazio

    if tipo == "Misto_Transicao_R02":
        if col >= 103:
            return {"niveis": NIVEIS_G, "tipo_estrutural": "aramado_G", "tipo_desc": "Grande (G)"}
        return {"niveis": NIVEIS_P, "tipo_estrutural": "aramado_P", "tipo_desc": "Pequeno (P)"}

    if tipo == "Misto_Lado":
        if lado == "par":
            return {"niveis": NIVEIS_G, "tipo_estrutural": "aramado_G", "tipo_desc": "Grande (G)"}
        return {"niveis": NIVEIS_P, "tipo_estrutural": "aramado_P", "tipo_desc": "Pequeno (P)"}

    if tipo == "Misto_Lado_15":
        return {"niveis": NIVEIS_M, "tipo_estrutural": "aramado_M", "tipo_desc": "Médio (M)"}

    return {"niveis": NIVEIS_P, "tipo_estrutural": "aramado_P", "tipo_desc": "Padrão"}


def obter_capacidade_fixa(rua_nome: str, tipo_estrutural: str, lado: str | None = None):
    """
    Porte fiel de _obter_capacidade_fixa (app.py, linhas 526-541).
    Retorna None se não houver densidade cadastrada para essa combinação
    (o chamador decide o que fazer — ver gerar_todos_casulos).
    """
    valor = CAPACIDADE_FIXA_POR_RUA.get(rua_nome, {}).get(tipo_estrutural)
    if valor is None:
        return None
    if isinstance(valor, dict):
        if lado and lado in valor:
            return valor[lado]
        valores = [v for v in valor.values() if v is not None]
        return min(valores) if valores else None
    return valor


def _colunas_por_lado(config: dict) -> list[tuple[int, str]]:
    """
    Devolve [(coluna, lado), ...] para uma rua, cobrindo cols_par,
    cols_impar e cols_seq (sequência sem lado definido — tratada como
    'impar' apenas para fins de escolha de tipo estrutural, já que nenhuma
    das ruas com cols_seq depende do lado 'par' na função de especificação).
    """
    resultado = []
    for col in config.get("cols_par", []):
        resultado.append((col, "par"))
    for col in config.get("cols_impar", []):
        resultado.append((col, "impar"))
    for col in config.get("cols_seq", []):
        resultado.append((col, "impar"))
    return resultado


def gerar_todos_casulos() -> list[dict]:
    """
    Gera a lista completa de casulos físicos reais do CD, um item por
    combinação (rua, coluna, lado, nível). Esta é a ÚNICA função nova
    deste arquivo — tudo que ela consome (ESTRUTURA_CD,
    obter_especificacao_casulo, obter_capacidade_fixa) é porte literal do
    app original.

    Cada item:
        {
            "rua": "Rua 09",
            "genero": "Feminino",
            "coluna": 42,
            "lado": "par",
            "nivel": "H",
            "tipo_estrutural": "aramado_M",
            "tipo_desc": "Médio (M)",
            "capacidade": 12,
            "capacidade_estimada": False,   # True = fallback genérico (20),
                                             # ainda sem densidade cadastrada
            "address": "Rua 09-042-par-H",
        }
    """
    casulos: list[dict] = []

    for rua_nome, config in ESTRUTURA_CD.items():
        if config.get("tipo") in ("Inexistente", "Morta"):
            continue

        genero = obter_genero_rua(rua_nome)
        colunas_lado = _colunas_por_lado(config)

        # Exceções pontuais (metal/madeira fora das faixas par/ímpar/seq)
        # também precisam ser cobertas explicitamente, senão ficam de fora.
        for col in config.get("metal", []):
            if not any(c == col for c, _ in colunas_lado):
                colunas_lado.append((col, "impar"))
        for col in config.get("metal_cols", []):
            if not any(c == col for c, _ in colunas_lado):
                colunas_lado.append((col, "par"))
        for col in config.get("madeira", []):
            if not any(c == col for c, _ in colunas_lado):
                colunas_lado.append((col, "impar"))

        for coluna, lado in colunas_lado:
            espec = obter_especificacao_casulo(rua_nome, coluna, lado)
            tipo_estrutural = espec["tipo_estrutural"]
            if not tipo_estrutural:
                continue  # posição vazia/inexistente (ex: G_Unilateral lado impar)

            capacidade = obter_capacidade_fixa(rua_nome, tipo_estrutural, lado)
            capacidade_estimada = capacidade is None
            if capacidade_estimada:
                capacidade = CAPACIDADE_FALLBACK

            for nivel in espec["niveis"]:
                casulos.append({
                    "rua": rua_nome,
                    "genero": genero,
                    "coluna": coluna,
                    "lado": lado,
                    "nivel": nivel,
                    "tipo_estrutural": tipo_estrutural,
                    "tipo_desc": espec["tipo_desc"],
                    "capacidade": capacidade,
                    "capacidade_estimada": capacidade_estimada,
                    "address": f"{rua_nome}-{coluna:03d}-{lado}-{nivel}",
                })

    return casulos


