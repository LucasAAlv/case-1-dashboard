/**
 * Helper mínimo para montar DOM. Todo texto entra por `textContent`, nunca por
 * `innerHTML`: os dados dos cards são digitados por usuários.
 */
type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export function options<T extends string>(map: Record<T, string>, selected?: T): HTMLOptionElement[] {
  return (Object.entries(map) as [T, string][]).map(([value, label]) =>
    h('option', { value, selected: value === selected }, label),
  );
}
