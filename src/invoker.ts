// The resource behind the export we're handling. Read it synchronously, before
// any await - GetInvokingResource() only names the caller inside that window.
// Returns undefined off FXServer (unit tests), so attribution is best-effort. Its
// own leaf so the native exports and the compat shims share one implementation.
export function invokingResource(): string | undefined {
  return typeof GetInvokingResource === 'function' ? GetInvokingResource() || undefined : undefined;
}
