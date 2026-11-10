// PM2: satu proses untuk API + bot + cron
module.exports = {
  apps: [{
    name: 'asisten',
    script: 'src/index.js',
    exec_mode: 'fork',
    instances: 1,
    node_args: '--max-old-space-size=384',
    max_memory_restart: '450M',
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 20,
    time: true,
    env: { NODE_ENV: 'production', TZ: 'Asia/Jakarta' }
  }]
};
