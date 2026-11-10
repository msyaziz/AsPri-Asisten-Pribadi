import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

export const logger = pino({
  level: logLevel,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: isDev ? undefined : { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Child logger khusus Baileys agar tidak membanjiri log (level: warn).
 */
export const baileysLogger = logger.child({ module: 'baileys' }, { level: 'warn' });
