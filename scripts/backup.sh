#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${PGHOST:?Definí PGHOST}" "${PGUSER:?Definí PGUSER}" "${PGDATABASE:?Definí PGDATABASE}"
backup_dir="${BACKUP_DIR:-backups}"
mkdir -p "$backup_dir"
backup_partial="$(mktemp "$backup_dir/modulab-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.partial")"
backup_file="${backup_partial%.partial}.dump"
trap 'rm -f "$backup_partial"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$backup_partial"
pg_restore --list "$backup_partial" > /dev/null
mv "$backup_partial" "$backup_file"
(cd "$backup_dir" && sha256sum "$(basename "$backup_file")") > "$backup_file.sha256"
# Retain forever unless explicitly configured. Keep at least seven days.
if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]]; then
  if [[ ! "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( BACKUP_RETENTION_DAYS < 7 )); then
    printf 'BACKUP_RETENTION_DAYS debe ser un entero >=7. No se eliminaron copias.\n' >&2
    exit 1
  fi
  find "$backup_dir" -maxdepth 1 -type f -name 'modulab-*.dump*' -mtime "+$BACKUP_RETENTION_DAYS" -delete
fi
touch "$backup_dir/.last-success"
printf 'Backup creado: %s\n' "$backup_file"
