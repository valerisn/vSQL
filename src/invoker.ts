// The resource that called the export currently being handled. It must be read
// synchronously - before any await, while we're still inside the export call -
// because GetInvokingResource() only refers to the caller during that window.
// Returns undefined off the FXServer runtime (e.g. unit tests) so callers can
// treat attribution as best-effort. Kept in its own leaf module so both the
// native exports and the compatibility shims share one implementation.
export function invokingResource(): string | undefined {
  return typeof GetInvokingResource === 'function' ? GetInvokingResource() || undefined : undefined;
}
