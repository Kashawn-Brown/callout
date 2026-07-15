/**
 * Client-side mirror of the auth server's password policy (D069): minimum_password_length = 8 with the letters_digits requirement. Kept in one place so the sign-up and reset screens validate identically to the server and a policy change is a two-line edit (here and config.toml).
 */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRequirement = {
  id: 'length' | 'letters-digits';
  label: string;
  met: boolean;
};

/** Per-rule status for inline feedback while typing; mirrors GoTrue's letters_digits check (at least one letter and one digit — case and symbols don't matter). */
export function checkPassword(password: string): PasswordRequirement[] {
  return [
    {
      id: 'length',
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: 'letters-digits',
      label: 'A letter and a number',
      met: /[a-zA-Z]/.test(password) && /[0-9]/.test(password),
    },
  ];
}

export function isPasswordValid(password: string): boolean {
  return checkPassword(password).every((requirement) => requirement.met);
}
