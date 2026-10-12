#!/usr/bin/env python3
"""Build a private, replay-safe SQL import from the reviewed corpus and catalogues."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> tuple[Any, bytes]:
    raw = path.read_bytes()
    return json.loads(raw), raw


def read_ledger(path: Path, delimiter: str) -> tuple[list[dict[str, str]], bytes]:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")
    return list(csv.DictReader(text.splitlines(), delimiter=delimiter)), raw


def sql(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    return "'" + str(value).replace("'", "''") + "'"


def insert(table: str, cols: list[str], values: list[Any]) -> str:
    return (
        f"INSERT INTO editorial.{table} ({', '.join(cols)}) VALUES "
        f"({', '.join(sql(v) for v in values)}) ON CONFLICT DO NOTHING;"
    )


def split_sources(value: Any) -> list[str]:
    if isinstance(value, list):
        raw = " ".join(str(x) for x in value)
    else:
        raw = str(value or "")
    # Source tokens may include page suffixes (P2 p.1) or use / as a separator.
    tokens = re.findall(r"\b[A-Za-z][A-Za-z0-9_-]*\b", raw)
    known = {"A1", "U2", "U3", *(f"S{i}" for i in range(1, 10)), *(f"P{i}" for i in range(1, 5))}
    return list(dict.fromkeys(token for token in tokens if token in known))


def date_payload(field: str, value: str) -> dict[str, Any] | None:
    if field not in {"birth", "death", "date", "birth_date", "death_date"} or not value:
        return None
    upper = value.upper()
    qualifier = "unknown"
    years = [int(x) for x in re.findall(r"(?<!\d)([1-9]\d{3})(?!\d)", value)]
    components = {"year": None, "month": None, "day": None}
    bounds = {"lower_bound": None, "upper_bound": None}
    month_names = {
        "JAN": 1, "JANUARY": 1, "GEN": 1, "GENNAIO": 1,
        "FEB": 2, "FEBRUARY": 2, "FEBBRAIO": 2,
        "MAR": 3, "MARCH": 3, "MARZO": 3,
        "APR": 4, "APRIL": 4, "APRILE": 4,
        "MAY": 5, "MAG": 5, "MAGGIO": 5,
        "JUN": 6, "JUNE": 6, "GIU": 6, "GIUGNO": 6,
        "JUL": 7, "JULY": 7, "LUG": 7, "LUGLIO": 7,
        "AUG": 8, "AUGUST": 8, "AGO": 8, "AGOSTO": 8,
        "SEP": 9, "SEPTEMBER": 9, "SET": 9, "SETTEMBRE": 9,
        "OCT": 10, "OCTOBER": 10, "OTT": 10, "OTTOBRE": 10,
        "NOV": 11, "NOVEMBER": 11, "NOVEMBRE": 11,
        "DEC": 12, "DECEMBER": 12, "DIC": 12, "DICEMBRE": 12,
    }
    full = re.search(r"\b(\d{1,2})\s+([A-Z]+)\s+([1-9]\d{3})\b", upper)
    month_year = re.search(r"\b([A-Z]+)\s+([1-9]\d{3})\b", upper)
    if "BETWEEN" in upper or re.search(r"\bAND\b", upper):
        qualifier, precision = "between", "interval"
        if len(years) >= 2:
            bounds = {
                "lower_bound": {"year": years[0], "month": None, "day": None},
                "upper_bound": {"year": years[1], "month": None, "day": None},
            }
    elif "ABT" in upper or "ABOUT" in upper or "CIRCA" in upper:
        qualifier, precision = "about", "year"
    elif "BEFORE" in upper or upper.startswith("<"):
        qualifier, precision = "before", "year"
    elif "AFTER" in upper or upper.startswith(">"):
        qualifier, precision = "after", "year"
    elif full and full.group(2) in month_names:
        qualifier, precision = "exact", "day"
        components = {"year": int(full.group(3)), "month": month_names[full.group(2)], "day": int(full.group(1))}
    elif month_year and month_year.group(1) in month_names:
        qualifier, precision = "exact", "month"
        components = {"year": int(month_year.group(2)), "month": month_names[month_year.group(1)], "day": None}
    else:
        precision = "year" if re.fullmatch(r"\s*\d{4}\s*", value) else "unknown"
        if precision == "year":
            qualifier = "exact"
            components = {"year": int(value.strip()), "month": None, "day": None}
    return {
        "literal": value,
        "qualifier": qualifier,
        "precision": precision,
        "components": components,
        **bounds,
        "normalization_note": "Literal preservado; componentes só incluem unidades de data explicitamente registradas.",
    }


def occurrence_state(status: str, has_object: bool) -> str:
    low = status.casefold()
    if any(x in low for x in ("falh", "erro", "missing", "não recuper")):
        return "failed" if not has_object else "recovered"
    if has_object or "recuperad" in low:
        return "recovered"
    return "indexed_only"


def safe_id(prefix: str, raw: str, suffix: str = "") -> str:
    token = re.sub(r"[^a-zA-Z0-9_-]+", "_", raw).strip("_")[:70] or "item"
    return f"{prefix}{token}{suffix}"


def build(args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    corpus, corpus_raw = read_json(args.source)
    site, site_raw = read_json(args.site_catalog)
    docs_obj, docs_raw = read_json(args.document_catalog)
    doc_ledger, doc_ledger_raw = read_ledger(args.document_ledger, ",")
    site_ledger, site_ledger_raw = read_ledger(args.site_ledger, ";")
    wayback_rows, wayback_raw = read_ledger(args.wayback_index, ",")
    commoncrawl_rows, commoncrawl_raw = read_ledger(args.commoncrawl_index, ",")
    docs = docs_obj.get("registros", [])
    if not isinstance(site, list) or not isinstance(docs, list):
        raise ValueError("Os catálogos precisam conter listas de registros.")
    for key in ("pessoas", "familias", "fontes", "parentescos", "afirmacoes"):
        if key not in corpus:
            raise ValueError(f"Corpus sem chave obrigatória {key!r}.")

    batch_inputs = {
        "source": sha256(corpus_raw),
        "site_catalog": sha256(site_raw),
        "document_catalog": sha256(docs_raw),
        "document_upload_ledger": sha256(doc_ledger_raw),
        "site_upload_ledger": sha256(site_ledger_raw),
        "wayback_index": sha256(wayback_raw),
        "commoncrawl_index": sha256(commoncrawl_raw),
        "importer": sha256(Path(__file__).read_bytes()),
    }
    raw_index_rows = [("wayback", x) for x in wayback_rows] + [("commoncrawl", x) for x in commoncrawl_rows]
    def index_key(origin: str, row: dict[str, str]) -> tuple[str, str, str, str]:
        url = row.get("original_url") if origin == "wayback" else row.get("url", "")
        timestamp = row.get("timestamp_utc") if origin == "wayback" else row.get("timestamp", "")
        return origin, str(url or ""), str(timestamp or ""), str(row.get("sha256_payload") or "").lower()
    unique_index_rows: dict[tuple[str, str, str, str], tuple[str, dict[str, str]]] = {}
    for origin, row in raw_index_rows:
        unique_index_rows.setdefault(index_key(origin, row), (origin, row))
    index_rows = list(unique_index_rows.values())
    def normalized_url(url: Any) -> str:
        return re.sub(r":80(?=/|$)", "", str(url or "")).rstrip("/")
    indexed_event_keys = {
        (origin, normalized_url(key[1]), key[2], key[3])
        for origin, row in index_rows for key in [index_key(origin, row)]
    }
    catalog_only_capture_count = 0
    for entry in site:
        for cap in entry.get("capturas_indexadas", []):
            origin = "wayback" if "wayback" in str(cap.get("corpus", "")).casefold() else "commoncrawl" if "commoncrawl" in str(cap.get("corpus", "")).casefold() else "other_archive"
            event = ("commoncrawl" if origin == "commoncrawl" else "wayback", normalized_url(entry.get("url_direta_original_inferida")), str(cap.get("timestamp_utc") or ""), str(cap.get("sha256_payload_capturado") or ""))
            if event not in indexed_event_keys:
                catalog_only_capture_count += 1
    payload_sha = sha256(json.dumps(batch_inputs, sort_keys=True).encode())
    manifest = {
        "batch_id": payload_sha,
        "payload_sha256": payload_sha,
        "inputs": batch_inputs,
        "counts": {
            "people": len(corpus["pessoas"]),
            "groups": len(corpus["familias"]),
            "source_records": len(corpus["fontes"]),
            "parent_edges": len(corpus["parentescos"]),
            "claims": len(corpus["afirmacoes"]),
            "site_items": len(site),
            "site_capture_occurrences": sum(len(x.get("capturas_indexadas", [])) for x in site),
            "document_items": len(docs),
            "site_upload_ledger_items": len(site_ledger),
            "document_upload_ledger_items": len(doc_ledger),
            "wayback_index_rows": len(wayback_rows),
            "wayback_index_unique_occurrences": sum(origin == "wayback" for origin, _ in index_rows),
            "commoncrawl_index_rows": len(commoncrawl_rows),
            "commoncrawl_index_unique_occurrences": sum(origin == "commoncrawl" for origin, _ in index_rows),
            "site_catalog_occurrences_not_in_detailed_indexes": catalog_only_capture_count,
        },
        "note": "Importação privada de dados; sem aprovação de publicação.",
    }
    statements: list[str] = [
        "-- PRIVATE DATA: never commit this file. Generated by scripts/import-editorial.py.",
        "BEGIN;",
        "SELECT pg_advisory_xact_lock(hashtext('zaniratti-editorial-import'));",
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM editorial.import_batch WHERE batch_id = "
        + sql(payload_sha)
        + " AND payload_sha256 <> "
        + sql(payload_sha)
        + ") THEN RAISE EXCEPTION 'batch hash mismatch'; END IF; END $$;",
        insert("import_batch", ["batch_id", "payload_sha256", "manifest"], [payload_sha, payload_sha, manifest]),
    ]

    objects: dict[str, tuple[str, str, int, str]] = {}
    sources: dict[str, dict[str, Any]] = {}
    source_capture_ids: dict[str, str] = {}

    # Reviewed source catalog used directly by corpus facts.
    for source_id, item in corpus["fontes"].items():
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", source_id):
            raise ValueError(f"Identificador de fonte inválido: {source_id!r}")
        if source_id.startswith("P") and source_id[1:].isdigit():
            kind = "provided_document"
        elif source_id.startswith("U"):
            kind = "family_testimony"
        elif source_id.startswith("S"):
            kind = "historic_site"
        else:
            kind = "other"
        sources[source_id] = item
        statements.append(insert("source", ["id", "title_private", "kind", "original_url_private", "disclosure", "note_private"], [
            source_id, item.get("title", source_id), kind, item.get("url") or None, "restricted", item.get("note", "")
        ]))

    def add_object(hash_value: Any, locator: str, mime: str, byte_count: Any, provenance: str) -> None:
        if not hash_value:
            return
        h = str(hash_value).lower()
        if not re.fullmatch(r"[0-9a-f]{64}", h):
            raise ValueError(f"SHA-256 inválido no catálogo: {hash_value!r}")
        objects.setdefault(h, (locator or "private locator not supplied", mime or "application/octet-stream", int(byte_count or 0), provenance))

    for entry in site:
        add_object(entry.get("sha256_local"), entry.get("arquivo_local", ""), entry.get("mime_local"), entry.get("bytes"), "archive_payload")
    doc_ledger_by_sha = {str(x.get("sha256", "")).lower(): x for x in doc_ledger if x.get("sha256")}
    for entry in docs:
        ledger = doc_ledger_by_sha.get(str(entry.get("sha256", "")).lower(), {})
        add_object(entry.get("sha256"), ledger.get("drive_url") or entry.get("caminho_local", ""), entry.get("mime_type"), entry.get("bytes"), "received_original" if "privad" in str(entry.get("tipo_citacao", "")).casefold() else "archive_payload")
    for entry in site_ledger:
        add_object(entry.get("sha256_local"), entry.get("drive_url") or entry.get("file_local", ""), "application/zip" if ".zip" in str(entry.get("file_local", "")).lower() else "text/plain", entry.get("bytes_local"), "archive_payload")
    verified_index_objects: dict[str, tuple[str, str, int, str]] = {}
    for origin, row in index_rows:
        raw_path = row.get("raw_path") if origin == "wayback" else row.get("extracted_payload")
        expected = str(row.get("sha256_payload") or "").lower()
        if raw_path and re.fullmatch(r"[0-9a-f]{64}", expected):
            root = args.wayback_index.parent if origin == "wayback" else args.commoncrawl_index.parent
            candidate = root / raw_path
            if candidate.is_file() and sha256(candidate.read_bytes()) == expected:
                verified_index_objects[expected] = (str(candidate), row.get("mimetype") or row.get("mime") or "application/octet-stream", candidate.stat().st_size, "archive_payload")
    objects.update(verified_index_objects)
    for h, (locator, mime, count, provenance) in objects.items():
        statements.append(insert("original_object", ["sha256", "private_locator", "mime", "bytes", "provenance_kind", "note_private"], [h, locator, mime, count, provenance, "Metadata only; source bytes remain in the private archive."]))

    # People and independently typed family groups. The group does not imply marriage.
    for person_id in corpus["pessoas"]:
        statements.append(insert("person", ["id", "legacy_id", "life_status", "disclosure"], [person_id, person_id, "unknown", "restricted"]))
    statements.append(insert("branch", ["id", "title_pt", "title_it", "description_private", "disclosure"], [
        "salvatonica-san-biagio", "Salvatonica / San Biagio", "Salvatonica / San Biagio", "Nome de ramo registrado no corpus revisado.", "restricted"
    ]))
    branch_members = set()
    for pid, person in corpus["pessoas"].items():
        notes = " ".join(str(x) for x in person.get("notes", []))
        if "Ramo Salvatonica/San Biagio" in notes:
            branch_members.add(pid)
        if person.get("name") and person.get("sources"):
            aid = f"person-label:{pid}"
            statements.append(insert("assertion", ["id", "subject_person_id", "predicate", "value_literal", "interpretation", "evidence_class", "disclosure", "note_private"], [
                aid, pid, "legacy_label", person["name"], "annotation", "label from reviewed corpus", "restricted", "Person label carried forward from corpus; see source citations."
            ]))
            for n, sid in enumerate(split_sources(person.get("sources")), 1):
                if sid not in sources:
                    raise ValueError(f"Fonte {sid} ausente para rótulo de {pid}")
                statements.append(insert("citation", ["id", "assertion_id", "source_id", "evidence_role", "locator", "disclosure"], [
                    f"citation:{aid}:{n}", aid, sid, "context", "Pessoa.sources (corpus revisado)", "restricted"
                ]))
    for pid in sorted(branch_members):
        statements.append(insert("person_branch", ["person_id", "branch_id"], [pid, "salvatonica-san-biagio"]))
    for group_id, group in corpus["familias"].items():
        statements.append(insert("family_group", ["id", "legacy_id", "kind", "note_private", "disclosure"], [
            group_id, group_id, "parental_group", group.get("note", ""), "restricted"
        ]))
        for role, key in (("parent", "father"), ("parent", "mother")):
            person_id = group.get(key)
            if person_id:
                statements.append(insert("group_participant", ["group_id", "person_id", "role"], [group_id, person_id, role]))
        for person_id in group.get("children", []):
            statements.append(insert("group_participant", ["group_id", "person_id", "role"], [group_id, person_id, "child"]))

    # Catalogue source records and occurrence rows; every capture timestamp remains text.
    def catalog_source(source_id: str, title: str, kind: str, url: str | None, note: str) -> None:
        if source_id not in sources:
            sources[source_id] = {}
            statements.append(insert("source", ["id", "title_private", "kind", "original_url_private", "disclosure", "note_private"], [source_id, title, kind, url, "restricted", note]))

    index_capture_ids: dict[tuple[str, str, str, str], str] = {}
    for origin, row in index_rows:
        key = index_key(origin, row)
        _, original_url, timestamp, payload_hash = key
        source_id = f"index-url-{sha256(original_url.encode())[:20]}"
        catalog_source(source_id, original_url or "Archive index row", "historic_site", original_url or None, "Private index record. This metadata does not by itself support a family fact.")
        capture_id = f"occ-index-{origin}-{sha256(chr(0).join(key).encode())[:32]}"
        index_capture_ids[key] = capture_id
        object_hash = payload_hash if payload_hash in verified_index_objects else None
        snapshot = row.get("snapshot") if origin == "wayback" else row.get("record_url")
        locator = snapshot or row.get("record_url") or original_url
        raw_status = row.get("http_original") if origin == "wayback" else row.get("status")
        try:
            http_status = int(raw_status) if 100 <= int(raw_status) <= 599 else None
        except (TypeError, ValueError):
            http_status = None
        availability = str(row.get("disponibilidade_atual") or row.get("retrieval_http") or "")
        failed = any(word in availability.casefold() for word in ("erro", "falha", "failed", "indisponível"))
        state = "recovered" if object_hash else "failed" if failed else "indexed_only"
        mime = row.get("mimetype") if origin == "wayback" else row.get("mime")
        digest = row.get("digest_cdx_sha1_base32") if origin == "wayback" else row.get("digest")
        statements.append(insert("capture_occurrence", ["id", "source_id", "object_sha256", "origin_kind", "original_url_private", "origin_locator_private", "replay_url_private", "capture_timestamp", "capture_precision", "indexed_mime", "http_status", "indexed_digest", "expected_payload_sha256", "recovery_state", "index_record_private", "note_private"], [
            capture_id, source_id, object_hash, origin, original_url or None, locator, row.get("snapshot") if origin == "wayback" else row.get("record_url"), timestamp or None,
            "exact" if timestamp else "unknown", mime or None, http_status, digest or None,
            payload_hash if re.fullmatch(r"[0-9a-f]{64}", payload_hash) else None, state, row,
            "Index metadata preserved. Expected hash is not a recovered object unless object_sha256 is present."
        ]))
        for core_source_id, core_source in corpus["fontes"].items():
            if snapshot and snapshot == core_source.get("url"):
                source_capture_ids.setdefault(core_source_id, capture_id)

    for i, entry in enumerate(site):
        path = str(entry.get("arquivo_local") or f"site-item-{i}")
        identity = sha256(path.encode())[:20]
        sid = f"catalog-site-{identity}"
        catalog_source(sid, path, "other", entry.get("url_direta_original_inferida"), entry.get("nota", ""))
        local_hash = entry.get("sha256_local")
        if local_hash:
            if local_hash not in objects:
                raise ValueError(f"Objeto local de site sem metadata: {path}")
            oid = f"occ-site-{identity}-local"
            statements.append(insert("source_object", ["source_id", "object_sha256"], [sid, local_hash]))
            statements.append(insert("capture_occurrence", ["id", "source_id", "object_sha256", "origin_kind", "original_url_private", "origin_locator_private", "capture_precision", "recovery_state", "indexed_mime", "expected_payload_sha256", "note_private"], [
                oid, sid, local_hash, "local_derivation", entry.get("url_direta_original_inferida"), path, "unknown", "derived", entry.get("mime_local"), local_hash,
                "Local catalog object; its bytes are retained in the private archive."
            ]))
        # Preserve catalog-only capture hints when the full indexes do not contain them.
        for j, cap in enumerate(entry.get("capturas_indexadas", [])):
            h = str(cap.get("sha256_payload_capturado") or "").lower()
            origin_label = str(cap.get("corpus", ""))
            origin = "wayback" if "wayback" in origin_label.casefold() else "commoncrawl" if "commoncrawl" in origin_label.casefold() else "other_archive"
            event = ("commoncrawl" if origin == "commoncrawl" else "wayback", normalized_url(entry.get("url_direta_original_inferida")), str(cap.get("timestamp_utc") or ""), h)
            if event in indexed_event_keys:
                continue
            cap_url = cap.get("snapshot") or entry.get("url_direta_original_inferida") or path
            statements.append(insert("capture_occurrence", ["id", "source_id", "object_sha256", "origin_kind", "original_url_private", "origin_locator_private", "replay_url_private", "capture_timestamp", "capture_precision", "indexed_mime", "http_status", "indexed_digest", "expected_payload_sha256", "recovery_state", "index_record_private", "note_private"], [
                f"occ-site-{identity}-catalog-{j:04d}", sid, h if h in objects else None, origin, entry.get("url_direta_original_inferida"), cap_url, cap.get("snapshot"), cap.get("timestamp_utc"), "exact" if cap.get("timestamp_utc") else "unknown",
                cap.get("mime_indexado"), int(cap["status_original"]) if str(cap.get("status_original", "")).isdigit() and 100 <= int(cap["status_original"]) <= 599 else None,
                cap.get("digest_cdx"), h if re.fullmatch(r"[0-9a-f]{64}", h) else None, "indexed_only", cap,
                "Catalog capture hint not matched to a detailed Wayback/Common Crawl index row."
            ]))

    for entry in docs:
        archive_id = str(entry.get("arquivo_id") or sha256(str(entry).encode())[:16])
        sid = f"catalog-doc-{archive_id}"
        title = str(entry.get("arquivo") or archive_id)
        citation_kind = str(entry.get("tipo_citacao", ""))
        kind = "provided_document" if "privado" in citation_kind.casefold() or "fornecido" in citation_kind.casefold() else "archive_document"
        ledger = doc_ledger_by_sha.get(str(entry.get("sha256", "")).lower(), {})
        locator = ledger.get("drive_url") or entry.get("caminho_local") or entry.get("origem_canonica") or title
        catalog_source(sid, title, kind, entry.get("url_original") or None, str(entry.get("nota", "")))
        h = str(entry.get("sha256") or "").lower() or None
        if h:
            statements.append(insert("source_object", ["source_id", "object_sha256"], [sid, h]))
        state = "received" if h else "missing"
        ledger_event = "" if not ledger else f"Drive file ID={ledger.get('drive_file_id','')}; state={ledger.get('estado_upload','')}; {ledger.get('upload_type','')}; {ledger.get('verificacao_hash','')}"
        statements.append(insert("capture_occurrence", ["id", "source_id", "object_sha256", "origin_kind", "original_url_private", "origin_locator_private", "capture_timestamp", "capture_precision", "retrieval_event_private", "indexed_mime", "expected_payload_sha256", "recovery_state", "note_private"], [
            f"occ-doc-{archive_id}-local", sid, h, "received" if "privad" in citation_kind.casefold() or "fornecido" in citation_kind.casefold() else "local_derivation",
            entry.get("url_original") or None, locator, ledger.get("uploaded_on_utc_date") or entry.get("capturado_em_utc") or None,
            "date" if ledger.get("uploaded_on_utc_date") else "exact" if entry.get("capturado_em_utc") else "unknown",
            "; ".join(x for x in (entry.get("evento_retrieval", ""), ledger_event) if x), entry.get("mime_type"), h, state,
            f"custodia={entry.get('custodia','')}; estado_publicacao={entry.get('estado_publicacao','')}; {entry.get('nota','')}"
        ]))
    for source_id, source_item in corpus["fontes"].items():
        match = re.search(r"SHA-256\s+([0-9a-f]{64})", str(source_item.get("note", "")), re.IGNORECASE)
        if match and match.group(1).lower() in objects:
            statements.append(insert("source_object", ["source_id", "object_sha256"], [source_id, match.group(1).lower()]))
            for entry in docs:
                if str(entry.get("sha256", "")).lower() == match.group(1).lower():
                    archive_id = str(entry.get("arquivo_id") or sha256(str(entry).encode())[:16])
                    source_capture_ids[source_id] = f"occ-doc-{archive_id}-local"
                    break

    for i, entry in enumerate(site_ledger):
        file_local = str(entry.get("file_local") or f"site-ledger-{i}")
        identity = sha256(file_local.encode())[:20]
        sid = f"catalog-site-preservation-{identity}"
        title = str(entry.get("bundle_or_resource") or Path(file_local).name)
        url = entry.get("drive_url") or None
        catalog_source(sid, title, "provided_document", url, str(entry.get("verificacao", "")))
        h = str(entry.get("sha256_local") or "").lower() or None
        if h:
            statements.append(insert("source_object", ["source_id", "object_sha256"], [sid, h]))
        statements.append(insert("capture_occurrence", ["id", "source_id", "object_sha256", "origin_kind", "origin_locator_private", "capture_timestamp", "capture_precision", "retrieval_event_private", "expected_payload_sha256", "recovery_state", "note_private"], [
            f"occ-site-preservation-{identity}", sid, h, "received", url or file_local,
            None, "unknown", f"Drive file ID={entry.get('drive_file_id','')}; bundle={entry.get('bundle_or_resource','')}; order={entry.get('part_order','')}; offsets={entry.get('byte_offset_start','')}:{entry.get('byte_offset_end_exclusive','')}",
            h, "received" if h else "missing", str(entry.get("verificacao", ""))
        ]))

    # Assertions and explicit parent edges preserve original literal values, classes, and citations.
    def add_citation(assertion_id: str, source_id: str, index: int, locator: str, role: str = "support") -> None:
        if source_id not in sources:
            raise ValueError(f"Fonte {source_id!r} referida mas ausente no catálogo editorial.")
        statements.append(insert("citation", ["id", "assertion_id", "source_id", "capture_id", "evidence_role", "locator", "disclosure"], [
            f"citation:{assertion_id}:{index}", assertion_id, source_id, source_capture_ids.get(source_id), role, locator, "restricted"
        ]))

    for i, edge in enumerate(corpus["parentescos"], 1):
        pid, child = edge["parent"], edge["child"]
        if pid not in corpus["pessoas"] or child not in corpus["pessoas"]:
            raise ValueError(f"Aresta {i} aponta para pessoa inexistente: {pid} -> {child}")
        aid = f"parent-edge:{i:03d}"
        statements.append(insert("assertion", ["id", "subject_person_id", "target_person_id", "predicate", "value_literal", "interpretation", "evidence_class", "disclosure", "note_private"], [
            aid, pid, child, "parent_of", "", "preferred", edge.get("classe", "unknown"), "restricted", edge.get("nota", "")
        ]))
        for n, sid in enumerate(split_sources(edge.get("fontes")), 1):
            add_citation(aid, sid, n, "Parentesco.fontes (corpus revisado)")

    for i, claim in enumerate(corpus["afirmacoes"], 1):
        pid = claim.get("pessoa_id")
        if pid not in corpus["pessoas"]:
            raise ValueError(f"Afirmação {i} aponta para pessoa inexistente: {pid}")
        aid = f"claim:{i:03d}"
        field = str(claim.get("campo", "unknown"))
        date = date_payload(field, str(claim.get("valor", "")))
        interpretation = "preferred" if str(claim.get("adotado", "")).casefold() in {"sim", "yes", "true"} else "alternative"
        statements.append(insert("assertion", ["id", "subject_person_id", "predicate", "value_literal", "date_value", "interpretation", "evidence_class", "disclosure", "note_private"], [
            aid, pid, field, str(claim.get("valor", "")), date, interpretation, claim.get("classe", "unknown"), "restricted", claim.get("nota", "")
        ]))
        for n, sid in enumerate(split_sources(claim.get("fonte")), 1):
            add_citation(aid, sid, n, claim.get("pagina", "") or "Afirmação.fonte (corpus revisado)")

    statements.extend([
        "COMMIT;",
        f"-- Batch {payload_sha}; rerunning identical SQL uses ON CONFLICT DO NOTHING and emits no duplicate audit rows.",
    ])
    return "\n".join(statements) + "\n", manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Reviewed persons/relationships JSON source (required).")
    parser.add_argument("--site-catalog", required=True, type=Path, help="Private site preservation/catalog JSON.")
    parser.add_argument("--document-catalog", required=True, type=Path, help="Private document catalog JSON.")
    parser.add_argument("--site-ledger", required=True, type=Path, help="Private semicolon-delimited site upload ledger.")
    parser.add_argument("--document-ledger", required=True, type=Path, help="Private UTF-8-SIG CSV upload ledger.")
    parser.add_argument("--wayback-index", required=True, type=Path, help="Wayback index CSV with capture-level metadata.")
    parser.add_argument("--commoncrawl-index", required=True, type=Path, help="Common Crawl index CSV with capture-level metadata.")
    parser.add_argument("--output-dir", required=True, type=Path, help="Private output directory outside the checkout.")
    args = parser.parse_args()
    try:
        repo_root = Path(__file__).resolve().parents[1]
        output_dir = args.output_dir.resolve()
        if output_dir == repo_root or repo_root in output_dir.parents:
            raise ValueError(f"--output-dir must be outside the checkout ({repo_root}).")
        sql_text, manifest = build(args)
        output_dir.mkdir(parents=True, exist_ok=True)
        sql_path = output_dir / f"editorial-import-{manifest['batch_id']}.sql"
        manifest_path = output_dir / f"editorial-import-{manifest['batch_id']}.manifest.json"
        sql_path.write_text(sql_text, encoding="utf-8")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"sql": str(sql_path), "manifest": str(manifest_path), **manifest}, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"import-editorial: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
