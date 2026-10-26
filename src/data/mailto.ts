/** A mailto link the user's own mail app opens. The site sends nothing: the user reads the message and presses send. */
export function buildMailto(address: string, subject: string, body: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
