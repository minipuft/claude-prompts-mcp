import { describe, expect, jest, test } from '@jest/globals';

import {
  publishResourcesChanged,
  publishToolsChanged,
} from '../../../src/runtime/list-change-notifier.js';

import type {
  ListChangeServer,
  ListChangeTargets,
} from '../../../src/runtime/list-change-notifier.js';
import type { Logger } from '../../../src/shared/types/index.js';

/**
 * Under protocol revision 2026-07-28 the publish side of a list-change event
 * depends on which transport is serving: HTTP has no long-lived instance and
 * publishes through the handler's notifier, while STDIO pushes from the
 * instance `serveStdio` pinned for the connection.
 *
 * Picking the wrong one fails silently — the push lands on an object nobody is
 * connected to — so both branches are asserted here rather than inferred.
 */

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeServer(): ListChangeServer {
  return {
    sendToolListChanged: jest.fn(),
    sendResourceListChanged: jest.fn(),
  };
}

function makeTargets(withHttp: boolean): {
  targets: ListChangeTargets;
  server: ListChangeServer;
  publisher: { toolsChanged: jest.Mock; resourcesChanged: jest.Mock };
  logger: Logger;
} {
  const server = makeServer();
  const publisher = { toolsChanged: jest.fn(), resourcesChanged: jest.fn() };
  const logger = makeLogger();
  return {
    targets: {
      httpPublisher: withHttp ? publisher : undefined,
      pinnedServer: server,
      logger,
    },
    server,
    publisher,
    logger,
  };
}

describe('publishToolsChanged', () => {
  test('publishes through the HTTP notifier when HTTP is serving', () => {
    const { targets, server, publisher } = makeTargets(true);

    publishToolsChanged(targets);

    expect(publisher.toolsChanged).toHaveBeenCalledTimes(1);
    // The pinned instance must stay untouched: on a dual-transport process it
    // cannot reach the clients that are actually talking over HTTP.
    expect(server.sendToolListChanged).not.toHaveBeenCalled();
  });

  test('pushes from the pinned instance on the STDIO-only path', () => {
    const { targets, server, publisher } = makeTargets(false);

    publishToolsChanged(targets);

    expect(server.sendToolListChanged).toHaveBeenCalledTimes(1);
    expect(publisher.toolsChanged).not.toHaveBeenCalled();
  });

  test('swallows a publish failure so it cannot abort the caller', () => {
    const { targets, logger } = makeTargets(false);
    (targets.pinnedServer.sendToolListChanged as jest.Mock).mockImplementation(() => {
      throw new Error('Connection closed');
    });

    // The caller is a framework switch or a hot reload. Losing one notification
    // costs a client a stale list until it re-lists; aborting the reload is worse.
    expect(() => publishToolsChanged(targets)).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('publishResourcesChanged', () => {
  test('publishes through the HTTP notifier when HTTP is serving', () => {
    const { targets, server, publisher } = makeTargets(true);

    publishResourcesChanged(targets);

    expect(publisher.resourcesChanged).toHaveBeenCalledTimes(1);
    expect(server.sendResourceListChanged).not.toHaveBeenCalled();
  });

  test('pushes from the pinned instance on the STDIO-only path', () => {
    const { targets, server, publisher } = makeTargets(false);

    publishResourcesChanged(targets);

    expect(server.sendResourceListChanged).toHaveBeenCalledTimes(1);
    expect(publisher.resourcesChanged).not.toHaveBeenCalled();
  });

  test('swallows a publish failure on either branch', () => {
    const httpCase = makeTargets(true);
    httpCase.publisher.resourcesChanged.mockImplementation(() => {
      throw new Error('Stream closed');
    });
    expect(() => publishResourcesChanged(httpCase.targets)).not.toThrow();
    expect(httpCase.logger.warn).toHaveBeenCalled();

    const stdioCase = makeTargets(false);
    (stdioCase.server.sendResourceListChanged as jest.Mock).mockImplementation(() => {
      throw new Error('Connection closed');
    });
    expect(() => publishResourcesChanged(stdioCase.targets)).not.toThrow();
    expect(stdioCase.logger.warn).toHaveBeenCalled();
  });

  test('the two events are independent', () => {
    const { targets, publisher } = makeTargets(true);

    publishToolsChanged(targets);

    expect(publisher.toolsChanged).toHaveBeenCalledTimes(1);
    expect(publisher.resourcesChanged).not.toHaveBeenCalled();
  });
});
