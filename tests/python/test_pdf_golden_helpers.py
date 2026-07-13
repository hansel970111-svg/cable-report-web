from __future__ import annotations

from copy import deepcopy
from datetime import datetime as RealDateTime
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

import fitz
from PIL import Image
import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import pdf_golden  # noqa: E402
import update_pdf_goldens  # noqa: E402
from pdf_engine import summary as pdf_summary  # noqa: E402
from pdf_engine.dispatch import edit_report  # noqa: E402
from pdf_golden import (  # noqa: E402
    APPROVED_CASE_NAMES,
    PRINTED_MASK_RECT,
    assert_pdf_matches_golden,
    build_records,
    load_cases,
    write_golden_candidate,
)


def _tree_digest(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    return {
        str(item.relative_to(path)): hashlib.sha256(item.read_bytes()).hexdigest()
        for item in sorted(path.rglob("*"))
        if item.is_file()
    }


def _generate_case_pdf(case, output: Path) -> None:
    records = build_records(case)
    result = edit_report(
        ROOT / case.template,
        output,
        records,
        case.site,
    )
    assert result.output == output
    assert result.pages == case.expected_pages
    assert result.records == len(records)


@pytest.fixture(scope="module")
def approved_candidate(tmp_path_factory):
    root = tmp_path_factory.mktemp("approved-candidate")
    case = next(case for case in load_cases() if case.name == "cat5e-minimal")
    pdf_path = root / "cat5e-minimal.pdf"
    golden_dir = root / "cat5e-minimal"
    _generate_case_pdf(case, pdf_path)
    write_golden_candidate(case, pdf_path, golden_dir)
    return case, pdf_path, golden_dir


@pytest.fixture(scope="module")
def cat5e_cross_pdf(tmp_path_factory):
    root = tmp_path_factory.mktemp("cat5e-cross")
    case = next(case for case in load_cases() if case.name == "cat5e-cross-page")
    pdf_path = root / "cat5e-cross-page.pdf"
    _generate_case_pdf(case, pdf_path)
    return case, pdf_path


def _copy_candidate(approved_candidate, tmp_path: Path):
    case, source_pdf, source_golden = approved_candidate
    pdf_path = tmp_path / source_pdf.name
    golden_dir = tmp_path / source_golden.name
    shutil.copy2(source_pdf, pdf_path)
    shutil.copytree(source_golden, golden_dir)
    return case, pdf_path, golden_dir


def _read_manifest(golden_dir: Path) -> dict[str, object]:
    return json.loads((golden_dir / "manifest.json").read_text(encoding="utf-8"))


def _write_manifest(golden_dir: Path, manifest: dict[str, object]) -> None:
    (golden_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )


def test_exact_six_case_matrix_is_validated() -> None:
    cases = load_cases()

    assert tuple(case.name for case in cases) == APPROVED_CASE_NAMES
    assert len({case.name for case in cases}) == 6
    assert {(case.kind, case.record_count, case.expected_pages) for case in cases} == {
        ("cat5e", 2, 1),
        ("cat5e", 49, 2),
        ("mpo", 2, 1),
        ("mpo", 49, 2),
        ("lc", 2, 1),
        ("lc", 49, 2),
    }
    assert all(case.site == "M138-DE46" for case in cases)
    assert all((ROOT / case.template).is_file() for case in cases)


def test_hashed_fixture_uses_checkout_stable_lf_bytes() -> None:
    fixture_path = ROOT / "tests/python/fixtures/pdf-cases.json"
    attributes = (ROOT / ".gitattributes").read_text(encoding="utf-8").splitlines()

    assert "tests/python/fixtures/pdf-cases.json text eol=lf" in attributes
    assert b"\r\n" not in fixture_path.read_bytes()


def test_renderer_contract_uses_the_security_fixed_runtime() -> None:
    assert pdf_golden.RENDERER_VERSION == "1.26.7"
    assert fitz.VersionBind == pdf_golden.RENDERER_VERSION


def test_case_loader_rejects_traversal_and_matrix_shrinkage(tmp_path: Path) -> None:
    raw = json.loads((ROOT / "tests/python/fixtures/pdf-cases.json").read_text(encoding="utf-8"))
    raw[0]["name"] = "../cat5e-minimal"
    path = tmp_path / "unsafe.json"
    path.write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(AssertionError, match="safe slug|approved case matrix"):
        load_cases(path)

    raw = raw[1:]
    path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(AssertionError, match="approved case matrix"):
        load_cases(path)


def test_comparator_accepts_a_valid_temporary_candidate(approved_candidate) -> None:
    _, pdf_path, golden_dir = approved_candidate
    assert_pdf_matches_golden(pdf_path, golden_dir)


@pytest.mark.parametrize("case", load_cases(), ids=lambda case: case.name)
def test_candidate_writer_validates_each_approved_case(case, tmp_path: Path) -> None:
    pdf_path = tmp_path / f"{case.name}.pdf"
    golden_dir = tmp_path / case.name
    _generate_case_pdf(case, pdf_path)
    write_golden_candidate(case, pdf_path, golden_dir)

    manifest = _read_manifest(golden_dir)
    expected_printed_counts = [0] * (case.expected_pages - 1) + [3 if case.kind == "lc" else 1]
    assert manifest["printed"]["span_counts"] == expected_printed_counts
    assert_pdf_matches_golden(pdf_path, golden_dir)


@pytest.mark.parametrize("manifest_contents", ["{}", "not-json"])
def test_empty_or_invalid_manifest_is_rejected(
    approved_candidate,
    tmp_path: Path,
    manifest_contents: str,
) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    (golden_dir / "manifest.json").write_text(manifest_contents, encoding="utf-8")

    with pytest.raises(AssertionError, match="manifest"):
        assert_pdf_matches_golden(pdf_path, golden_dir)


def test_missing_or_corrupt_pdf_is_rejected(approved_candidate, tmp_path: Path) -> None:
    _, _, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    missing = tmp_path / "missing.pdf"
    with pytest.raises(AssertionError, match="PDF missing"):
        assert_pdf_matches_golden(missing, golden_dir)

    corrupt = tmp_path / "corrupt.pdf"
    corrupt.write_bytes(b"not a PDF")
    with pytest.raises(AssertionError, match="cannot open PDF"):
        assert_pdf_matches_golden(corrupt, golden_dir)


def test_actual_page_count_is_checked_independently(approved_candidate, tmp_path: Path) -> None:
    _, source_pdf, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    two_page_pdf = tmp_path / "two-pages.pdf"
    with fitz.open(source_pdf) as source:
        combined = fitz.open()
        combined.insert_pdf(source)
        combined.new_page(width=source[0].rect.width, height=source[0].rect.height)
        combined.save(two_page_pdf)
        combined.close()

    with pytest.raises(AssertionError, match="actual page count"):
        assert_pdf_matches_golden(two_page_pdf, golden_dir)


def test_candidate_writer_rejects_wrong_pdf_page_geometry(
    approved_candidate,
    tmp_path: Path,
) -> None:
    case, source_pdf, _ = approved_candidate
    wrong_size_pdf = tmp_path / "wrong-size.pdf"
    with fitz.open(source_pdf) as document:
        document[0].set_cropbox(fitz.Rect(0.0, 0.0, 594.0, 842.0))
        document.save(wrong_size_pdf)

    with pytest.raises(AssertionError, match="page geometry"):
        write_golden_candidate(
            case,
            wrong_size_pdf,
            tmp_path / "wrong-size" / case.name,
        )


def test_manifest_rejects_boolean_integer_fields(approved_candidate, tmp_path: Path) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    manifest = _read_manifest(golden_dir)
    manifest["schema_version"] = True
    manifest["case"]["expected_pages"] = True
    manifest["pdf"]["page_count"] = True
    manifest["printed"]["pages"] = [False]
    manifest["pages"][0]["index"] = False
    _write_manifest(golden_dir, manifest)

    with pytest.raises(AssertionError, match="integer|schema_version"):
        assert_pdf_matches_golden(pdf_path, golden_dir)


def test_manifest_rejects_nonfinite_json_numbers(approved_candidate, tmp_path: Path) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    manifest = _read_manifest(golden_dir)
    manifest["critical_rois"][0]["rect"][0] = math.nan
    _write_manifest(golden_dir, manifest)

    with pytest.raises(AssertionError, match="non-finite JSON constant"):
        assert_pdf_matches_golden(pdf_path, golden_dir)


@pytest.mark.parametrize("mutation", ["missing", "extra", "misnamed"])
def test_png_inventory_must_match_manifest(
    approved_candidate,
    tmp_path: Path,
    mutation: str,
) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    page = golden_dir / "page-001.png"
    if mutation == "missing":
        page.unlink()
    elif mutation == "extra":
        shutil.copy2(page, golden_dir / "page-999.png")
    else:
        page.rename(golden_dir / "page-01.png")

    with pytest.raises(AssertionError, match="PNG inventory"):
        assert_pdf_matches_golden(pdf_path, golden_dir)


@pytest.mark.parametrize("mutation", ["mode", "dimensions"])
def test_png_mode_and_dimensions_are_strict(
    approved_candidate,
    tmp_path: Path,
    mutation: str,
) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    page_path = golden_dir / "page-001.png"
    with Image.open(page_path) as source:
        image = source.copy()
    if mutation == "mode":
        image = image.convert("RGBA")
    else:
        image = image.crop((0, 0, image.width - 1, image.height))
    image.save(page_path)

    with pytest.raises(AssertionError, match=mutation):
        assert_pdf_matches_golden(pdf_path, golden_dir)


def test_single_result_icon_change_fails_strict_roi_and_writes_temp_diff(
    approved_candidate,
    tmp_path: Path,
) -> None:
    _, source_pdf, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    changed_pdf = tmp_path / "result-icon-changed.pdf"
    with fitz.open(source_pdf) as document:
        page = document[0]
        page.draw_rect(
            fitz.Rect(275.0, 143.0, 276.0, 144.0),
            color=(1.0, 0.0, 0.0),
            fill=(1.0, 0.0, 0.0),
            overlay=True,
        )
        document.save(changed_pdf)

    golden_before = _tree_digest(golden_dir)
    with pytest.raises(AssertionError, match="critical Result ROI"):
        assert_pdf_matches_golden(changed_pdf, golden_dir)
    assert list(tmp_path.glob("result-icon-changed-page-*-diff.png"))
    assert _tree_digest(golden_dir) == golden_before


@pytest.mark.parametrize("row_index", [2, 39], ids=["first-empty", "last-capacity-row"])
def test_empty_result_rows_are_inside_strict_roi(
    approved_candidate,
    tmp_path: Path,
    row_index: int,
) -> None:
    _, source_pdf, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    changed_pdf = tmp_path / f"unused-result-row-{row_index}.pdf"
    center = fitz.Point(277.0, 115.766 + 15.0 * row_index)
    with fitz.open(source_pdf) as document:
        document[0].draw_circle(
            center,
            6.0,
            color=(0.0, 0.6, 0.0),
            fill=(0.0, 0.6, 0.0),
            overlay=True,
        )
        document.save(changed_pdf)

    with pytest.raises(AssertionError, match="critical Result ROI"):
        assert_pdf_matches_golden(changed_pdf, golden_dir)


@pytest.mark.parametrize(
    "mutation",
    [
        "missing",
        "duplicate",
        "wrong-page",
        "length",
        "limit",
        "limit-order",
        "extra-length",
        "label-column",
        "duplicate-limit-token",
    ],
)
def test_candidate_writer_rejects_interior_row_semantic_mutations(
    cat5e_cross_pdf,
    tmp_path: Path,
    mutation: str,
) -> None:
    case, source_pdf = cat5e_cross_pdf
    changed_pdf = tmp_path / f"interior-{mutation}.pdf"
    with fitz.open(source_pdf) as document:
        first_page = document[0]
        label_rects = first_page.search_for("#C003")
        assert label_rects
        if mutation in {"missing", "wrong-page"}:
            for rect in label_rects:
                first_page.add_redact_annot(rect, fill=(1.0, 1.0, 1.0))
            first_page.apply_redactions()
        if mutation == "duplicate":
            first_page.insert_text(fitz.Point(27.0, 160.0), "#C003", fontsize=7.0)
        elif mutation == "wrong-page":
            document[1].insert_text(fitz.Point(27.0, 160.0), "#C003", fontsize=7.0)
        elif mutation == "length":
            first_page.add_redact_annot(
                fitz.Rect(295.0, 137.0, 316.0, 150.0),
                fill=(1.0, 1.0, 1.0),
            )
            first_page.apply_redactions()
        elif mutation == "limit":
            first_page.add_redact_annot(
                fitz.Rect(198.0, 137.0, 270.0, 150.0),
                fill=(1.0, 1.0, 1.0),
            )
            first_page.apply_redactions()
        elif mutation == "limit-order":
            first_page.add_redact_annot(
                fitz.Rect(198.0, 137.0, 270.0, 150.0),
                fill=(1.0, 1.0, 1.0),
            )
            first_page.apply_redactions()
            first_page.insert_text(
                fitz.Point(200.0, 145.0),
                "Channel 5e Cat - TIA",
                fontsize=7.0,
            )
        elif mutation == "extra-length":
            first_page.insert_text(fitz.Point(306.0, 145.0), "999", fontsize=7.0)
        elif mutation == "label-column":
            for rect in label_rects:
                first_page.add_redact_annot(rect, fill=(1.0, 1.0, 1.0))
            first_page.apply_redactions()
            first_page.insert_text(fitz.Point(500.0, 145.0), "#C003", fontsize=7.0)
        elif mutation == "duplicate-limit-token":
            first_page.insert_text(fitz.Point(255.0, 145.0), "TIA", fontsize=7.0)
        document.save(changed_pdf)

    with pytest.raises(AssertionError, match="record|row|label|length|limit"):
        write_golden_candidate(case, changed_pdf, tmp_path / mutation / case.name)


def test_candidate_writer_rejects_fixture_result_icon_mismatch(
    approved_candidate,
    tmp_path: Path,
) -> None:
    case, source_pdf, _ = approved_candidate
    changed_pdf = tmp_path / "wrong-result-icon.pdf"
    fail_rect = fitz.Rect(271.0, 124.766, 283.0, 136.766)
    with fitz.open(source_pdf) as document:
        page = document[0]
        page.draw_rect(fail_rect, color=(1.0, 1.0, 1.0), fill=(1.0, 1.0, 1.0), overlay=True)
        page.draw_circle(
            fail_rect.tl + (6.0, 6.0),
            5.5,
            color=(0.0, 0.6, 0.0),
            fill=(0.0, 0.6, 0.0),
            overlay=True,
        )
        document.save(changed_pdf)

    with pytest.raises(AssertionError, match="result icon"):
        write_golden_candidate(case, changed_pdf, tmp_path / "wrong-result" / case.name)


def test_candidate_writer_rejects_red_contamination_in_pass_icon(
    approved_candidate,
    tmp_path: Path,
) -> None:
    case, source_pdf, _ = approved_candidate
    changed_pdf = tmp_path / "contaminated-pass-icon.pdf"
    with fitz.open(source_pdf) as document:
        document[0].draw_circle(
            fitz.Point(277.0, 115.766),
            4.0,
            color=(0.86, 0.15, 0.15),
            fill=(0.86, 0.15, 0.15),
            overlay=True,
        )
        document.save(changed_pdf)

    with pytest.raises(AssertionError, match="result icon"):
        write_golden_candidate(case, changed_pdf, tmp_path / "contaminated-pass" / case.name)


def test_only_valid_printed_timestamp_is_normalized_and_masked(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    case = next(case for case in load_cases() if case.name == "cat5e-minimal")

    class FirstClock(RealDateTime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 7, 10, 10, 11, 12, tzinfo=tz)

    class SecondClock(RealDateTime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 7, 10, 22, 33, 44, tzinfo=tz)

    first_pdf = tmp_path / "printed-first.pdf"
    second_pdf = tmp_path / "printed-second.pdf"
    golden_dir = tmp_path / "cat5e-minimal"
    second_golden_dir = tmp_path / "second" / "cat5e-minimal"
    monkeypatch.setattr(pdf_summary, "datetime", FirstClock)
    _generate_case_pdf(case, first_pdf)
    write_golden_candidate(case, first_pdf, golden_dir)
    monkeypatch.setattr(pdf_summary, "datetime", SecondClock)
    _generate_case_pdf(case, second_pdf)
    write_golden_candidate(case, second_pdf, second_golden_dir)

    assert _tree_digest(golden_dir) == _tree_digest(second_golden_dir)
    assert_pdf_matches_golden(second_pdf, golden_dir)


def test_one_pixel_immediately_outside_printed_mask_still_fails(
    approved_candidate,
    tmp_path: Path,
) -> None:
    _, source_pdf, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    changed_pdf = tmp_path / "printed-neighbor-changed.pdf"
    _, y0, x1, _ = PRINTED_MASK_RECT
    with fitz.open(source_pdf) as document:
        document[0].draw_rect(
            fitz.Rect(x1 + 0.5, y0 + 2.0, x1 + 1.0, y0 + 2.5),
            color=(1.0, 0.0, 0.0),
            fill=(1.0, 0.0, 0.0),
            overlay=True,
        )
        document.save(changed_pdf)

    with pytest.raises(AssertionError, match="pixel mismatch"):
        assert_pdf_matches_golden(changed_pdf, golden_dir)


def test_global_thresholds_allow_only_noncritical_subthreshold_noise(
    approved_candidate,
    tmp_path: Path,
) -> None:
    _, source_pdf, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    changed_pdf = tmp_path / "noncritical-subthreshold.pdf"
    with fitz.open(source_pdf) as document:
        document[0].draw_rect(
            fitz.Rect(400.0, 300.0, 400.5, 300.5),
            color=(1.0, 0.0, 0.0),
            fill=(1.0, 0.0, 0.0),
            overlay=True,
        )
        document.save(changed_pdf)

    assert_pdf_matches_golden(changed_pdf, golden_dir)
    with pytest.raises(AssertionError, match="global thresholds"):
        assert_pdf_matches_golden(
            changed_pdf,
            golden_dir,
            max_changed_pixel_ratio=0.0,
            max_mean_channel_delta=0.0,
        )


def test_large_noncritical_render_change_exceeds_default_global_thresholds(
    approved_candidate,
    tmp_path: Path,
) -> None:
    _, source_pdf, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    changed_pdf = tmp_path / "noncritical-large-change.pdf"
    with fitz.open(source_pdf) as document:
        document[0].draw_rect(
            fitz.Rect(390.0, 290.0, 440.0, 340.0),
            color=(1.0, 0.0, 0.0),
            fill=(1.0, 0.0, 0.0),
            overlay=True,
        )
        document.save(changed_pdf)

    with pytest.raises(AssertionError, match="global thresholds"):
        assert_pdf_matches_golden(changed_pdf, golden_dir)


@pytest.mark.parametrize(
    "field,value,message",
    [
        ("name", "OtherRenderer", "renderer name"),
        ("version", "0.0.0", "renderer version"),
        ("dpi", 72, "render DPI"),
        ("colorspace", "RGBA", "colorspace"),
        ("alpha", True, "alpha"),
    ],
)
def test_renderer_contract_mismatches_are_rejected(
    approved_candidate,
    tmp_path: Path,
    field: str,
    value: object,
    message: str,
) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    manifest = deepcopy(_read_manifest(golden_dir))
    manifest["renderer"][field] = value
    _write_manifest(golden_dir, manifest)

    with pytest.raises(AssertionError, match=message):
        assert_pdf_matches_golden(pdf_path, golden_dir)


def test_comparator_never_updates_baseline_on_failure(
    approved_candidate,
    tmp_path: Path,
) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    manifest = _read_manifest(golden_dir)
    manifest["pdf"]["normalized_text"][0] += "\nchanged"
    _write_manifest(golden_dir, manifest)
    before = _tree_digest(golden_dir)

    with pytest.raises(AssertionError, match="normalized text"):
        assert_pdf_matches_golden(pdf_path, golden_dir)
    assert _tree_digest(golden_dir) == before


@pytest.mark.parametrize("pollution", ["notes.txt", "extra-dir"])
def test_golden_directory_inventory_rejects_non_png_pollution(
    approved_candidate,
    tmp_path: Path,
    pollution: str,
) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    path = golden_dir / pollution
    if pollution.endswith(".txt"):
        path.write_text("not approved", encoding="utf-8")
    else:
        path.mkdir()

    with pytest.raises(AssertionError, match="golden inventory"):
        assert_pdf_matches_golden(pdf_path, golden_dir)


def test_diff_artifacts_can_never_be_written_under_golden_root(
    approved_candidate,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _, source_pdf, source_golden = approved_candidate
    fake_root = tmp_path / "golden"
    actual_dir = fake_root / "actual"
    actual_dir.mkdir(parents=True)
    actual_pdf = actual_dir / "actual.pdf"
    shutil.copy2(source_pdf, actual_pdf)
    golden_dir = tmp_path / "outside" / source_golden.name
    shutil.copytree(source_golden, golden_dir)
    monkeypatch.setattr(pdf_golden, "GOLDEN_ROOT", fake_root)

    with pytest.raises(AssertionError, match="golden root"):
        assert_pdf_matches_golden(actual_pdf, golden_dir)


def test_actual_pdf_symlink_inside_golden_root_is_rejected(
    approved_candidate,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _, source_pdf, source_golden = approved_candidate
    fake_root = tmp_path / "golden"
    actual_dir = fake_root / "actual"
    actual_dir.mkdir(parents=True)
    actual_pdf = actual_dir / "actual.pdf"
    try:
        actual_pdf.symlink_to(source_pdf)
    except OSError as error:
        pytest.skip(f"symlink unavailable: {error}")
    golden_dir = tmp_path / "outside" / source_golden.name
    shutil.copytree(source_golden, golden_dir)
    monkeypatch.setattr(pdf_golden, "GOLDEN_ROOT", fake_root)

    with pytest.raises(AssertionError, match="golden root"):
        assert_pdf_matches_golden(actual_pdf, golden_dir)
    assert not list(actual_dir.glob("*.png"))


def test_actual_pdf_symlink_is_rejected_even_outside_golden_root(
    approved_candidate,
    tmp_path: Path,
) -> None:
    _, source_pdf, source_golden = approved_candidate
    actual_pdf = tmp_path / "actual-link.pdf"
    try:
        actual_pdf.symlink_to(source_pdf)
    except OSError as error:
        pytest.skip(f"symlink unavailable: {error}")
    golden_dir = tmp_path / "approved" / source_golden.name
    shutil.copytree(source_golden, golden_dir)

    with pytest.raises(AssertionError, match="symlink"):
        assert_pdf_matches_golden(actual_pdf, golden_dir)


def test_golden_page_symlink_is_rejected(
    approved_candidate,
    tmp_path: Path,
) -> None:
    _, pdf_path, golden_dir = _copy_candidate(approved_candidate, tmp_path)
    page_path = golden_dir / "page-001.png"
    external_page = tmp_path / "external-page.png"
    page_path.replace(external_page)
    try:
        page_path.symlink_to(external_page)
    except OSError as error:
        pytest.skip(f"symlink unavailable: {error}")

    with pytest.raises(AssertionError, match="symlink|golden inventory"):
        assert_pdf_matches_golden(pdf_path, golden_dir)


@pytest.mark.parametrize("artifact_kind", ["actual", "diff"])
def test_diff_writer_rejects_preexisting_artifact_symlink(
    approved_candidate,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    artifact_kind: str,
) -> None:
    _, source_pdf, source_golden = approved_candidate
    fake_root = tmp_path / "golden"
    fake_root.mkdir()
    sentinel = fake_root / "sentinel.bin"
    sentinel.write_bytes(b"sentinel")
    changed_pdf = tmp_path / "artifact-poison.pdf"
    with fitz.open(source_pdf) as document:
        document[0].draw_circle(
            fitz.Point(277.0, 145.766),
            6.0,
            color=(0.0, 0.6, 0.0),
            fill=(0.0, 0.6, 0.0),
            overlay=True,
        )
        document.save(changed_pdf)
    artifact = tmp_path / f"artifact-poison-page-001-{artifact_kind}.png"
    try:
        artifact.symlink_to(sentinel)
    except OSError as error:
        pytest.skip(f"symlink unavailable: {error}")
    golden_dir = tmp_path / "approved" / source_golden.name
    shutil.copytree(source_golden, golden_dir)
    monkeypatch.setattr(pdf_golden, "GOLDEN_ROOT", fake_root)
    before = _tree_digest(fake_root)

    with pytest.raises(AssertionError, match="artifact.*symlink"):
        assert_pdf_matches_golden(changed_pdf, golden_dir)
    assert _tree_digest(fake_root) == before


def test_updater_managed_target_rejects_symlinked_files(tmp_path: Path) -> None:
    target = tmp_path / "cat5e-minimal"
    target.mkdir()
    external = tmp_path / "external.json"
    external.write_text("{}", encoding="utf-8")
    try:
        (target / "manifest.json").symlink_to(external)
    except OSError as error:
        pytest.skip(f"symlink unavailable: {error}")

    with pytest.raises(AssertionError, match="unmanaged|symlink"):
        update_pdf_goldens._assert_existing_target_is_managed(target)


def test_updater_requires_explicit_cli_and_ignores_update_environment(tmp_path: Path) -> None:
    golden_root = ROOT / "tests/python/golden"
    before = _tree_digest(golden_root)
    env = os.environ.copy()
    env["UPDATE_GOLDENS"] = "1"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/update_pdf_goldens.py")],
        cwd=tmp_path,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 2
    assert "explicit" in result.stderr.lower()
    assert _tree_digest(golden_root) == before


def test_updater_refuses_ci_before_generating_anything(tmp_path: Path) -> None:
    golden_root = ROOT / "tests/python/golden"
    before = _tree_digest(golden_root)
    env = os.environ.copy()
    env["CI"] = "1"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/update_pdf_goldens.py"), "--all"],
        cwd=tmp_path,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode != 0
    assert "CI" in result.stderr
    assert _tree_digest(golden_root) == before


def test_updater_rejects_noncanonical_font_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(update_pdf_goldens, "EMBED_INSERT_FONTS", True)
    with pytest.raises(AssertionError, match="CABLE_REPORT_EMBED_INSERT_FONTS"):
        update_pdf_goldens._assert_generation_environment()


@pytest.mark.parametrize("failure", [OSError("rename failed"), KeyboardInterrupt()])
def test_atomic_replace_restores_old_target_on_second_rename_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    failure: BaseException,
) -> None:
    target = tmp_path / "cat5e-minimal"
    candidate = tmp_path / "candidate"
    target.mkdir()
    candidate.mkdir()
    (target / "manifest.json").write_text("old", encoding="utf-8")
    (candidate / "manifest.json").write_text("new", encoding="utf-8")
    old_digest = _tree_digest(target)
    real_replace = os.replace
    calls = 0

    def failing_replace(source, destination):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise failure
        return real_replace(source, destination)

    monkeypatch.setattr(update_pdf_goldens.os, "replace", failing_replace)
    with pytest.raises(type(failure)):
        update_pdf_goldens._atomic_replace_case(candidate, target)

    assert _tree_digest(target) == old_digest
    assert not list(tmp_path.glob(".cat5e-minimal.backup-*"))


def test_orphan_backup_is_recovered_or_ambiguous_state_rejected(tmp_path: Path) -> None:
    target = tmp_path / "cat5e-minimal"
    backup = tmp_path / ".cat5e-minimal.backup-one"
    backup.mkdir()
    (backup / "manifest.json").write_text("old", encoding="utf-8")

    update_pdf_goldens._recover_orphan_backup(target)
    assert (target / "manifest.json").read_text(encoding="utf-8") == "old"

    target.rename(tmp_path / ".cat5e-minimal.backup-two")
    (tmp_path / ".cat5e-minimal.backup-three").mkdir()
    with pytest.raises(AssertionError, match="ambiguous orphan backup"):
        update_pdf_goldens._recover_orphan_backup(target)


def test_direct_update_requires_cli_authorization_and_rechecks_ci(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    case = load_cases()[0]
    fake_root = tmp_path / "golden"
    calls = 0

    def forbidden_generation(*args, **kwargs):
        nonlocal calls
        calls += 1
        raise AssertionError("generation must not run")

    monkeypatch.setattr(update_pdf_goldens, "GOLDEN_ROOT", fake_root)
    monkeypatch.setattr(update_pdf_goldens, "edit_report", forbidden_generation)
    with pytest.raises(AssertionError, match="explicit CLI authorization"):
        update_pdf_goldens.update([case])
    assert calls == 0
    assert not fake_root.exists()

    monkeypatch.setenv("CI", "1")
    with pytest.raises(AssertionError, match="CI"):
        update_pdf_goldens.update(
            [case],
            authorization=update_pdf_goldens._CLI_AUTHORIZATION,
        )
    assert calls == 0
    assert not fake_root.exists()


def test_all_targets_are_preflighted_before_generation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    cases = load_cases()[:2]
    fake_root = tmp_path / "golden"
    first_backup = fake_root / f".{cases[0].name}.backup-preflight"
    first_backup.mkdir(parents=True)
    (first_backup / "manifest.json").write_text("old", encoding="utf-8")
    (fake_root / cases[1].name).mkdir()
    (fake_root / cases[1].name / "notes.txt").write_text("unmanaged", encoding="utf-8")
    calls = 0

    def forbidden_generation(*args, **kwargs):
        nonlocal calls
        calls += 1
        raise AssertionError("generation must not run")

    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.setattr(update_pdf_goldens, "GOLDEN_ROOT", fake_root)
    monkeypatch.setattr(update_pdf_goldens, "REVIEW_ROOT", tmp_path / "review")
    monkeypatch.setattr(update_pdf_goldens, "edit_report", forbidden_generation)

    with pytest.raises(AssertionError, match="unmanaged"):
        update_pdf_goldens.update(
            cases,
            authorization=update_pdf_goldens._CLI_AUTHORIZATION,
        )
    assert calls == 0
    assert not (fake_root / cases[0].name).exists()
    assert _tree_digest(first_backup) == {"manifest.json": hashlib.sha256(b"old").hexdigest()}


def test_update_lock_rejects_concurrent_writer(tmp_path: Path) -> None:
    lock_path = tmp_path / ".pdf-golden-update.lock"
    with update_pdf_goldens._update_lock(lock_path):
        with pytest.raises(AssertionError, match="already running"):
            with update_pdf_goldens._update_lock(lock_path):
                pass
    assert not lock_path.exists()
