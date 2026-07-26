/**
 * Application composition root.
 *
 * Constructs the Slack app, HTTP server, and pipeline, injecting real
 * dependencies into the otherwise pure modules. Owns startup and graceful
 * shutdown ordering.
 */

import pkg from '@slack/bolt';
import { WebClient } from '@slack/web-api';

import { config, validateConfig } from './config.js';
import { log } from './logger.js';
import { initDatabase, closeDatabase } from './db.js';
import { makeGetUserInfo } from './slack/users.js';
import { registerSlackEvents } from './slack/events.js';
import { registerSlackCommands } from './slack/commands.js';
import { processMember } from './pipeline.js';
import { createServer } from './server.js';

const { App } = pkg;

export class SlackAIAgent {
  constructor() {
    // Fail fast and loud on misconfiguration, before opening any connections.
    validateConfig();

    this.slackApp = new App({
      token: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      socketMode: true,
      appToken: config.slack.appToken,
    });
    this.webClient = new WebClient(config.slack.botToken);

    this.getUserInfo = makeGetUserInfo(this.webClient);
    this.postMessage = (payload) => this.webClient.chat.postMessage(payload);

    // The pipeline needs a way to post; bind it once here.
    this.processMember = (member, extra = {}) => processMember(member, { postMessage: this.postMessage, ...extra });

    registerSlackEvents(this.slackApp, {
      getUserInfo: this.getUserInfo,
      processMember: this.processMember,
    });

    // `/analyze @user` — trigger the pipeline on demand from inside Slack.
    registerSlackCommands(this.slackApp, {
      getUserInfo: this.getUserInfo,
      processMember: this.processMember,
      postMessage: this.postMessage,
    });

    this.httpApp = createServer({ postMessage: this.postMessage });
    this.server = null;
  }

  async start() {
    log.info('startup_begin', { nodeEnv: config.nodeEnv });

    await initDatabase();

    await new Promise((resolve) => {
      this.server = this.httpApp.listen(config.port, () => {
        log.info('http_listening', { port: config.port });
        resolve();
      });
    });

    await this.slackApp.start();
    log.info('slack_connected');
    log.info('agent_ready', '⚡️ Slack AI Agent is running');

    if (config.isDev) {
      log.info('dev_hint', `Test with: curl -XPOST localhost:${config.port}/test/analyze-member`);
    }
  }

  async stop() {
    log.info('shutdown_begin');
    try {
      await this.slackApp.stop().catch((e) => log.warn('slack_stop_error', e.message));
      if (this.server) {
        await new Promise((resolve) => this.server.close(resolve));
      }
      await closeDatabase().catch((e) => log.warn('db_close_error', e.message));
      log.info('shutdown_complete');
    } catch (error) {
      log.error('shutdown_error', error.message);
    }
  }
}

export default SlackAIAgent;
