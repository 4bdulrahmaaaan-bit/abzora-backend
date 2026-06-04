module.exports = {
  apps: [
    {
      name: 'abianzo-backend-api',
      script: 'server.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'abianzo-backend-workers',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        API_HTTP_DISABLED: 'false',
      },
    },
  ],
};
