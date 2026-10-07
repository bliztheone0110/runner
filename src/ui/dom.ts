/** Required interface hooks fail with the selector name instead of a null dereference. */
export function requireElement<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Не найден обязательный элемент интерфейса: ${selector}`);
  }
  return element;
}
