"""
Gera electron/assets/icon.ico para o PatrimonIA.
Fundo #0F1547 + letra P em roxo claro visivel.
Pillow ICO: renderiza 256x256 e gera os tamanhos menores automaticamente.
"""
import os
from PIL import Image, ImageDraw, ImageFont

# ── Cores ──────────────────────────────────────────────────────────────────────
BG     = (15,  21,  71, 255)   # #0F1547 — fundo escuro
P_CLR  = (196, 181, 253, 255)  # #C4B5FD — roxo claro (visivel no fundo escuro)
SHADOW = (76,  29, 149, 160)   # #4C1D95 semi-trans — sombra / profundidade

SIZES = [16, 32, 48, 256]

FONT_PATHS = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\calibrib.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]


def load_font(pt: int) -> ImageFont.FreeTypeFont:
    for fp in FONT_PATHS:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, pt)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_rounded_rect(draw: ImageDraw.ImageDraw, xy, r: int, fill):
    draw.rounded_rectangle(xy, radius=r, fill=fill)


def make_256() -> Image.Image:
    S = 256
    img  = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Fundo com cantos arredondados
    draw_rounded_rect(draw, (0, 0, S - 1, S - 1), r=36, fill=BG)

    # Destaque sutil no topo (brilho)
    hi = Image.new("RGBA", (S, S // 2), (255, 255, 255, 18))
    img.alpha_composite(hi, (0, 0))

    # Letra P
    pt   = 172
    font = load_font(pt)
    text = "P"

    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (S - tw) // 2 - bbox[0]
    y = (S - th) // 2 - bbox[1] - 4   # leve ajuste visual

    # Sombra (offset 3px)
    draw.text((x + 3, y + 3), text, font=font, fill=SHADOW)
    # Letra principal
    draw.text((x, y), text, font=font, fill=P_CLR)

    return img


def main():
    assets_dir = os.path.join(os.path.dirname(__file__), "electron", "assets")
    os.makedirs(assets_dir, exist_ok=True)
    ico_path = os.path.join(assets_dir, "icon.ico")
    png_path = os.path.join(assets_dir, "icon.png")

    print("Gerando icone 256x256...")
    img = make_256()

    # --- ICO com multiplos tamanhos -----------------------------------------
    # Pillow gera os tamanhos menores por downscaling do frame 256x256
    img.save(ico_path, format="ICO", sizes=[(s, s) for s in SIZES])

    # --- PNG de referencia ---------------------------------------------------
    img.save(png_path, format="PNG")

    ico_kb = os.path.getsize(ico_path) / 1024
    png_kb = os.path.getsize(png_path) / 1024
    print(f"ICO: {ico_path}  ({ico_kb:.1f} KB)")
    print(f"PNG: {png_path}  ({png_kb:.1f} KB)")

    # Verificar tamanhos embutidos no ICO
    ico_img = Image.open(ico_path)
    info = getattr(ico_img, 'ico', None)
    if info:
        embedded = sorted(info.sizes())
        print(f"Tamanhos embutidos: {embedded}")
    else:
        print(f"Arquivo ICO gerado com {ico_kb:.1f} KB")


if __name__ == "__main__":
    main()
