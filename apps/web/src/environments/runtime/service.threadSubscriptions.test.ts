import { QueryClient } from "@tanstack/react-query";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSubscribeThread = vi.fn();
const mockThreadUnsubscribe = vi.fn();
const mockCreateEnvironmentConnection = vi.fn();
const mockCreateWsRpcClient = vi.fn();
const mockWaitForSavedEnvironmentRegistryHydration = vi.fn();
const mockListSavedEnvironmentRecords = vi.fn();
const mockSavedEnvironmentRegistrySubscribe = vi.fn();

function MockWsTransport() {
  return undefined;
}

vi.mock("../primary", () => ({
  getPrimaryKnownEnvironment: vi.fn(() => ({
    id: "env-1",
    label: "Primary environment",
    source: "window-origin",
    target: {
      httpBaseUrl: "http://127.0.0.1:3000/",
      wsBaseUrl: "ws://127.0.0.1:3000/",
    },
    environmentId: EnvironmentId.make("env-1"),
  })),
}));

vi.mock("./catalog", () => ({
  getSavedEnvironmentRecord: vi.fn(),
  hasSavedEnvironmentRegistryHydrated: vi.fn(() => true),
  listSavedEnvironmentRecords: mockListSavedEnvironmentRecords,
  persistSavedEnvironmentRecord: vi.fn(),
  readSavedEnvironmentBearerToken: vi.fn(),
  removeSavedEnvironmentBearerToken: vi.fn(),
  useSavedEnvironmentRegistryStore: {
    subscribe: mockSavedEnvironmentRegistrySubscribe,
    getState: () => ({
      upsert: vi.fn(),
      remove: vi.fn(),
      markConnected: vi.fn(),
    }),
  },
  useSavedEnvironmentRuntimeStore: {
    getState: () => ({
      ensure: vi.fn(),
      patch: vi.fn(),
      clear: vi.fn(),
    }),
  },
  waitForSavedEnvironmentRegistryHydration: mockWaitForSavedEnvironmentRegistryHydration,
  writeSavedEnvironmentBearerToken: vi.fn(),
}));

vi.mock("./connection", () => ({
  createEnvironmentConnection: mockCreateEnvironmentConnection,
}));

vi.mock("../../rpc/wsRpcClient", () => ({
  createWsRpcClient: mockCreateWsRpcClient,
}));

vi.mock("../../rpc/wsTransport", () => ({
  WsTransport: MockWsTransport,
}));

function makeThreadShellSnapshot(params: {
  readonly threadId: ThreadId;
  readonly sessionStatus?:
    | "idle"
    | "starting"
    | "running"
    | "ready"
    | "interrupted"
    | "stopped"
    | "error";
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly hasActionableProposedPlan?: boolean;
}): OrchestrationShellSnapshot {
  const projectId = ProjectId.make("project-1");
  const turnId = TurnId.make("turn-1");

  return {
    snapshotSequence: 1,
    projects: [],
    updatedAt: "2026-04-13T00:00:00.000Z",
    threads: [
      {
        id: params.threadId,
        projectId,
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn:
          params.sessionStatus === "running"
            ? {
                turnId,
                state: "running",
                requestedAt: "2026-04-13T00:00:00.000Z",
                startedAt: "2026-04-13T00:00:01.000Z",
                completedAt: null,
                assistantMessageId: null,
              }
            : null,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        archivedAt: null,
        session: params.sessionStatus
          ? {
              threadId: params.threadId,
              status: params.sessionStatus,
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: params.sessionStatus === "running" ? turnId : null,
              lastError: null,
              updatedAt: "2026-04-13T00:00:00.000Z",
            }
          : null,
        latestUserMessageAt: null,
        hasPendingApprovals: params.hasPendingApprovals ?? false,
        hasPendingUserInput: params.hasPendingUserInput ?? false,
        hasActionableProposedPlan: params.hasActionableProposedPlan ?? false,
      },
    ],
  };
}

