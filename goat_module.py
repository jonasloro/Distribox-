import re

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
