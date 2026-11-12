"""Pasa las capturas de Reportes BI de la e2e a WebP para la landing.

Las genera `e2e/tests/landing.spec.ts` en PNG (`e2e/landing-capturas/`); aquí se
reducen a WebP en `landing/assets/`, que es lo que sirve la página. Un PNG de
una pantalla de Druse pesa entre 60 y 150 KB; en WebP, la mitad o menos.

Uso, desde la raíz del repositorio:

    python build/scripts/landing-capturas.py
"""

from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parents[2]
ORIGEN = RAIZ / "e2e" / "landing-capturas"
DESTINO = RAIZ / "landing" / "assets"
NOMBRES = ("reportes-tablero", "reportes-combinar", "reportes-programar")


def main() -> None:
    for nombre in NOMBRES:
        png = ORIGEN / f"{nombre}.png"
        if not png.exists():
            raise SystemExit(f"Falta {png}: lanza antes la e2e de capturas de la landing.")

        webp = DESTINO / f"{nombre}.webp"
        with Image.open(png) as imagen:
            imagen.convert("RGB").save(webp, "WEBP", quality=86, method=6)
            ancho, alto = imagen.size
        print(f"{webp.relative_to(RAIZ)}  {ancho}x{alto}  {webp.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
