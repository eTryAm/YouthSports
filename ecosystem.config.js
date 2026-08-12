module.exports = {
  apps: [
    {
      name: "cricket-live-server",
      script: "./server/server.js",
      cwd: "./server",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
