from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import get_settings
from .maintenance import BackupManager, cleanup_old_files
from .storage import AppStorage


def main() -> None:
    parser = argparse.ArgumentParser(description="Personal AI OS maintenance tools")
    subparsers = parser.add_subparsers(dest="command", required=True)

    backup_parser = subparsers.add_parser("backup", help="Create a verified local backup")
    backup_parser.add_argument("--reason", default="manual")

    verify_parser = subparsers.add_parser("verify", help="Verify a backup by id")
    verify_parser.add_argument("backup_id")

    restore_parser = subparsers.add_parser("restore", help="Restore a backup database to a target file")
    restore_parser.add_argument("backup_id")
    restore_parser.add_argument("--target", required=True)
    restore_parser.add_argument("--overwrite", action="store_true")
    restore_parser.add_argument("--confirm", default="")

    subparsers.add_parser("list", help="List backups")
    subparsers.add_parser("integrity", help="Run live database integrity checks")
    subparsers.add_parser("cleanup", help="Clean old logs/temp files and apply backup retention")

    args = parser.parse_args()
    settings = get_settings()
    storage = AppStorage(settings.database_path())
    backups = BackupManager(settings, storage)
    try:
        if args.command == "backup":
            print(json.dumps(backups.create_backup(reason=args.reason), indent=2))
        elif args.command == "verify":
            print(json.dumps(backups.verify_backup(args.backup_id), indent=2))
        elif args.command == "restore":
            if args.overwrite and args.confirm != "RESTORE":
                raise SystemExit("--overwrite requires --confirm RESTORE")
            print(json.dumps(backups.restore_to(args.backup_id, Path(args.target), overwrite=args.overwrite), indent=2))
        elif args.command == "list":
            print(json.dumps([backup.as_dict() for backup in backups.list_backups()], indent=2))
        elif args.command == "integrity":
            print(json.dumps(storage.integrity_report(), indent=2))
        elif args.command == "cleanup":
            result = cleanup_old_files(settings)
            result["retention_removed"] = backups.apply_retention()
            print(json.dumps(result, indent=2))
    finally:
        storage.close()


if __name__ == "__main__":
    main()
