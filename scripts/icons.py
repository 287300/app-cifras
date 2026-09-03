#!/usr/bin/env python3
"""Gera os ícones do app a partir da marca: a palheta.

A marca vive em web/logo.svg; aqui ela é redesenhada com PIL porque o sandbox
não tem rasterizador de SVG. As duas versões PRECISAM continuar iguais: mexeu
numa, mexa na outra. A curva abaixo é a MESMA do arquivo, em 512.
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "icons")
os.makedirs(OUT, exist_ok=True)

AMBAR = (255, 180, 84, 255)  # #ffb454, a mesma cor dos acordes na tela
FUNDO = (18, 22, 29, 255)  # #12161d

# A palheta do logo.svg, curva por curva: cada trecho é (controle1, controle2, fim).
# O caminho começa no topo, desce pela direita até a ponta e volta pela esquerda.
INICIO = (256, 112)
CURVAS = [
    ((324, 112), (380, 138), (402, 184)),   # ombro direito
    ((424, 232), (396, 296), (344, 348)),   # lateral direita descendo
    ((310, 382), (278, 404), (256, 404)),   # ponta, metade direita
    ((234, 404), (202, 382), (168, 348)),   # ponta, metade esquerda
    ((116, 296), (88, 232), (110, 184)),    # lateral esquerda subindo
    ((132, 138), (188, 112), (256, 112)),   # ombro esquerdo
]


def bezier(p0, p1, p2, p3, passos=48):
    """Amostra uma cúbica. Curva virando polígono: é o preço de não ter SVG."""
    for i in range(1, passos + 1):
        t = i / passos
        u = 1 - t
        yield (
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        )


def contorno(escala):
    pontos = [INICIO]
    atual = INICIO
    for c1, c2, fim in CURVAS:
        pontos.extend(bezier(atual, c1, c2, fim))
        atual = fim
    return [(x * escala, y * escala) for x, y in pontos]


def desenha(size: int) -> Image.Image:
    """Desenhado 4x maior e reduzido: é o antisserrilhado do pobre, e sem ele a
    borda curva da palheta fica serrilhada no iPad."""
    ESC = 4
    g = size * ESC
    s = g / 512.0
    img = Image.new("RGBA", (g, g), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, g - 1, g - 1], radius=round(114 * s), fill=FUNDO)
    d.polygon(contorno(s), fill=AMBAR)
    return img.resize((size, size), Image.LANCZOS)


for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
    img = desenha(size)
    # o ícone do iOS é recortado pelo sistema e não aceita transparência
    if name == "apple-touch-icon.png":
        img = img.convert("RGB")
    img.save(os.path.join(OUT, name))
    print("gerado", name)
