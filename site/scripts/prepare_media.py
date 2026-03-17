from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SITE_ROOT = ROOT / "site"
SOURCE_ROOT = ROOT / "Исходные данные" / "Фотографии"
EVENTS_SRC = SOURCE_ROOT / "Лекции"
PLAYS_SRC = SOURCE_ROOT / "Спектакли"
SPEAKERS_ROOT = SOURCE_ROOT / "спикеры"
SPEAKERS_CUTOUTS = SPEAKERS_ROOT / "Обрезанный фон"
EVENTS_OUT = SITE_ROOT / "public" / "generated" / "events"
SPEAKERS_OUT = SITE_ROOT / "public" / "generated" / "speakers"
MANIFEST_OUT = SITE_ROOT / "src" / "data" / "media-manifest.json"

EVENT_MAX_WIDTH = 1800
EVENT_QUALITY = 84
SPEAKER_MAX_WIDTH = 1600
SPEAKER_MAX_HEIGHT = 2200
SPEAKER_RATIO = 0.76
SPEAKER_QUALITY = 92
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


TRANSLIT = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "e",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "y",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "ts",
    "ч": "ch",
    "ш": "sh",
    "щ": "sch",
    "ъ": "",
    "ы": "y",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
}


def slugify(value: str) -> str:
    lowered = value.lower()
    transliterated = "".join(TRANSLIT.get(char, char) for char in lowered)
    slug = re.sub(r"[^a-z0-9]+", "-", transliterated).strip("-")
    return re.sub(r"-{2,}", "-", slug)


def ensure_dirs() -> None:
    EVENTS_OUT.mkdir(parents=True, exist_ok=True)
    SPEAKERS_OUT.mkdir(parents=True, exist_ok=True)
    MANIFEST_OUT.parent.mkdir(parents=True, exist_ok=True)


def resize_to_bounds(img: Image.Image, max_width: int, max_height: int) -> Image.Image:
    ratio = min(max_width / img.width, max_height / img.height, 1.0)
    if ratio >= 1.0:
        return img
    return img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)


def resize_event_image(img: Image.Image) -> Image.Image:
    if img.width <= EVENT_MAX_WIDTH:
        return img
    ratio = EVENT_MAX_WIDTH / img.width
    return img.resize((EVENT_MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)


def export_event_images(manifest: dict) -> None:
    event_entries = {}

    for folder in [EVENTS_SRC, PLAYS_SRC]:
        for source in sorted(folder.iterdir()):
            if not source.is_file():
                continue

            target_slug = slugify(source.stem)
            target_path = EVENTS_OUT / f"{target_slug}.webp"

            with Image.open(source) as img:
                converted = resize_event_image(img.convert("RGB"))
                converted.save(target_path, "WEBP", quality=EVENT_QUALITY, method=6)

            event_entries[source.stem] = f"/generated/events/{target_slug}.webp"

    manifest["events"] = event_entries


def crop_to_ratio(img: Image.Image, ratio: float) -> Image.Image:
    width, height = img.size
    current_ratio = width / height

    if current_ratio > ratio:
        target_width = int(height * ratio)
        left = max((width - target_width) // 2, 0)
        return img.crop((left, 0, left + target_width, height))

    if current_ratio < ratio:
        target_height = int(width / ratio)
        top = max((height - target_height) // 2, 0)
        return img.crop((0, top, width, top + target_height))

    return img


def crop_transparent_bounds(img: Image.Image) -> Image.Image:
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        return img.crop(bbox)
    return img


def prepare_speaker_image(source: Path) -> Image.Image:
    with Image.open(source) as img:
        rgba = img.convert("RGBA")
        alpha_bbox = rgba.getchannel("A").getbbox()

        if alpha_bbox and alpha_bbox != (0, 0, rgba.width, rgba.height):
            prepared = crop_transparent_bounds(rgba)
        else:
            prepared = crop_to_ratio(rgba, SPEAKER_RATIO)

        return resize_to_bounds(prepared, SPEAKER_MAX_WIDTH, SPEAKER_MAX_HEIGHT)


def resolve_speaker_key(source: Path) -> str:
    if source.parent == SPEAKERS_CUTOUTS:
        return source.stem.split(" - ")[0]
    return source.parent.name


def resolve_speaker_slug_seed(source: Path, key: str) -> str:
    if source.parent == SPEAKERS_CUTOUTS:
        return source.stem
    return f"{key}-{source.stem}"


def export_speaker_images(manifest: dict) -> None:
    speaker_entries = {}

    for source in sorted(SPEAKERS_ROOT.rglob("*")):
        if not source.is_file() or source.suffix.lower() not in IMAGE_SUFFIXES:
            continue

        key = resolve_speaker_key(source)
        target_slug = slugify(resolve_speaker_slug_seed(source, key))
        target_path = SPEAKERS_OUT / f"{target_slug}.webp"
        prepared = prepare_speaker_image(source)
        prepared.save(target_path, "WEBP", quality=SPEAKER_QUALITY, method=6)

        speaker_entries.setdefault(key, []).append(f"/generated/speakers/{target_slug}.webp")

    manifest["speakers"] = speaker_entries


def main() -> None:
    ensure_dirs()
    manifest: dict[str, dict] = {}
    export_event_images(manifest)
    export_speaker_images(manifest)
    MANIFEST_OUT.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Prepared media manifest: {MANIFEST_OUT}")


if __name__ == "__main__":
    main()
