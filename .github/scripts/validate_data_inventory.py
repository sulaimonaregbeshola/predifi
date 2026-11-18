#!/usr/bin/env python3
"""Validate that all user-linked data stores are documented in docs/data-inventory.md.

This script cross-references:
  - backend/migrations/*.sql            (database tables)
  - backend/src/openapi.rs              (API schemas)
  - worker payload structs              (stellar_listener, sync, indexer/worker)

against docs/data-inventory.md and fails if any table, schema, or payload is
undocumented.

Exit codes:
  0 - all stores documented
  1 - undocumented stores found
  2 - inventory file or source files missing / unreadable
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Store:
    """A single user-linked data store discovered in source code."""

    kind: str  # "table" | "schema" | "payload"
    name: str
    source: str  # file path where it was found


@dataclass
class Report:
    documented: list[Store] = field(default_factory=list)
    undocumented: list[Store] = field(default_factory=list)
    inventory_entries: set[str] = field(default_factory=set)


# ---------------------------------------------------------------------------
# Discovery helpers
# ---------------------------------------------------------------------------


# Matches: CREATE TABLE [IF NOT EXISTS] [schema.]name
_CREATE_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    r"(?:\"?[A-Za-z_][A-Za-z0-9_]*\"?\.)?"
    r"\"?([A-Za-z_][A-Za-z0-9_]*)\"?",
    re.IGNORECASE,
)

# Matches: ALTER TABLE [ONLY] [schema.]name
_ALTER_TABLE_RE = re.compile(
    r"ALTER\s+TABLE\s+(?:ONLY\s+)?"
    r"(?:\"?[A-Za-z_][A-Za-z0-9_]*\"?\.)?"
    r"\"?([A-Za-z_][A-Za-z0-9_]*)\"?",
    re.IGNORECASE,
)

# Matches: DROP TABLE [IF EXISTS] [schema.]name  (used to skip dropped tables)
_DROP_TABLE_RE = re.compile(
    r"DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"
    r"(?:\"?[A-Za-z_][A-Za-z0-9_]*\"?\.)?"
    r"\"?([A-Za-z_][A-Za-z0-9_]*)\"?",
    re.IGNORECASE,
)

# Matches Rust struct definitions: pub struct Name { ... } or struct Name { ... }
_STRUCT_RE = re.compile(
    r"(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)",
)

# Matches utoipa schema registration: schema = ... or #[schema(...)] / components(schemas(...))
_OPENAPI_SCHEMA_RE = re.compile(
    r"(?:schemas?\s*\(\s*|schema\s*=\s*|#\[schema\()"
    r"([A-Za-z_][A-Za-z0-9_]*)",
)

# Matches a schema name inside components(schemas(A, B, C))
_COMPONENTS_SCHEMAS_RE = re.compile(
    r"components\s*\(\s*schemas\s*\(([^)]*)\)",
    re.IGNORECASE | re.DOTALL,
)

# Matches a markdown table row: | name | ... |
_MD_TABLE_ROW_RE = re.compile(r"^\s*\|\s*`?([A-Za-z_][A-Za-z0-9_.]*)`?\s*\|")

# Matches a markdown heading or bullet that names a store, e.g.
#   ### `users`
#   - `users` — ...
_MD_HEADING_RE = re.compile(r"^\s*#{1,6}\s+`?([A-Za-z_][A-Za-z0-9_.]*)`?\s*$")
_MD_BULLET_RE = re.compile(r"^\s*[-*]\s+`([A-Za-z_][A-Za-z0-9_.]*)`")


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:  # pragma: no cover - defensive
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        raise SystemExit(2)


def discover_tables(migrations_dir: Path) -> list[Store]:
    """Discover tables created by SQL migrations."""
    stores: list[Store] = []
    if not migrations_dir.is_dir():
        print(f"error: migrations directory not found: {migrations_dir}", file=sys.stderr)
        raise SystemExit(2)

    created: dict[str, Store] = {}
    dropped: set[str] = set()

    for sql_file in sorted(migrations_dir.glob("*.sql")):
        text = _read(sql_file)
        # Strip line comments so commented-out DDL is ignored.
        text = re.sub(r"--[^\n]*", "", text)
        for match in _CREATE_TABLE_RE.finditer(text):
            name = match.group(1)
            created[name] = Store("table", name, str(sql_file))
        for match in _DROP_TABLE_RE.finditer(text):
            dropped.add(match.group(1))

    for name, store in created.items():
        if name in dropped:
            continue
        stores.append(store)
    return stores


def discover_openapi_schemas(openapi_file: Path) -> list[Store]:
    """Discover API schemas registered in openapi.rs."""
    if not openapi_file.is_file():
        print(f"error: openapi file not found: {openapi_file}", file=sys.stderr)
        raise SystemExit(2)

    text = _read(openapi_file)
    names: set[str] = set()

    for block in _COMPONENTS_SCHEMAS_RE.finditer(text):
        for raw in block.group(1).split(","):
            name = raw.strip()
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
                names.add(name)

    for match in _OPENAPI_SCHEMA_RE.finditer(text):
        names.add(match.group(1))

    return [Store("schema", name, str(openapi_file)) for name in sorted(names)]


def discover_payloads(worker_dirs: Iterable[Path]) -> list[Store]:
    """Discover payload structs in worker crates."""
    stores: list[Store] = []
    for worker_dir in worker_dirs:
        if not worker_dir.is_dir():
            print(f"error: worker directory not found: {worker_dir}", file=sys.stderr)
            raise SystemExit(2)
        for rs_file in sorted(worker_dir.rglob("*.rs")):
            text = _read(rs_file)
            # Strip line comments to avoid matching commented-out structs.
            text = re.sub(r"//[^\n]*", "", text)
            for match in _STRUCT_RE.finditer(text):
                name = match.group(1)
                stores.append(Store("payload", name, str(rs_file)))
    return stores


# ---------------------------------------------------------------------------
# Inventory parsing
# ---------------------------------------------------------------------------


def parse_inventory(inventory_file: Path) -> set[str]:
    """Extract documented store names from the inventory markdown."""
    if not inventory_file.is_file():
        print(f"error: inventory file not found: {inventory_file}", file=sys.stderr)
        raise SystemExit(2)

    text = _read(inventory_file)
    names: set[str] = set()

    for line in text.splitlines():
        for regex in (_MD_TABLE_ROW_RE, _MD_HEADING_RE, _MD_BULLET_RE):
            match = regex.match(line)
            if match:
                names.add(match.group(1))
                break

    return names


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate(
    stores: Iterable[Store],
    documented_names: set[str],
) -> Report:
    report = Report(inventory_entries=set(documented_names))
    for store in stores:
        if store.name in documented_names:
            report.documented.append(store)
        else:
            report.undocumented.append(store)
    return report


def _format_store(store: Store) -> str:
    return f"  - [{store.kind}] {store.name}  ({store.source})"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Repository root (defaults to two levels above this script).",
    )
    parser.add_argument(
        "--inventory",
        type=Path,
        default=None,
        help="Path to docs/data-inventory.md (defaults to <root>/docs/data-inventory.md).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Also fail if the inventory documents names not found in source.",
    )
    args = parser.parse_args(argv)

    root: Path = args.root
    inventory_file = args.inventory or (root / "docs" / "data-inventory.md")

    migrations_dir = root / "backend" / "migrations"
    openapi_file = root / "backend" / "src" / "openapi.rs"
    worker_dirs = [
        root / "worker" / "stellar_listener",
        root / "worker" / "sync",
        root / "worker" / "indexer",
        root / "worker" / "indexer" / "worker",
    ]

    stores: list[Store] = []
    stores.extend(discover_tables(migrations_dir))
    stores.extend(discover_openapi_schemas(openapi_file))
    stores.extend(discover_payloads(worker_dirs))

    documented_names = parse_inventory(inventory_file)
    report = validate(stores, documented_names)

    if report.undocumented:
        print("Undocumented user-linked data stores detected:", file=sys.stderr)
        for store in report.undocumented:
            print(_format_store(store), file=sys.stderr)
        print(
            f"\nAdd these entries to {inventory_file.relative_to(root)} "
            "with owner, purpose, retention, and deletion path.",
            file=sys.stderr,
        )
        return 1

    if args.strict:
        discovered_names = {store.name for store in stores}
        stale = sorted(report.inventory_entries - discovered_names)
        if stale:
            print("Inventory documents stores not found in source:", file=sys.stderr)
            for name in stale:
                print(f"  - {name}", file=sys.stderr)
            return 1

    print(
        f"OK: {len(report.documented)} data stores documented in "
        f"{inventory_file.relative_to(root)}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())