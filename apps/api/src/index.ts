import process from 'node:process';
import {createServer} from './server';

const port = Number(process.env.PORT ?? '4010');
const host = process.env.HOST ?? '0.0.0.0';

async function start() {
  const server = createServer();

  try {
    await server.listen({
      host,
      port,
    });
  } catch (error) {
    server.log.error(error);
    process.exitCode = 1;
  }
}

void start();
