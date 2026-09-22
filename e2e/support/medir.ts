import type { Page } from '@playwright/test';

/**
 * Lo medible de una pantalla: qué no cabe, qué se corta y qué botón no dice lo
 * que hace.
 *
 * Vive aquí y no en el barrido porque el paso del pseudoidioma mide lo mismo: un
 * texto un 40 % más largo es la forma de ver de antemano lo que se recortará al
 * traducir.
 */
export async function medir(page: Page, donde: string, hallazgos: string[]): Promise<void> {
  const encontrado = await page.evaluate((sitio) => {
    const problemas: string[] = [];

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(element);

      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }

      const caja = element.getBoundingClientRect();

      if (
        caja.width === 0 ||
        caja.height === 0 ||
        element.closest('.monaco-editor') ||
        (element.matches('.label') && caja.width <= 1 && caja.height <= 1)
      ) {
        continue;
      }

      // Contenido que no cabe en un contenedor que además lo recorta.
      const recorta = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const sobra = element.scrollWidth - element.clientWidth;

      /*
       * Recortar con puntos suspensivos no es un defecto: es una decisión, y
       * además se ve. Una celda de datos con un texto largo dentro va a
       * desbordar siempre —el dato lo pone quien consulta, no quien diseña— y,
       * mientras quede sitio para leer un trozo y los puntos, hace lo que se le
       * pidió.
       *
       * Lo que sí es un defecto es recortar hasta dejarlo en nada: ahí no hay
       * decisión que valga, porque no se lee ni el principio. De ahí el ancho
       * mínimo, en lugar de un «tiene ellipsis, se perdona».
       */
      const decidido = style.textOverflow === 'ellipsis' && element.clientWidth >= 40;

      if (
        recorta &&
        !decidido &&
        sobra > 2 &&
        element.children.length === 0 &&
        element.textContent?.trim()
      ) {
        problemas.push(
          `${sitio}: «${element.textContent.trim().slice(0, 32)}» se corta (${sobra}px)`,
        );
      }

      // Alto que se desborda sin poder desplazarse.
      const sobraAlto = element.scrollHeight - element.clientHeight;

      if (style.overflowY === 'hidden' && sobraAlto > 4 && element.children.length > 0) {
        problemas.push(
          `${sitio}: <${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}> esconde ${sobraAlto}px de alto`,
        );
      }
    }

    for (const boton of Array.from(document.querySelectorAll('button'))) {
      const texto = boton.textContent?.trim() ?? '';
      const nombre = boton.getAttribute('aria-label') ?? boton.getAttribute('title') ?? '';

      if (texto.length === 0 && nombre.length === 0) {
        problemas.push(
          `${sitio}: botón sin nombre accesible (.${String(boton.className).split(' ')[0]})`,
        );
      }
    }

    return [...new Set(problemas)];
  }, donde);

  hallazgos.push(...encontrado);
}
