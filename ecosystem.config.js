module.exports = {
  apps: [
    {
      name: 'tpm-backend',
      script: 'dist/main.js',
      cwd: './backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'tpm-frontend-ssr', // Si usas Angular SSR
      script: 'dist/frontend/server/main.js',
      cwd: './frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      },
    },
  ],
};
