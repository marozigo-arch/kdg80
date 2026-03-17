from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SITE_ROOT = ROOT / "site"
SOURCE_ROOT = ROOT / "Исходные данные" / "Фотографии"
EVENTS_SRC = SOURCE_ROOT / "Лекции"
PLAYS_SRC = SOURCE_ROOT / "Спектакли"
SPEAKERS_SRC = SOURCE_ROOT / "спикеры" / "Обрезанный фон"
EVENTS_OUT = SITE_ROOT / "public" / "generated" / "events"
SPEAKERS_OUT = SITE_ROOT / "public" / "generated" / "speakers"
MANIFEST_OUT = SITE_ROOT / "src" / "data" / "media-manifest.json"

EVENT_MAX_WIDTH = 1800
EVENT_QUALITY = 84
SPEAKER_CANVAS = (1800, 2500)
SPEAKER_TOP_PAD = 170
SPEAKER_SIDE_PAD = 110
OUTLINE_SIZE = 8


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


def create_outline(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    spread = alpha.filter(ImageFilter.MaxFilter(OUTLINE_SIZE * 2 + 1))
    border = ImageChops.subtract(spread, alpha)
    outline = Image.new("RGBA", image.size, (255, 255, 255, 0))
    outline.putalpha(border)
    merged = Image.alpha_composite(outline, image)
    return merged


def export_speaker_images(manifest: dict) -> None:
    speaker_entries = {}

    for source in sorted(SPEAKERS_SRC.iterdir()):
        if not source.is_file():
            continue

        with Image.open(source) as img:
            rgba = img.convert("RGBA")
            bbox = rgba.getbbox()
            if not bbox:
                continue

            cropped = rgba.crop(bbox)
            outlined = create_outline(cropped)

            max_width = SPEAKER_CANVAS[0] - SPEAKER_SIDE_PAD * 2
            max_height = SPEAKER_CANVAS[1] - SPEAKER_TOP_PAD - 70

            scale = min(max_width / outlined.width, max_height / outlined.height, 1.0)
            if scale < 1.0:
                outlined = outlined.resize(
                    (int(outlined.width * scale), int(outlined.height * scale)),
                    Image.LANCZOS,
                )

            canvas = Image.new("RGBA", SPEAKER_CANVAS, (255, 255, 255, 0))
            x = (SPEAKER_CANVAS[0] - outlined.width) // 2
            y = SPEAKER_TOP_PAD
            canvas.alpha_composite(outlined, (x, y))

            target_slug = slugify(source.stem)
            target_path = SPEAKERS_OUT / f"{target_slug}.webp"
            canvas.save(target_path, "WEBP", quality=96, lossless=True, method=6)

            key = source.stem.split(" - ")[0]
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
