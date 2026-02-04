import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatPhone(idOrNumber) {
  if (!idOrNumber) return '';
  const raw = String(idOrNumber).split('@')[0].replace(/\D/g, '');
  if (raw.startsWith('55') && raw.length >= 12) {
    const n = raw.slice(2);
    const ddd = n.slice(0, 2);
    const nine = n.length >= 11;
    const part1 = n.slice(2, nine ? 7 : 6);
    const part2 = n.slice(nine ? 7 : 6);
    return `(${ddd}) ${part1}-${part2}`;
  }
  return raw;
}
