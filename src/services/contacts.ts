import type { ContactInput, ContactItem } from '../types/app';

export type ContactSortMode = 'flat' | 'alphabetical';

export const CONTACT_LIMITS = {
  firstName: 80,
  lastName: 80,
  phone: 40,
  email: 254,
  organization: 160,
  notes: 1_000,
} as const;

function withinLimit(value: string, limit: number): boolean {
  return value.length <= limit;
}

export function normalizeContactInput(input: ContactInput): ContactInput | null {
  if (typeof input?.firstName !== 'string'
    || typeof input.lastName !== 'string'
    || typeof input.phone !== 'string'
    || typeof input.email !== 'string'
    || typeof input.organization !== 'string'
    || typeof input.notes !== 'string') {
    return null;
  }
  const normalized: ContactInput = {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    organization: input.organization.trim(),
    notes: input.notes.trim(),
  };
  if (!normalized.firstName
    || !withinLimit(normalized.firstName, CONTACT_LIMITS.firstName)
    || !withinLimit(normalized.lastName, CONTACT_LIMITS.lastName)
    || !withinLimit(normalized.phone, CONTACT_LIMITS.phone)
    || !withinLimit(normalized.email, CONTACT_LIMITS.email)
    || !withinLimit(normalized.organization, CONTACT_LIMITS.organization)
    || !withinLimit(normalized.notes, CONTACT_LIMITS.notes)
    || (normalized.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email))) {
    return null;
  }
  return normalized;
}

export function contactDisplayName(contact: Pick<ContactItem, 'firstName' | 'lastName'>): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

export function sortContacts(
  contacts: readonly ContactItem[],
  mode: ContactSortMode,
  locale: string,
): ContactItem[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return [...contacts].sort((left, right) => {
    if (mode === 'alphabetical') {
      const nameOrder = collator.compare(contactDisplayName(left), contactDisplayName(right));
      if (nameOrder !== 0) return nameOrder;
    }
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  });
}
