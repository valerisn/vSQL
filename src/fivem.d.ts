// Minimal ambient declarations for the FXServer natives we use. Keeping our own
// instead of pulling @citizenfx/server avoids version drift in the type defs.
declare function GetConvar(name: string, defaultValue: string): string;
declare function GetConvarInt(name: string, defaultValue: number): number;
declare function GetCurrentResourceName(): string;
declare function GetResourcePath(resource: string): string;
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
