#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
config_file="${DEPLOY_ENV_FILE:-.env.docker}"
if [[ ! -f "$config_file" ]]; then
  printf 'Falta %s. Copiá .env.docker.example y configurá dominio y secretos.\n' "$config_file" >&2
  exit 1
fi
docker compose --env-file "$config_file" --profile https config --quiet
# Backup before schema changes. Initial installs do not yet have a database to copy.
if docker compose --env-file "$config_file" ps --status running --services | grep -qx db; then
  docker compose --env-file "$config_file" exec -T db bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" PGHOST=127.0.0.1 PGUSER="$POSTGRES_USER" PGDATABASE="$POSTGRES_DB" BACKUP_DIR=/tmp/predeploy bash -s' < scripts/backup.sh
  mkdir -p backups/predeploy
  docker compose --env-file "$config_file" cp db:/tmp/predeploy/. backups/predeploy/
fi
docker compose --env-file "$config_file" --profile https build
# Stop writers before migration; never run a new schema under the previous binary.
docker compose --env-file "$config_file" stop app
docker compose --env-file "$config_file" up -d db
docker compose --env-file "$config_file" run --rm migrate
docker compose --env-file "$config_file" --profile https up -d --wait
printf 'Despliegue iniciado. Revisá docker compose ps y verificá HTTPS en el dominio configurado.\n'