describe("retainThreadDetailSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();

    mockThreadUnsubscribe.mockImplementation(() => undefined);
    mockSubscribeThread.mockImplementation(() => mockThreadUnsubscribe);
    mockCreateWsRpcClient.mockReturnValue({
      orchestration: {
        subscribeThread: mockSubscribeThread,
      },
    });
    mockCreateEnvironmentConnection.mockImplementation((input) => ({
      kind: input.kind,
      environmentId: input.knownEnvironment.environmentId,
      knownEnvironment: input.knownEnvironment,
      client: input.client,
      ensureBootstrapped: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    }));
    mockSavedEnvironmentRegistrySubscribe.mockReturnValue(() => undefined);
    mockWaitForSavedEnvironmentRegistryHydration.mockResolvedValue(undefined);
    mockListSavedEnvironmentRecords.mockReturnValue([]);
  });

  afterEach(async () => {
    const { resetEnvironmentServiceForTests } = await import("./service");
    await resetEnvironmentServiceForTests();
    vi.useRealTimers();
  });

  it("keeps thread detail subscriptions warm across releases until idle eviction", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-1");

    const releaseFirst = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    releaseFirst();
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    const releaseSecond = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(28 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("keeps non-idle thread detail subscriptions attached until the thread becomes idle", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-active");

    const connectionInput = mockCreateEnvironmentConnection.mock.calls[0]?.[0];
    expect(connectionInput).toBeDefined();

    connectionInput.syncShellSnapshot(
      makeThreadShellSnapshot({
        threadId,
        sessionStatus: "ready",
        hasPendingApprovals: true,
      }),
      environmentId,
    );

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    connectionInput.applyShellEvent(
      {
        kind: "thread-upserted",
        sequence: 2,
        thread: makeThreadShellSnapshot({
          threadId,
          sessionStatus: "idle",
        }).threads[0]!,
      },
      environmentId,
    );

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("allows a larger idle cache before capacity eviction starts", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");

    for (let index = 0; index < 12; index += 1) {
      const release = retainThreadDetailSubscription(
        environmentId,
        ThreadId.make(`thread-${index + 1}`),
      );
      release();
    }

    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("disposes cached thread detail subscriptions when the environment service resets", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-2");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    release();

    await resetEnvironmentServiceForTests();
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
  });
});

describe("resyncThreadDetailSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();

    mockThreadUnsubscribe.mockImplementation(() => undefined);
    mockSubscribeThread.mockImplementation(() => mockThreadUnsubscribe);
    mockCreateWsRpcClient.mockReturnValue({
      orchestration: {
        subscribeThread: mockSubscribeThread,
      },
    });
    mockCreateEnvironmentConnection.mockImplementation((input) => ({
      kind: input.kind,
      environmentId: input.knownEnvironment.environmentId,
      knownEnvironment: input.knownEnvironment,
      client: input.client,
      ensureBootstrapped: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    }));
    mockSavedEnvironmentRegistrySubscribe.mockReturnValue(() => undefined);
    mockWaitForSavedEnvironmentRegistryHydration.mockResolvedValue(undefined);
    mockListSavedEnvironmentRecords.mockReturnValue([]);
  });

  afterEach(async () => {
    const { resetEnvironmentServiceForTests } = await import("./service");
    await resetEnvironmentServiceForTests();
    vi.useRealTimers();
  });

  it("tears down the old stream and re-subscribes when the thread is tracked", async () => {
    const {
      retainThreadDetailSubscription,
      resyncThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-resync");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    const issued = resyncThreadDetailSubscription(environmentId, threadId);
    expect(issued).toBe(true);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(2);

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("returns false and does nothing when the thread is not tracked", async () => {
    const {
      resyncThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-untracked");

    const issued = resyncThreadDetailSubscription(environmentId, threadId);
    expect(issued).toBe(false);
    expect(mockSubscribeThread).not.toHaveBeenCalled();
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("does not change refCount: existing retainers still hold the subscription after resync", async () => {
    const {
      retainThreadDetailSubscription,
      resyncThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-refcount");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    resyncThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(2);
    // Re-attach unsubscribe count is 1 (the prior stream was torn down).
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    // Retainer is still active — releasing it now triggers the standard idle
    // eviction flow (unsubscribe fires after the idle TTL elapses).
    release();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(2);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("supports back-to-back resyncs", async () => {
    const {
      retainThreadDetailSubscription,
      resyncThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-spam-resync");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    expect(resyncThreadDetailSubscription(environmentId, threadId)).toBe(true);
    expect(resyncThreadDetailSubscription(environmentId, threadId)).toBe(true);
    expect(resyncThreadDetailSubscription(environmentId, threadId)).toBe(true);

    expect(mockSubscribeThread).toHaveBeenCalledTimes(4);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(3);

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });
});

describe("cleanupAndResyncThreadDetailSubscription", () => {
  const mockCleanupThreadOrphans = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();

    mockThreadUnsubscribe.mockImplementation(() => undefined);
    mockSubscribeThread.mockImplementation(() => mockThreadUnsubscribe);
    mockCleanupThreadOrphans.mockResolvedValue({
      deletedActivities: 0,
      deletedMessages: 0,
      deletedProposedPlans: 0,
      resetSessions: 0,
      resetTurns: 0,
    });
    mockCreateWsRpcClient.mockReturnValue({
      orchestration: {
        cleanupThreadOrphans: mockCleanupThreadOrphans,
        subscribeThread: mockSubscribeThread,
      },
    });
    mockCreateEnvironmentConnection.mockImplementation((input) => ({
      kind: input.kind,
      environmentId: input.knownEnvironment.environmentId,
      knownEnvironment: input.knownEnvironment,
      client: input.client,
      ensureBootstrapped: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    }));
    mockSavedEnvironmentRegistrySubscribe.mockReturnValue(() => undefined);
    mockWaitForSavedEnvironmentRegistryHydration.mockResolvedValue(undefined);
    mockListSavedEnvironmentRecords.mockReturnValue([]);
  });

  afterEach(async () => {
    const { resetEnvironmentServiceForTests } = await import("./service");
    await resetEnvironmentServiceForTests();
    vi.useRealTimers();
  });

  it("calls server cleanup BEFORE re-subscribing so the snapshot reflects the cleaned state", async () => {
    const {
      cleanupAndResyncThreadDetailSubscription,
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-cleanup");

    const callOrder: Array<string> = [];
    mockCleanupThreadOrphans.mockImplementation(async () => {
      callOrder.push("cleanup");
      return {
        deletedActivities: 2,
        deletedMessages: 1,
        deletedProposedPlans: 0,
        resetSessions: 0,
        resetTurns: 0,
      };
    });
    mockSubscribeThread.mockImplementation(() => {
      callOrder.push("subscribe");
      return mockThreadUnsubscribe;
    });

    const release = retainThreadDetailSubscription(environmentId, threadId);
    // The retain itself triggers a subscribe; reset the order tracker so the
    // assertion targets only what cleanupAndResync does.
    callOrder.length = 0;
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    const outcome = await cleanupAndResyncThreadDetailSubscription(environmentId, threadId);

    expect(outcome).toEqual({
      kind: "ok",
      cleanup: {
        deletedActivities: 2,
        deletedMessages: 1,
        deletedProposedPlans: 0,
        resetSessions: 0,
        resetTurns: 0,
      },
      resyncIssued: true,
    });
    expect(mockCleanupThreadOrphans).toHaveBeenCalledWith({ threadId });
    // cleanup must finish before the new subscribe so the snapshot the server
    // returns is the post-cleanup state.
    expect(callOrder).toEqual(["cleanup", "subscribe"]);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("still cleans up on the server when the thread is not currently tracked locally", async () => {
    const {
      cleanupAndResyncThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-untracked-cleanup");

    mockCleanupThreadOrphans.mockResolvedValue({
      deletedActivities: 1,
      deletedMessages: 0,
      deletedProposedPlans: 0,
      resetSessions: 0,
      resetTurns: 0,
    });

    const outcome = await cleanupAndResyncThreadDetailSubscription(environmentId, threadId);

    // No retainer, so resync cannot be issued; cleanup still runs.
    expect(outcome).toEqual({
      kind: "ok",
      cleanup: {
        deletedActivities: 1,
        deletedMessages: 0,
        deletedProposedPlans: 0,
        resetSessions: 0,
        resetTurns: 0,
      },
      resyncIssued: false,
    });
    expect(mockCleanupThreadOrphans).toHaveBeenCalledTimes(1);
    expect(mockSubscribeThread).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("returns no-connection outcome when no environment connection exists yet", async () => {
    const { cleanupAndResyncThreadDetailSubscription } = await import("./service");

    // Note: we have NOT called startEnvironmentConnectionService, so no
    // connection is registered for env-1.
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-disconnected");

    const outcome = await cleanupAndResyncThreadDetailSubscription(environmentId, threadId);

    expect(outcome).toEqual({ kind: "no-connection" });
    expect(mockCleanupThreadOrphans).not.toHaveBeenCalled();
    expect(mockSubscribeThread).not.toHaveBeenCalled();
  });

  it("does NOT resync when the cleanup RPC fails (so the broken snapshot is not re-applied)", async () => {
    const {
      cleanupAndResyncThreadDetailSubscription,
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-cleanup-fail");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    mockCleanupThreadOrphans.mockRejectedValueOnce(new Error("db down"));

    const outcome = await cleanupAndResyncThreadDetailSubscription(environmentId, threadId);

    expect(outcome).toEqual({ kind: "error", message: "db down" });
    // Subscribe count unchanged: no resync was triggered.
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });
});
