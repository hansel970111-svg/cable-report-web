#!/usr/bin/env python3
from __future__ import annotations

import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

import fitz
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "tests/python"))

from pdf_engine.dispatch import edit_report  # noqa: E402
from pdf_engine.resources import EMBED_INSERT_FONTS  # noqa: E402
from pdf_golden import (  # noqa: E402
    GOLDEN_ROOT,
    RENDER_DPI,
    build_records,
    load_cases,
    write_golden_candidate,
)


MANAGED_PAGE_PATTERN = re.compile(r"^page-\d{3}\.png$")
REVIEW_ROOT = Path(tempfile.gettempdir()) / "pdfs/task5-golden-review"
_CLI_AUTHORIZATION = object()


def _assert_generation_environment() -> None:
    if EMBED_INSERT_FONTS is not False:
        raise AssertionError(
            "CABLE_REPORT_EMBED_INSERT_FONTS must be unset/false for canonical PDF goldens"
        )


def _assert_update_request(cases, authorization):
    if authorization is not _CLI_AUTHORIZATION:
        raise AssertionError("explicit CLI authorization is required to update PDF goldens")
    if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
        raise AssertionError("refusing to update PDF goldens in CI")
    approved = load_cases()
    selected = list(cases)
    if not selected:
        raise AssertionError("at least one explicitly selected approved case is required")
    if any(case not in approved for case in selected):
        raise AssertionError("every selected golden case must belong to the approved matrix")
    if len({case.name for case in selected}) != len(selected):
        raise AssertionError("duplicate selected golden cases are forbidden")
    return selected


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Explicitly generate PDF golden candidates for human approval.",
    )
    parser.add_argument("case_names", nargs="*", help="Approved case names to update")
    parser.add_argument("--all", action="store_true", help="Update all six approved cases")
    return parser


def _selected_cases(args: argparse.Namespace, parser: argparse.ArgumentParser):
    cases = load_cases()
    by_name = {case.name: case for case in cases}
    if args.all and args.case_names:
        parser.error("choose either --all or explicit case names, not both")
    if not args.all and not args.case_names:
        parser.error("explicit --all or approved case name selection is required")
    names = list(by_name) if args.all else args.case_names
    if len(names) != len(set(names)):
        parser.error("duplicate case names are not allowed")
    unknown = [name for name in names if name not in by_name]
    if unknown:
        parser.error(f"unapproved case name(s): {', '.join(unknown)}")
    return [by_name[name] for name in names]


def _assert_target_is_safe(target: Path, case_name: str) -> None:
    try:
        target.resolve().relative_to(GOLDEN_ROOT.resolve())
    except ValueError as error:
        raise AssertionError(f"golden target escapes approved root: {target}") from error
    if target.name != case_name or target.parent.resolve() != GOLDEN_ROOT.resolve():
        raise AssertionError(f"golden target is not one approved case directory: {target}")


def _assert_existing_target_is_managed(target: Path) -> None:
    if not target.exists():
        return
    if not target.is_dir() or target.is_symlink():
        raise AssertionError(f"golden target is not a directory: {target}")
    unmanaged = [
        path.name
        for path in target.iterdir()
        if not (
            path.is_file()
            and not path.is_symlink()
            and (path.name == "manifest.json" or MANAGED_PAGE_PATTERN.fullmatch(path.name))
        )
    ]
    if unmanaged:
        raise AssertionError(f"refusing to replace unmanaged golden files in {target}: {sorted(unmanaged)}")


def _recover_orphan_backup(target: Path) -> None:
    backups = sorted(target.parent.glob(f".{target.name}.backup-*"))
    if target.exists():
        if backups:
            raise AssertionError(
                f"ambiguous orphan backup state for {target}: target and backups both exist; "
                "restore manually"
            )
        return
    if not backups:
        return
    if len(backups) != 1:
        raise AssertionError(
            f"ambiguous orphan backup state for {target}: {backups}; restore manually"
        )
    os.replace(backups[0], target)


def _preflight_targets(cases) -> list[Path]:
    targets: list[Path] = []
    recovery_targets: list[Path] = []
    for case in cases:
        target = GOLDEN_ROOT / case.name
        _assert_target_is_safe(target, case.name)
        backups = sorted(target.parent.glob(f".{target.name}.backup-*"))
        if target.exists() and backups:
            raise AssertionError(
                f"ambiguous orphan backup state for {target}: target and backups both exist; "
                "restore manually"
            )
        if not target.exists() and len(backups) > 1:
            raise AssertionError(
                f"ambiguous orphan backup state for {target}: {backups}; restore manually"
            )
        managed_path = target if target.exists() else (backups[0] if backups else target)
        _assert_existing_target_is_managed(managed_path)
        if backups:
            recovery_targets.append(target)
        targets.append(target)
    for target in recovery_targets:
        _recover_orphan_backup(target)
    return targets


@contextmanager
def _update_lock(lock_path: Path):
    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise AssertionError(f"another PDF golden updater is already running: {lock_path}") from error
    try:
        os.write(descriptor, f"pid={os.getpid()}\n".encode("ascii"))
        os.close(descriptor)
        descriptor = -1
        yield
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        lock_path.unlink(missing_ok=True)


