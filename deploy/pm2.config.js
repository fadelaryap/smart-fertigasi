// PM2 ecosystem file for the Control App. (Use EITHER PM2 or the systemd unit.)
//
//   cd /home/fadelaryap/agrihub-fertigation
//   pm2 start deploy/pm2.config.js
//   pm2 save && pm2 startup    # auto-start on boot
//
// The app loads the single root .env itself (via lib/env.ts), so credentials are
// not duplicated here. Adjust `cwd` to your install path.
module.exports = {
  apps: [
    {
      name: "fertigation-control",
      cwd: "/home/fadelaryap/agrihub-fertigation/control-app",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: "4500",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      time: true,
    },
  ],
};
