/** Compatibility-only forwarding surface. New consumers use platform-kernel/contract/config.mjs. */
export { APP_NAME, APP_ID, VERSION, REFERENCE_VERSION, REPO_ROOT, APP_ROOT, defaultDataDir, defaultCatalogDir, ConfigError, readEnv, loadConfig, describeConfig } from './platform-kernel/contract/config.mjs';
