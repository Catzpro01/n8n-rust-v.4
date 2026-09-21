/**
 * I1 — the contract document and the machine-readable contract agree.
 *
 * `contracts/frontend.contract.md` is the normative text; `src/contract.mjs` is
 * the normative data. This suite fails when they drift, so the boundary cannot
 * quietly become documentation-only (or code-only).
 *
 * Also covers: the surface catalog is complete and honest, and the boot payload
 * exposes exactly the declared field set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOOT_PAYLOAD_KEYS,
  CONTRACT_VERSION,
  ENVELOPES,
  LIST_SHAPES,
  STATUS_SEMANTICS,
  answersEmptyBody,
  describeContract,
  resolveListShape,
} from '../src/contract.mjs';
import { ERROR_CODES, errorMessageKeys } from '../src/errors.mjs';
import { MESSAGE_SLOTS, describeLocales } from '../src/i18n.mjs';
import { createFrontendLego } from '../src/lego.mjs';
import { PACKAGE_ROOT, loadManifests } from '../src/manifests.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const CONTRACT_DOC = readFileSync(join(REPO_ROOT, 'contracts', 'frontend.contract.md'), 'utf8');
const manifests = loadManifests();

const lego = createFrontendLego({
  app: { name: 'n8n lego', version: '0.1.0', referenceVersion: '2.9.4' },
  ui: { basePath: '/', restEndpoint: 'rest' },
});

test('contract version is MAJOR.MINOR and appears in the document and the payload', () => {
  assert.match(CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(CONTRACT_DOC.includes(CONTRACT_VERSION), `contracts/frontend.contract.md must state version ${CONTRACT_VERSION}`);
  assert.equal(lego.bootPayload.contractVersion, CONTRACT_VERSION);
});

test('every status code the contract documents is described in both places', () => {
  for (const [code, entry] of Object.entries(STATUS_SEMANTICS)) {
    assert.ok(CONTRACT_DOC.includes(code), `status ${code} missing from the contract document`);
    assert.ok(typeof entry.meaning === 'string' && entry.meaning.length > 10);
    assert.equal(typeof entry.retryable, 'boolean');
  }
  assert.ok(CONTRACT_DOC.includes('501'), 'the 501 unsupported capability contract must stay documented');
});

test('envelopes and list shapes are documented and resolvable', () => {
  for (const envelope of Object.values(ENVELOPES)) {
    assert.ok(CONTRACT_DOC.includes(envelope.shape) || CONTRACT_DOC.includes(envelope.id), `envelope ${envelope.id} missing from the document`);
  }
  for (const shape of Object.values(LIST_SHAPES)) {
    assert.ok(CONTRACT_DOC.includes(shape.description), `list shape ${shape.description} missing from the document`);
  }
  assert.equal(resolveListShape('/rest/workflows').id, 'count-data');
  assert.equal(resolveListShape('/rest/workflows/abc').id, 'count-data', 'longest prefix wins, nested paths included');
  assert.equal(resolveListShape('/rest/executions').id, 'count-results');
  assert.equal(resolveListShape('/rest/nothing-declared').id, 'data', 'undeclared endpoints fall back to { data }');
  assert.ok(answersEmptyBody('/rest/executions/42'), 'the 200 {} quirk must be declared');
  assert.ok(!answersEmptyBody('/rest/workflows/42'));
});

test('every error message key lives in a declared message slot and is documented', () => {
  const slots = new Set(MESSAGE_SLOTS.map((slot) => slot.id));
  for (const key of errorMessageKeys()) {
    assert.ok(slots.has(key.split('.')[0]), `error key ${key} has no declared slot`);
    assert.ok(CONTRACT_DOC.includes(key), `error key ${key} missing from the document`);
  }
  // Two different vocabularies on purpose: `code` is what code branches on,
  // `messageKey` is what a catalog fills. They must never be the same string.
  const keys = new Set(errorMessageKeys());
  for (const code of Object.values(ERROR_CODES)) {
    assert.ok(!keys.has(code), `${code} is used as both an error code and a message key`);
    assert.ok(CONTRACT_DOC.includes(code), `error code ${code} missing from the document`);
  }
});

test('the surface catalog covers every domain P2.5 requires', () => {
  const required = [
    'dashboard',
    'settings',
    'workflow-editor',
    'node-picker',
    'credentials',
    'executions',
    'webhooks',
    'notifications',
    'dialogs',
    'error-surfaces',
  ];
  const declared = manifests.surfaces.map((surface) => surface.id);
  for (const id of required) assert.ok(declared.includes(id), `surface ${id} is not declared`);
  assert.equal(new Set(declared).size, declared.length, 'surface ids must be unique');
});

test('every surface declares its backend capability, contract and status honestly', () => {
  const statuses = new Set(['present', 'partial', 'unsupported']);
  for (const surface of manifests.surfaces) {
    assert.ok(surface.title && surface.kind, `${surface.id} needs a title and a kind`);
    assert.ok(statuses.has(surface.status), `${surface.id} has unknown status ${surface.status}`);
    assert.ok(surface.backend && typeof surface.backend === 'object', `${surface.id} must describe its backend capability`);
    assert.ok('capability' in surface.backend, `${surface.id} must name the backend capability (or "none" for frontend-owned surfaces)`);
    if (surface.backend.capability !== 'none') {
      assert.match(surface.backend.contract ?? '', /^contracts\/.+\.contract\.md$/, `${surface.id} must point at a contract`);
    }
    assert.ok(Array.isArray(surface.messageSlots) && surface.messageSlots.length > 0, `${surface.id} must declare message slots`);
  }
});

test('every message slot is reachable from at least one declared surface', () => {
  const covered = new Set(manifests.surfaces.flatMap((surface) => surface.messageSlots));
  const unmapped = MESSAGE_SLOTS.filter((slot) => !covered.has(slot.id)).map((slot) => slot.id);
  assert.deepEqual(unmapped, [], 'a slot nobody owns is a slot whose strings will be hard-coded somewhere');
});

test('the extension-point catalog matches the contract document row for row', () => {
  for (const point of manifests.extensionPoints) {
    assert.match(point.id, /^ui:[a-z-]+:[a-z-]+$/, `${point.id} must be namespaced ui:<area>:<name>`);
    assert.ok(CONTRACT_DOC.includes(`\`${point.id}\``), `extension point ${point.id} missing from the contract document`);
    assert.ok(['append', 'wrap', 'replace-own', 'read', 'override-named'].includes(point.additive), `${point.id} has an unknown additive mode`);
    assert.ok(['none', 'own-subtree'].includes(point.mutates), `${point.id} may only mutate its own subtree or nothing`);
    assert.ok(point.status === 'declared', `${point.id} is not implemented in P2.5 — status must stay "declared"`);
  }
  const docs = manifests.extensionPoints.filter((point) => point.id === 'ui:message:catalog' || point.id === 'ui:locale:switch');
  assert.equal(docs.length, 2, 'the Translation LEGO insertion points must exist');
});

test('future consumers are declared but never implemented', () => {
  assert.ok(manifests.futureConsumers.length >= 6, 'the six named future consumers must be catalogued');
  for (const consumer of manifests.futureConsumers) {
    assert.equal(consumer.status, 'not-implemented', `${consumer.id} must not claim to be implemented in P2.5`);
    for (const hook of consumer.hooks) {
      assert.ok(manifests.extensionPoints.some((point) => point.id === hook), `${consumer.id} references undeclared hook ${hook}`);
    }
  }
});

test('the boot payload exposes exactly the declared fields, in order', () => {
  assert.deepEqual(Object.keys(lego.bootPayload), [...BOOT_PAYLOAD_KEYS]);
  const contract = describeContract();
  assert.equal(lego.bootPayload.contract.version, contract.version);
  assert.deepEqual(lego.bootPayload.contract.envelopes, contract.envelopes);
  assert.equal(lego.bootPayload.surfaces.length, manifests.surfaces.length);
  assert.equal(lego.bootPayload.extensionPoints.length, manifests.extensionPoints.length);
  assert.ok(Array.isArray(lego.bootPayload.capabilities));
  assert.deepEqual(lego.bootPayload.capabilities, [], 'P2.5 registers no capability — nothing may look implemented');
});

test('the boot payload stays inside its size budget', () => {
  // The descriptor rides in the served index.html (no-store, so it is re-fetched
  // on every document load). Budget: 24 KB base64 — enough for the full catalog,
  // small enough that it cannot quietly become a second application bundle.
  const encoded = Buffer.from(JSON.stringify(lego.bootPayload), 'utf8').toString('base64').length;
  assert.ok(encoded < 24 * 1024, `boot descriptor is ${encoded} bytes base64 — over budget, trim it or raise the budget deliberately`);
});

test('the locale model declares the six locales, Arabic RTL, and no dictionary', () => {
  const locales = describeLocales();
  assert.deepEqual(locales.supported.map((locale) => locale.code).sort(), ['ar', 'en', 'id', 'jv', 'ru', 'zh']);
  assert.deepEqual(locales.rtl, ['ar']);
  assert.equal(locales.fallback, 'en');
  assert.match(locales.dictionaries, /none/, 'P2.5 must not ship dictionaries');
  for (const locale of locales.supported) {
    assert.ok(locale.nativeName && locale.englishName && ['ltr', 'rtl'].includes(locale.direction));
    assert.equal(locale.status, 'declared');
  }
});
