/**
 * W1 unit gate — configuration parsing (contract §2).
 * These run the real module; the HTTP-level configuration behaviour is covered
 * by Worker 3 in tests/runtime/07-configuration.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ConfigError, loadConfig, describeConfig } from '../src/config.ts';

const REPO = '/repo';

test('defaults match the frozen contract', () => {
  const config = loadConfig({}, REPO);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 5678);
  assert.equal(config.env, 'development');
  assert.equal(config.logLevel, 'info');
  assert.equal(config.storage, 'file');
  assert.equal(config.dataDir, join(REPO, 'data'));
  assert.equal(config.maxBodyBytes, 1024 * 1024);
  assert.equal(config.executionTimeoutMs, 30_000);
  assert.equal(config.unknownNodePolicy, 'passthrough');
  assert.equal(config.unknownConnectionPolicy, 'warn');
  assert.equal(config.allowCodeEval, false);
  assert.equal(config.apiKey, null);
  assert.equal(config.corsOrigin, '*');
  assert.equal(config.locale, 'id');
  assert.equal(config.executionHistory, 200);
  assert.equal(config.pidFile, join(REPO, 'data', 'runtime.pid'));
  assert.equal(config.logFormat, 'text'); // development default
});

test('N8N_TS_* wins over the generic aliases', () => {
  const config = loadConfig({ PORT: '1111', N8N_TS_PORT: '2222', HOST: '127.0.0.1', N8N_TS_HOST: '0.0.0.0' }, REPO);
  assert.equal(config.port, 2222);
  assert.equal(config.host, '0.0.0.0');
});

test('generic PORT/HOST are honoured when the prefixed variables are absent', () => {
  const config = loadConfig({ PORT: '8080', HOST: '127.0.0.1' }, REPO);
  assert.equal(config.port, 8080);
  assert.equal(config.host, '127.0.0.1');
});

test('production environment switches the default log format to json', () => {
  const config = loadConfig({ N8N_TS_ENV: 'production' }, REPO);
  assert.equal(config.logFormat, 'json');
  assert.equal(config.env, 'production');
});

test('booleans accept every documented spelling and reject the rest', () => {
  for (const value of ['1', 'true', 'YES', 'on']) {
    assert.equal(loadConfig({ N8N_TS_ALLOW_CODE_EVAL: value }, REPO).allowCodeEval, true, value);
  }
  for (const value of ['0', 'false', 'No', 'off']) {
    assert.equal(loadConfig({ N8N_TS_ALLOW_CODE_EVAL: value }, REPO).allowCodeEval, false, value);
  }
  assert.throws(() => loadConfig({ N8N_TS_ALLOW_CODE_EVAL: 'maybe' }, REPO), ConfigError);
});

test('invalid values fail fast with a readable message', () => {
  assert.throws(() => loadConfig({ N8N_TS_PORT: '0' }, REPO), (error) => error instanceof ConfigError && /N8N_TS_PORT/.test(error.message));
  assert.throws(() => loadConfig({ N8N_TS_PORT: 'abc' }, REPO), ConfigError);
  assert.throws(() => loadConfig({ N8N_TS_PORT: '65536' }, REPO), ConfigError);
  assert.throws(() => loadConfig({ N8N_TS_LOG_LEVEL: 'verbose' }, REPO), ConfigError);
  assert.throws(() => loadConfig({ N8N_TS_STORAGE: 'sqlite' }, REPO), ConfigError);
  assert.throws(() => loadConfig({ N8N_TS_UNKNOWN_NODE_POLICY: 'ignore' }, REPO), ConfigError);
  assert.throws(() => loadConfig({ N8N_TS_UNKNOWN_CONNECTION_POLICY: 'nope' }, REPO), ConfigError);
  assert.throws(() => loadConfig({ N8N_TS_ENV: 'staging' }, REPO), ConfigError);
  assert.throws(() => loadConfig({ N8N_TS_MAX_BODY_BYTES: '10' }, REPO), ConfigError);
});

test('API key handling: unset is allowed, empty is a configuration error', () => {
  assert.equal(loadConfig({}, REPO).apiKey, null);
  assert.equal(loadConfig({ N8N_TS_API_KEY: '  secret  ' }, REPO).apiKey, 'secret');
  assert.throws(() => loadConfig({ N8N_TS_API_KEY: '   ' }, REPO), ConfigError);
});

test('data dir and pid file resolve relative paths against the repo root', () => {
  const config = loadConfig({ N8N_TS_DATA_DIR: 'var/runtime', N8N_TS_PID_FILE: 'var/runtime/pid' }, REPO);
  assert.equal(config.dataDir, join(REPO, 'var/runtime'));
  assert.equal(config.pidFile, join(REPO, 'var/runtime/pid'));
  const absolute = loadConfig({ N8N_TS_DATA_DIR: '/srv/n8n-ts' }, REPO);
  assert.equal(absolute.dataDir, '/srv/n8n-ts');
  assert.equal(absolute.pidFile, '/srv/n8n-ts/runtime.pid');
});

test('describeConfig never leaks the API key', () => {
  const described = describeConfig(loadConfig({ N8N_TS_API_KEY: 'super-secret' }, REPO));
  assert.equal(described.authRequired, true);
  assert.equal(JSON.stringify(described).includes('super-secret'), false);
});
