// @lifecycle canonical - Routes list-change notifications to the serving transport.
/**
 * Publishing `tools/list` and `resources/list` change events.
 *
 * Protocol revision 2026-07-28 replaces unsolicited list-changed pushes with
 * `subscriptions/listen`, and the publish side differs by transport:
 *
 * - HTTP has no long-lived instance to push from, so it publishes through the
 *   handler's notifier, which fans out to every open subscription stream.
 * - STDIO pushes from the single instance `serveStdio` pinned for the
 *   connection.
 *
 * Choosing between them is the whole job of this module. It lives outside
 * `Application` because that class is a lifecycle orchestrator: the choice is
 * real logic with two branches and failure handling, and it needs to be
 * assertable without standing up a server.
 *
 * Both publish paths are synchronous, and both are treated as best-effort. A
 * client that misses a notification re-lists on its own schedule and sees
 * current data; letting the failure escape would instead abort the hot reload
 * that triggered it, which is the worse outcome.
 */

import type { Logger } from '#shared/types/index.js';

import { notifyResourcesChanged } from '#modules/resources/index.js';

/** The publish-side facade a handler exposes over `subscriptions/listen`. */
export interface ListChangePublisher {
  toolsChanged: () => void;
  resourcesChanged: () => void;
}

/** The instance STDIO pinned, narrowed to the two pushes used here. */
export interface ListChangeServer {
  sendToolListChanged: () => void;
  sendResourceListChanged: () => void;
}

export interface ListChangeTargets {
  /** Present once HTTP is serving; undefined on the STDIO-only path. */
  httpPublisher?: ListChangePublisher | undefined;
  pinnedServer: ListChangeServer;
  logger: Logger;
}

/**
 * Announce that the tool list changed.
 *
 * Prefers the HTTP publisher when one exists: on a dual-transport process the
 * per-request instances are the ones clients are actually talking to, and the
 * pinned STDIO instance cannot reach them.
 */
export function publishToolsChanged(targets: ListChangeTargets): void {
  const { httpPublisher, pinnedServer, logger } = targets;
  try {
    if (httpPublisher != null) {
      httpPublisher.toolsChanged();
      logger.debug('[ListChange] Published tools/list change over HTTP');
      return;
    }
    pinnedServer.sendToolListChanged();
    logger.debug('[ListChange] Published tools/list change over STDIO');
  } catch (error) {
    logger.warn('[ListChange] Failed to publish tools/list change:', error);
  }
}

/**
 * Announce that the resource list changed.
 *
 * The STDIO branch delegates to the resources module's own primitive rather
 * than calling `sendResourceListChanged` again here, so there is one
 * implementation of that push rather than two that can drift.
 */
export function publishResourcesChanged(targets: ListChangeTargets): void {
  const { httpPublisher, pinnedServer, logger } = targets;
  if (httpPublisher != null) {
    try {
      httpPublisher.resourcesChanged();
      logger.debug('[ListChange] Published resources/list change over HTTP');
    } catch (error) {
      logger.warn('[ListChange] Failed to publish resources/list change:', error);
    }
    return;
  }
  notifyResourcesChanged(pinnedServer as never, logger);
}
