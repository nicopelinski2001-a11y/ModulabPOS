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
sha256sum "$backup_file" > "$backup_file.sha256"
# No eliminar automáticamente copias previas. La retención se configura según almacenamiento.
printf 'Backup creado: %s\n' "$backup_file"
