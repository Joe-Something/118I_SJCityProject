export type ContactValues = {
  applicantName: string;
  applicantEmail: string;
  applicantPhone: string;
  notificationConsent: boolean;
};

export type ContactErrors = Partial<Record<keyof ContactValues, string>>;

export function normalizeContactValues(values: Partial<ContactValues>): ContactValues {
  return {
    applicantName: (values.applicantName ?? '').trim(),
    applicantEmail: (values.applicantEmail ?? '').trim(),
    applicantPhone: (values.applicantPhone ?? '').trim(),
    notificationConsent: values.notificationConsent === true,
  };
}

export function validateContactValues(values: Partial<ContactValues>): ContactErrors {
  const normalized = normalizeContactValues(values);
  const errors: ContactErrors = {};

  if (normalized.applicantName.length > 200) {
    errors.applicantName = 'Name must be 200 characters or fewer.';
  }
  if (normalized.applicantEmail.length > 254) {
    errors.applicantEmail = 'Email must be 254 characters or fewer.';
  } else if (normalized.applicantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.applicantEmail)) {
    errors.applicantEmail = 'Enter a valid email address.';
  }
  if (normalized.applicantPhone.length > 40) {
    errors.applicantPhone = 'Phone must be 40 characters or fewer.';
  } else if (normalized.applicantPhone && (
    !/^[+\d ().-]+$/.test(normalized.applicantPhone)
    || (normalized.applicantPhone.match(/\d/g) ?? []).length < 7
    || (normalized.applicantPhone.match(/\d/g) ?? []).length > 15
  )) {
    errors.applicantPhone = 'Enter a phone number using 7–15 digits and standard phone characters.';
  }
  if (normalized.notificationConsent && !normalized.applicantEmail && !normalized.applicantPhone) {
    errors.notificationConsent = 'Add an email address or phone number before giving contact permission.';
  }

  return errors;
}