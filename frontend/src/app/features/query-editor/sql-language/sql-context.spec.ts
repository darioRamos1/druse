import { aliasMap, relationMentions } from './sql-context';

/** Las tablas encontradas, como `nombre` o `nombre=alias` si el alias es otro. */
function tablas(sql: string): string[] {
  return relationMentions(sql).map((mention) =>
    mention.alias === mention.reference.name.toLowerCase()
      ? mention.reference.name
      : `${mention.reference.name}=${mention.alias}`,
  );
}

describe('tablas nombradas en el SQL', () => {
  it('encuentra las tablas de un JOIN sin alias', () => {
    // Era el fallo: `JOIN` se tomaba por alias de `users`, se consumía, y
    // `pedidos` no aparecía nunca. Con alias funcionaba; sin alias, no.
    expect(tablas('SELECT * FROM users JOIN pedidos ON true')).toEqual(['users', 'pedidos']);
  });

  it('sigue resolviendo los alias, con AS y sin él', () => {
    expect(tablas('SELECT * FROM users u JOIN pedidos AS p ON u.id = p.id')).toEqual([
      'users=u',
      'pedidos=p',
    ]);
  });

  it('no confunde con un alias las palabras que siguen a una tabla', () => {
    expect(tablas('SELECT * FROM users WHERE id = 1')).toEqual(['users']);
    expect(tablas('UPDATE users SET name = 1')).toEqual(['users']);
    expect(tablas('SELECT * FROM users AS u LEFT OUTER JOIN pedidos ON true')).toEqual([
      'users=u',
      'pedidos',
    ]);
  });

  it('un alias que empieza como una palabra reservada sigue siendo un alias', () => {
    // `one` empieza por ON y `oné` también, con un carácter que `\b` no entiende.
    expect(tablas('SELECT * FROM users one JOIN pedidos oné ON true')).toEqual([
      'users=one',
      'pedidos=oné',
    ]);
  });

  it('registra cada tabla por su alias y por su nombre', () => {
    const aliases = aliasMap('SELECT * FROM users JOIN pedidos p ON true');

    expect(aliases.get('users')?.name).toBe('users');
    expect(aliases.get('pedidos')?.name).toBe('pedidos');
    expect(aliases.get('p')?.name).toBe('pedidos');
  });
});
