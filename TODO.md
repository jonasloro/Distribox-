# A fazer — DistriLog / Distribox

## Prioridade (antes do próximo deploy)
- [ ] Criar volume no Railway montado em `/app/data` (os cards ainda ficam em SQLite e somem a cada deploy)
- [ ] Migrar cards, qualidade, processamento e devoluções do SQLite para o Supabase
- [ ] GOAT: voltar a ler do Supabase (sem fallback SQLite silencioso) e corrigir números (`1500.5` virando `15005`)
- [ ] GOAT: "Volumes" do card criado vem fixo em 1 — não preencher quando o GOAT não informa

## Processo
- [ ] Segunda inspeção junto com a Triagem (definir como marcar dentro da tarefa de Triagem)
- [ ] Dividir os 10% da Qualidade por quantidade no endereçamento (hoje libera tudo e registra "QUALIDADE (10%)")
- [ ] Permitir a mesma pessoa assumir Cadastro e Triagem no mesmo card (tabela tem UNIQUE por processamento+usuário)
- [ ] Botão real "Registrar retorno da Costura" para o perfil de recebimento (hoje só admin, em Ferramentas de teste) e retorno do CD02
- [ ] Mover "Importar Excel" para Cadastros, se for o desejado

## Equipe
- [ ] Conversas: anexos, notificação sonora, conversas em grupo
- [ ] Calendário: lembretes antes do horário, compromissos recorrentes, visão semanal

## Segurança
- [ ] Revogar os tokens do GitHub que foram compartilhados no chat

## Feito recentemente
- [x] Botão do GOAT cria card em trânsito (só em Cadastros)
- [x] Escolha manual Grade/Saldo na Qualidade
- [x] Processamento por tarefas: Cadastro → Triagem → Etiquetagem/Estocagem
- [x] Endereçamento por volumes ou peças (RM e QA)
- [x] Conversas entre colaboradores e Calendário de compromissos (Supabase)
