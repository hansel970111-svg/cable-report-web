if (process.env.PROCESS_TREE_CHILD_IGNORE_SIGTERM === '1') {
  process.on('SIGTERM', () => {});
}

process.send?.({ ready: true });
setInterval(() => {}, 1_000);
