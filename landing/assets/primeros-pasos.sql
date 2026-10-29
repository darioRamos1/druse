-- Datos ficticios para una base SQLite nueva y vacía.
-- No se borran tablas existentes: si ya hiciste la prueba, usa otro archivo.
CREATE TABLE druse_prueba_ventas (
  id INTEGER PRIMARY KEY,
  producto TEXT NOT NULL,
  unidades INTEGER NOT NULL,
  precio_cop INTEGER NOT NULL
);

INSERT INTO druse_prueba_ventas (id, producto, unidades, precio_cop) VALUES
  (1, 'Café', 2, 12000),
  (2, 'Té', 3, 7000),
  (3, 'Cacao', 1, 15000);
