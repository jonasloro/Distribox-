# OutLog One

Aplicação logística integrada criada a partir dos conteúdos funcionais do Controle Logística e do OutLog Distribox. É um único sistema: uma URL, um login, um backend FastAPI e um banco SQLite.

## O que está integrado

- Central de Operações com visão do fluxo completo;
- importação de compras, com `Private Label = Grade` e `Saldo = Saldo`;
- Recebimento físico, controle de produção, tiragem de 10% e triagem conjunta;
- nova tiragem de 10% no retorno da Costura CD01;
- Qualidade com Inspeção 1, Inspeção 2 direta e Inspeção 2 pós-costura;
- Processamento com atribuição por colaborador e cronômetros;
- Etiquetagem e Estocagem por tamanho para Grade e por quantidade para Saldo, com fila operacional;/m
- relatório PDF de estoque com visão por grupo e gênero;
- importação do planejamento SGO e criação de tarefas;
- quadro de tarefas por setor, prioridade e andamento;
- Expedição manual ou por importação de romaneio PDF;
- Devoluções com comparação Loja × CD × Anápolis e tratativa por item;
- dashboards e indicadores próprios de SGO, Estocagem e Devoluções;
- histórico unificado de movimentos.

## Como iniciar no Windows

1. Instale o Python 3.10 ou superior e marque **Add Python to PATH**.
2. Extraia todo o ZIP para uma pasta normal.
3. Dê dois cliques em `INICIAR_OUTLOG_ONE.bat`.
4. Aguarde a instalação inicial e use `http://127.0.0.1:8010`.

O inicializador cria o ambiente necessário e instala as dependências. Nas próximas execuções, basta abrir o mesmo arquivo.

## Execução pelo terminal

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8010
```

Cada comando deve ser executado em uma linha separada.

## Estrutura do código

```text
app.py                    Núcleo, importação e Recebimento
quality_module.py         Qualidade e inspeções
processing_module.py      Processamento
downstream_module.py      Etiquetagem e Estocagem operacional
unified_module.py         Estoque, SGO, tarefas, expedição e devoluções
templates/index.html      Estrutura da interface única
static/app.js             Comportamento das telas
static/style.css          Design responsivo e compacto
data/                     Banco e anexos locais
```

Todos esses arquivos podem ser vistos e editados ao abrir a pasta completa no VS Code.

## Dados e segurança

O banco, uploads e relatórios comerciais são ignorados pelo Git. Na primeira execução, usuários de demonstração são criados automaticamente; troque as senhas antes de uso real e mantenha o servidor restrito à rede autorizada.

## Versão

**OutLog One V3 — interface de referência e visualizações recuperadas.** Consulte `CHANGELOG_V3.md`.

