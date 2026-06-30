// Minimal ambient declarations for the FXServer natives we use. Keeping our own
// instead of pulling @citizenfx/server avoids version drift in the type defs.
declare function GetConvar(name: string, defaultValue: string): string;
declare function GetConvarInt(name: string, defaultValue: number): number;
declare function GetCurrentResourceName(): string;
declare function GetResourcePath(resource: string): string;
declare function GetResourceMetadata(resource: string, key: string, index: number): string;
declare function PerformHttpRequest(
  url: string,
  handler: (statusCode: number, body: string, headers: Record<string, string>, errorData?: string) => void,
  method?: string,
  data?: string,
  headers?: Record<string, string>
): void;
declare function RegisterCommand(
  name: string,
  handler: (source: number, args: string[], rawCommand: string) => void,
  restricted: boolean
): void;
declare function on(eventName: string, callback: (...args: any[]) => void): void;
declare function emit(eventName: string, ...args: any[]): void;

declare const exports: {
  (name: string, fn: (...args: any[]) => any): void;
  [resource: string]: any;
};
