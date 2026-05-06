export const DEFAULTS = {
  worktreeRoot: ".worktree",
  proxyPort: 8080,
  ready: {
    endpoint: "/",
    timeout: "30s",
    pollInterval: "200ms",
  },
  run: {
    shutdownTimeout: "5s",
    restartOnCrash: true,
    warmConcurrency: 4,
  },
  ports: {
    rangeStart: 41000,
    rangeEnd: 65000,
  },
  log: {
    bufferLines: 1000,
    rotateBytes: 10 * 1024 * 1024,
    rotateKeep: 3,
  },
} as const;
