/**
 * external-modules.d.ts — Ambient declarations for native driver modules
 * that are declared in `package.json` only when an operator installs them.
 *
 * These declarations intentionally keep the module shape `unknown`. Each
 * Phase E driver (postgresql.ts, mysql.ts, sqlserver.ts, mongodb.ts,
 * dynamodb.ts) defines its own minimal typed interfaces and narrows the
 * dynamic-import return value at runtime. The ambient `any` export lets
 * `await import("pg")` compile even when the package is not installed.
 *
 * When operators run `npm install pg @types/pg` (etc.), the real types
 * from `@types/pg` / `mysql2` / `mssql` / `mongodb` /
 * `@aws-sdk/client-dynamodb` take precedence automatically because
 * `declare module` is only consulted when no real `.d.ts` resolves.
 */
declare module "pg" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any;
  export = mod;
}

declare module "mysql2/promise" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any;
  export = mod;
}

declare module "mssql" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any;
  export = mod;
}

declare module "mongodb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any;
  export = mod;
}

declare module "@aws-sdk/client-dynamodb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any;
  export = mod;
}
