import process from 'node:process';
import {createServer} from './server';

const port = Number(process.env.PORT ?? '4010');
const host = process.env.HOST ?? '0.0.0.0';

function getDbPathFlag(): string | undefined {
  const index = process.argv.indexOf('--db-path');

  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function start() {
  const dbPath = getDbPathFlag();
  const server = await createServer(dbPath ? {dbPath} : {});

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
