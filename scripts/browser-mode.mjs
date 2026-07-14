export function createBrowserDevelopmentEnvironment(
  baseEnvironment,
  { workspace, port },
) {
  return {
    ...baseEnvironment,
    CABLE_DEV_BROWSER_MODE: '1',
    COZE_WORKSPACE_PATH: workspace,
    DEPLOY_RUN_PORT: port,
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    PORT: port,
  };
}

export function createStartConfiguration({ args, env, workspace }) {
  const browserDevMode = args.includes('--browser-dev');
  const port = env.PORT || env.DEPLOY_RUN_PORT || '10000';
  const host = browserDevMode ? '127.0.0.1' : env.HOST || '0.0.0.0';
  const childEnv = {
    ...env,
    COZE_WORKSPACE_PATH: workspace,
    COZE_PROJECT_ENV: env.COZE_PROJECT_ENV || 'PROD',
    DEPLOY_RUN_PORT: port,
    HOST: host,
    HOSTNAME: host,
    PORT: port,
  };

  if (browserDevMode) {
    childEnv.CABLE_DEV_BROWSER_MODE = '1';
  } else {
    delete childEnv.CABLE_DEV_BROWSER_MODE;
  }

  return { browserDevMode, childEnv, host, port };
}
