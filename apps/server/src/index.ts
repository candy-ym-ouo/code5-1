import { config } from './config.ts';
import { createApp } from './app.ts';

const { app, store } = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`山海植物志服务已启动：http://${config.host}:${config.port}`);
});

function shutdown(signal: string) {
  console.log(`收到 ${signal}，正在关闭服务`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
