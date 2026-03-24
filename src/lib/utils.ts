import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function parseCurrencyInput(value: string): number {
  // Remove all non-digits
  const cleanValue = value.replace(/\D/g, '');
  // Convert to number (cents)
  const numberValue = parseInt(cleanValue || '0', 10);
  // Convert to decimal
  return numberValue / 100;
}

export function formatCurrencyInput(value: number): string {
  if (value === 0) return '';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
