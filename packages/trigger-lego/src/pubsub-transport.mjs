import { EventEmitter } from 'node:events';

export const COMMAND_PUBSUB_CHANNEL = 'n8n.commands';
export const SELF_SEND_COMMANDS = new Set([
  'add-webhooks-triggers-and-pollers',
  'remove-triggers-and-pollers',
]);
export const IMMEDIATE_COMMANDS = new Set([
  'add-webhooks-triggers-and-pollers',
  'remove-triggers-and-pollers',
  'relay-execution-lifecycle-event',
  'relay-chat-stream-event',
]);

const NOOP_LOGGER = Object.freeze({ debug() {}, error() {} });
const channelName = (prefix) => `${prefix}:${COMMAND_PUBSUB_CHANNEL}`;

/** Dependency-free command event bus used at the Trigger LEGO boundary. */
export class PubSubEventBus extends EventEmitter {}

/** Publishes reference-compatible command envelopes through an injected Redis-like client. */
export class PubSubPublisher {
  constructor({ clientFactory, hostId, mode = 'queue', prefix = 'n8n', logger = NOOP_LOGGER }) {
    this.mode = mode;
    this.hostId = hostId;
    this.logger = logger;
    this.commandChannel = channelName(prefix);
    this.client = mode === 'queue' ? clientFactory?.({ type: 'publisher(n8n)' }) : undefined;
    if (mode === 'queue' && !this.client) throw new Error('PubSubPublisher requires a clientFactory in queue mode');
  }

  getClient() { return this.client; }
  getCommandChannel() { return this.commandChannel; }

  async publishCommand(message) {
    if (this.mode !== 'queue') return;
    const envelope = {
      ...message,
      senderId: this.hostId,
      selfSend: SELF_SEND_COMMANDS.has(message.command),
      debounce: !IMMEDIATE_COMMANDS.has(message.command),
    };
    await this.client.publish(this.commandChannel, JSON.stringify(envelope));
    this.logger.debug(`Published pubsub msg: ${message.command}`, { msg: message.command, channel: this.commandChannel });
  }

  shutdown() { this.client?.disconnect(); }
}

/**
 * Parses and routes command envelopes from an injected Redis-like subscriber.
 * A single trailing debounce reproduces the reference subscriber's burst coalescing.
 */
export class PubSubSubscriber {
  constructor({ clientFactory, eventBus, hostId, mode = 'queue', prefix = 'n8n', debounceMs = 300, logger = NOOP_LOGGER }) {
    if (!eventBus) throw new Error('PubSubSubscriber requires an eventBus');
    this.mode = mode;
    this.eventBus = eventBus;
    this.hostId = hostId;
    this.logger = logger;
    this.debounceMs = debounceMs;
    this.commandChannel = channelName(prefix);
    this.client = mode === 'queue' ? clientFactory?.({ type: 'subscriber(n8n)' }) : undefined;
    if (mode === 'queue' && !this.client) throw new Error('PubSubSubscriber requires a clientFactory in queue mode');
    if (this.client) this.client.on('message', (channel, serialized) => this.onMessage(channel, serialized));
  }

  getClient() { return this.client; }
  getCommandChannel() { return this.commandChannel; }

  async subscribe(channel = this.commandChannel) {
    if (!this.client) return;
    await this.client.subscribe(channel, (error) => {
      if (error) this.logger.error(`Failed to subscribe to channel ${channel}`, { error });
      else this.logger.debug(`Subscribed to channel ${channel}`);
    });
  }

  onMessage(channel, serialized) {
    const message = this.parseMessage(serialized, channel);
    if (!message) return;
    if (!message.debounce) return this.dispatch(message);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.dispatch(message), this.debounceMs);
  }

  parseMessage(serialized, channel = this.commandChannel) {
    let message;
    try { message = JSON.parse(serialized); } catch { message = null; }
    if (!message || typeof message !== 'object' || typeof message.command !== 'string') {
      this.logger.error('Received malformed pubsub message', { msg: serialized, channel });
      return null;
    }
    if (!message.selfSend && (message.senderId === this.hostId || (message.targets && !message.targets.includes(this.hostId)))) return null;
    this.logger.debug(`Received pubsub msg: ${message.command}`, { msg: message.command, channel });
    return message;
  }

  dispatch(message) { this.eventBus.emit(message.command, message.payload); }

  shutdown() {
    clearTimeout(this.debounceTimer);
    this.client?.disconnect();
  }
}

/** Registers command handlers with static instance-type and dynamic role filtering. */
export class PubSubRegistry {
  constructor({ eventBus, instanceSettings, handlers = [], logger = NOOP_LOGGER }) {
    if (!eventBus || !instanceSettings) throw new Error('PubSubRegistry requires eventBus and instanceSettings');
    this.eventBus = eventBus;
    this.instanceSettings = instanceSettings;
    this.handlers = handlers;
    this.logger = logger;
    this.registered = [];
  }

  init() {
    for (const { eventName, listener } of this.registered) this.eventBus.off(eventName, listener);
    this.registered = [];
    for (const descriptor of this.handlers) {
      const { eventName, handler, filter } = descriptor;
      if (filter?.instanceType && filter.instanceType !== this.instanceSettings.instanceType) continue;
      const listener = async (...args) => {
        const roleMatches = filter?.instanceType !== 'main' || !filter.instanceRole || filter.instanceRole === this.instanceSettings.instanceRole;
        if (roleMatches) await handler(...args);
      };
      this.eventBus.on(eventName, listener);
      this.registered.push({ eventName, listener });
      this.logger.debug(`Registered a "${eventName}" event handler`);
    }
  }

  shutdown() {
    for (const { eventName, listener } of this.registered) this.eventBus.off(eventName, listener);
    this.registered = [];
  }
}
