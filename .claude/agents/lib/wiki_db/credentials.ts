/**
 * credentials.ts — re-export of `narai-primitives/db`'s credential providers.
 *
 * The local copy was a near-clone of upstream (the legacy compatibility
 * shim for `FileCredentialProvider`/`EnvVarCredentialProvider`/`getCredentials`
 * is the same in both repos). Single source of truth lives in the published
 * connector package.
 */
export {
  _DEFAULT_CREDS,
  CredentialProvider,
  FileCredentialProvider,
  EnvVarCredentialProvider,
  getCredentials,
  type GetCredentialsOptions,
} from "narai-primitives/db";
