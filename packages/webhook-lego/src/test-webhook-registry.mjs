import { WebhookNotFoundError } from './errors.mjs';

const keyOf = (method, path) => `${method.toUpperCase()}|${String(path).replace(/^\/+|\/+$/g, '')}`;

export class TestWebhookRegistry {
  constructor({ ttlMs = 120_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.ttlMs = ttlMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.registrations = new Map();
  }

  register({ method, path, execute, onTimeout = () => {} }) {
    const key = keyOf(method, path);
    this.cancel(method, path);
    const timer = this.setTimer(() => {
      this.registrations.delete(key);
      onTimeout();
    }, this.ttlMs);
    timer.unref?.();
    this.registrations.set(key, { execute, timer });
  }

  cancel(method, path) {
    const key = keyOf(method, path);
    const registration = this.registrations.get(key);
    if (!registration) return false;
    this.clearTimer(registration.timer);
    this.registrations.delete(key);
    return true;
  }

  getWebhookMethods(path) {
    const suffix = `|${String(path).replace(/^\/+|\/+$/g, '')}`;
    return [...this.registrations.keys()].filter((key) => key.endsWith(suffix)).map((key) => key.split('|')[0]);
  }

  async executeWebhook(request) {
    const key = keyOf(request.method, request.path);
    const registration = this.registrations.get(key);
    if (!registration) {
      throw new WebhookNotFoundError({ method: request.method, path: request.path, test: true });
    }
    this.cancel(request.method, request.path);
    return await registration.execute(request);
  }
}
