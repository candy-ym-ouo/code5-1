import { config } from '../config.ts';
import { Store } from '../db/store.ts';

const store = new Store(config.databaseUrl);
store.close();
console.log(`数据库已初始化：${config.databaseUrl}`);
