# Hospedagem no Fly.io

Pré-requisito: a connection string do Supabase (Settings → Database). **Nunca** coloque ela no GitHub.

1. Instalar o flyctl (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`
2. Entrar: `fly auth login`
3. Na pasta do projeto: `fly launch --copy-config --no-deploy`
   - escolha o nome do app e a região `gru` (São Paulo)
   - responda **não** para Postgres, Redis e qualquer outro serviço extra
4. Criar o volume do SQLite/uploads: `fly volumes create outlog_data --region gru --size 1`
5. Guardar a connection string como segredo: `fly secrets set SUPABASE_DATABASE_URL="postgresql://..."`
6. Publicar com uma máquina só: `fly deploy --ha=false`
7. Abrir: `fly open`

Atualizações: `fly deploy --ha=false` de novo. Logs: `fly logs`.

O volume só pode ser usado por uma máquina, por isso o app deve rodar com uma só (`fly scale count 1`).
Se a conexão com o Supabase falhar, use a string do **Session pooler**.
