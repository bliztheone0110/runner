export const usernameStorageKey = 'momentum.username';
export const maximumUsernameLength = 24;

export type UsernameStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function normalizeUsername(value: string): string {
  return Array.from(value.normalize('NFKC').trim()).slice(0, maximumUsernameLength).join('');
}

export function loadUsername(storage: UsernameStorage): string {
  try {
    const stored = storage.getItem(usernameStorageKey);
    return stored ? normalizeUsername(stored) : '';
  } catch {
    return '';
  }
}

export function saveUsername(storage: UsernameStorage, value: string): string {
  const username = normalizeUsername(value);
  try {
    storage.setItem(usernameStorageKey, username);
  } catch {
    // The current name still works for this page when browser storage is unavailable.
  }
  return username;
}
