#!/usr/bin/env python3
"""Gera os ícones do app a partir da marca: o diagrama de acorde.

A marca vive em web/logo.svg; aqui ela é redesenhada com PIL porque o sandbox
não tem rasterizador de SVG. As duas versões PRECISAM continuar iguais: mexeu
numa, mexa na outra. A geometria abaixo é a mesma do arquivo, em 512.
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "icons")
os.makedirs(OUT, exist_ok=True)

AMBAR = (255, 180, 84, 255)  # #ffb454, a mesma cor dos acordes na tela
TINTA = (11, 13, 17, 255)  # #0b0d11


def mistura(frente, fundo, alfa):
    return tuple(round(f * alfa + b * (1 - alfa)) for f, b in zip(frente, fundo))


def desenha(size: int) -> Image.Image:
    """O ícone é desenhado 4x maior e reduzido: é o antisserrilhado do pobre,
    e sem ele as linhas finas do diagrama ficam com degrau no iPad."""
    ESC = 4
    g = size * ESC
    s = g / 512.0
    img = Image.new("RGBA", (g, g), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, g - 1, g - 1], radius=round(114 * s), fill=AMBAR)

    fraco = mistura(TINTA, AMBAR, 0.34)  # cordas e casas: esqueleto, não leitura

    def barra(x1, y1, x2, y2, largura, cor):
        r = largura * s / 2
        d.rounded_rectangle(
            [x1 * s - r, y1 * s - r, x2 * s + r, y2 * s + r], radius=r, fill=cor
        )

    for x in (128, 213, 299, 384):  # cordas
        barra(x, 148, x, 364, 16, fraco)
    for y in (256, 364):  # casas
        barra(128, y, 384, y, 16, fraco)
    barra(128, 148, 384, 148, 32, TINTA)  # pestana

    for cx, cy in ((213, 202), (384, 202), (299, 310)):  # os três dedos do RÉ
        r = 34 * s
        d.ellipse([cx * s - r, cy * s - r, cx * s + r, cy * s + r], fill=TINTA)

    return img.resize((size, size), Image.LANCZOS)


for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
    img = desenha(size)
    # o ícone do iOS é recortado pelo sistema e não aceita transparência
    if name == "apple-touch-icon.png":
        img = img.convert("RGB")
    img.save(os.path.join(OUT, name))
    print("gerado", name)