def _assert_generated_pdf(pdf_path: Path, expected_pages: int) -> None:
    with fitz.open(pdf_path) as document:
        if document.page_count != expected_pages:
            raise AssertionError(
                f"actual page count mismatch for {pdf_path.name}: expected {expected_pages}, got {document.page_count}"
            )
        if document.is_repaired:
            raise AssertionError(f"generated PDF required repair: {pdf_path}")
    with fitz.open(pdf_path) as reopened:
        if reopened.page_count != expected_pages or reopened.is_repaired:
            raise AssertionError(f"generated PDF failed clean reopen: {pdf_path}")


def _render_poppler(pdf_path: Path, output_dir: Path, expected_pages: int) -> list[Path]:
    executable = shutil.which("pdftoppm")
    if executable is None:
        raise RuntimeError("pdftoppm is required for the second-renderer approval review")
    prefix = output_dir / "poppler-page"
    result = subprocess.run(
        [executable, "-png", "-r", str(RENDER_DPI), str(pdf_path), str(prefix)],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pdftoppm failed for {pdf_path}: {result.stderr.strip()}")
    pages = sorted(output_dir.glob("poppler-page-*.png"))
    if len(pages) != expected_pages:
        raise AssertionError(f"Poppler page count mismatch: expected {expected_pages}, got {len(pages)}")
    for page in pages:
        with Image.open(page) as image:
            image.verify()
    return pages


def _prepare_review_artifacts(case, pdf_path: Path) -> Path:
    review_dir = REVIEW_ROOT / case.name
    if review_dir.exists():
        shutil.rmtree(review_dir)
    review_dir.mkdir(parents=True)
    shutil.copy2(pdf_path, review_dir / f"{case.name}.pdf")
    with fitz.open(pdf_path) as document:
        for page_index, page in enumerate(document):
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(RENDER_DPI / 72.0, RENDER_DPI / 72.0),
                colorspace=fitz.csRGB,
                alpha=False,
            )
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            image.save(review_dir / f"pymupdf-page-{page_index + 1:03d}.png")
    _render_poppler(pdf_path, review_dir, case.expected_pages)
    return review_dir


def _atomic_replace_case(candidate: Path, target: Path) -> None:
    _assert_existing_target_is_managed(target)
    backup = target.with_name(f".{target.name}.backup-{uuid.uuid4().hex}")
    if target.exists():
        os.replace(target, backup)
    try:
        os.replace(candidate, target)
    except BaseException:
        if backup.exists() and not target.exists():
            try:
                os.replace(backup, target)
            except BaseException as restore_error:
                raise RuntimeError(
                    f"failed to restore approved golden after interrupted replacement; "
                    f"backup remains at {backup}"
                ) from restore_error
        raise
    if backup.exists():
        shutil.rmtree(backup)


def update(cases, *, authorization=None) -> None:
    cases = _assert_update_request(cases, authorization)
    _assert_generation_environment()
    GOLDEN_ROOT.parent.mkdir(parents=True, exist_ok=True)
    lock_path = GOLDEN_ROOT.parent / ".pdf-golden-update.lock"
    with _update_lock(lock_path):
        _preflight_targets(cases)
        REVIEW_ROOT.mkdir(parents=True, exist_ok=True)
        stage_root = Path(tempfile.mkdtemp(prefix=".pdf-golden-stage-", dir=GOLDEN_ROOT.parent))
        prepared: list[tuple[object, Path, Path]] = []
        try:
            for case in cases:
                case_stage = stage_root / case.name
                pdf_path = stage_root / f"{case.name}.pdf"
                records = build_records(case)
                result = edit_report(
                    ROOT / case.template,
                    pdf_path,
                    records,
                    case.site,
                )
                if result.output != pdf_path or result.records != len(records):
                    raise AssertionError(f"PDF generation result mismatch for {case.name}: {result}")
                if result.pages != case.expected_pages:
                    raise AssertionError(f"reported page count mismatch for {case.name}: {result}")
                _assert_generated_pdf(pdf_path, case.expected_pages)
                write_golden_candidate(case, pdf_path, case_stage)
                review_dir = _prepare_review_artifacts(case, pdf_path)
                prepared.append((case, case_stage, review_dir))

            _preflight_targets(cases)
            GOLDEN_ROOT.mkdir(parents=True, exist_ok=True)
            for case, case_stage, review_dir in prepared:
                target = GOLDEN_ROOT / case.name
                _atomic_replace_case(case_stage, target)
                print(f"updated {case.name}: {target}")
                print(f"review PyMuPDF + Poppler pages: {review_dir}")
        finally:
            if stage_root.exists():
                shutil.rmtree(stage_root)


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    cases = _selected_cases(args, parser)
    if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
        print("refusing to update PDF goldens in CI", file=sys.stderr)
        return 2
    update(cases, authorization=_CLI_AUTHORIZATION)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
