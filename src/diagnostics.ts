export class DiagnosticError extends Error {}
export function safeDiagnostic(error: unknown): string {
  return error instanceof DiagnosticError ? error.message : 'Unexpected provider failure; no private response content was logged.';
}
