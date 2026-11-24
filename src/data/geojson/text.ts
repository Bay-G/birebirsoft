const FOLD: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u',
};

/** Türkçe'ye duyarlı küçük harfe çevirir ve aksanları katlar: "İSTANBUL" → "istanbul", "Çukurova" → "cukurova". */
export function normalizeTr(input: string): string {
  return input
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (c) => FOLD[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}
