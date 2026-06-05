module.exports = {
  apps: [
    {
      name: 'moneybox-backend',
      script: 'dist/main.js',
      cwd: '/Users/sourabh/Desktop/MoneyBox/backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/Users/sourabh/.pm2/logs/moneybox-backend-error.log',
      out_file:   '/Users/sourabh/.pm2/logs/moneybox-backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
