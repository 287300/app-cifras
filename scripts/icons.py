#!/usr/bin/env python3
"""Gera os ícones do app (nota musical sobre fundo escuro) com PIL."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (14, 17, 22, 255)        # #0e1116
ACCENT = (255, 180, 84, 255)  # âmbar, mesma cor de destaque dos acordes


def draw_icon(size: int, rounded: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.22) if rounded else 0
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)

    s = size / 512.0  # desenho pensado em 512

    # Colcheia: duas notas ligadas (estilo simples e legível em tamanho pequeno)
    def note(cx, cy, rx, ry):
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=ACCENT)

    stem_w = int(22 * s)
    # hastes
    d.rectangle([int(198 * s), int(120 * s), int(198 * s) + stem_w, int(340 * s)], fill=ACCENT)
    d.rectangle([int(330 * s), int(96 * s), int(330 * s) + stem_w, int(316 * s)], fill=ACCENT)
    # barra ligando as hastes (inclinada)
    d.polygon(
        [
            (int(198 * s), int(120 * s)),
            (int(330 * s) + stem_w, int(96 * s)),
            (int(330 * s) + stem_w, int(150 * s)),
            (int(198 * s), int(174 * s)),
        ],
        fill=ACCENT,
    )
    # cabeças das notas
    note(int(174 * s), int(352 * s), int(46 * s), int(34 * s))
    note(int(306 * s), int(328 * s), int(46 * s), int(34 * s))
    return img


for size, name, rounded in [
    (512, "icon-512.png", False),
    (192, "icon-192.png", False),
    (180, "apple-touch-icon.png", True),
]:
    draw_icon(size, rounded).convert("RGB" if name == "apple-touch-icon.png" else "RGBA").save(
        os.path.join(OUT, name)
    )
    print("gerado", name)
