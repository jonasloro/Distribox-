# Changelog — OutLog One V3

## Interface reconstruída pela referência aprovada

- tema escuro azul-marinho aplicado em toda a aplicação;
- seleção amarela no menu lateral;
- Central de Operações com quatro indicadores principais, seis painéis de dados e fluxo visual completo;
- busca global com atalho `Ctrl + K`;
- telas e modais operacionais adaptados ao mesmo sistema visual;
- responsividade para monitores menores e dispositivos móveis.

Os valores da Central vêm do banco real. Os números do mockup não foram colocados como dados fictícios.

## Visualizações recuperadas do OutLog

- Estocagem com fila operacional; o mapa físico de casulos, consulta de endereços, estatísticas de capacidade e simulador foram removidos para reduzir a carga da aplicação;
- relatório de estoque por grupo, gênero e quantidade importado de PDF;
- SGO com indicadores de entradas, peças, atrasos, etapas e tarefas;
- Devoluções com dashboard, pendências, conferência/tratamento, indicadores e histórico próprio;
- Cadastros com usuários, perfis, zonas e grupos;
- Configurações com atalhos para importação, tarefas, administração e histórico global.

## Redução de conflitos

- a nova interface consome as APIs existentes sem duplicar regras operacionais;
- falha em um painel secundário não derruba toda a Central de Operações;
- erros de carregamento são apresentados na própria tela com opção de tentar novamente;
- navegação de subvisões mantém o módulo pai corretamente destacado;
- Recebimento, Qualidade, Processamento, Etiquetagem e Estocagem continuam usando o Card e o banco únicos.

## Fluxos congelados preservados

- `Private Label = Grade` e `Saldo = Saldo`;
- tiragem de 10% e triagem inicial juntas no Recebimento;
- nova tiragem de 10% no retorno CD01;
- Card CD01 em Costura permanece no Recebimento;
- Inspeção 2 direta sem Costura e Inspeção 2 obrigatória após retorno CD01;
- Grade por tamanho e Saldo por quantidade geral;
- atribuições, timers, permissões, históricos e roteamentos setoriais.

