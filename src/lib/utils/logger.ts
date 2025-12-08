export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export class Logger {
  private static instance: Logger;
  private level: LogLevel;
  private context: string = '';

  private constructor() {
    this.level = process.env.NODE_ENV === 'production'
      ? LogLevel.ERROR
      : LogLevel.DEBUG;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setContext(context: string): Logger {
    const newLogger = Object.create(Logger.prototype);
    Object.assign(newLogger, this);
    newLogger.context = context;
    return newLogger;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    const contextStr = this.context ? `[${this.context}]` : '';
    return `[${timestamp}] [${level}]${contextStr} ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(this.formatMessage('DEBUG', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message), ...args);
    }
  }

  error(message: string, error?: Error, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', message), error, ...args);
    }
  }

  time(label: string): void {
    if (this.level <= LogLevel.DEBUG) {
      console.time(`[TIME]${this.context ? `[${this.context}]` : ''} ${label}`);
    }
  }

  timeEnd(label: string): void {
    if (this.level <= LogLevel.DEBUG) {
      console.timeEnd(`[TIME]${this.context ? `[${this.context}]` : ''} ${label}`);
    }
  }

  group(label: string): void {
    if (this.level <= LogLevel.DEBUG) {
      console.group(this.formatMessage('GROUP', label));
    }
  }

  groupEnd(): void {
    if (this.level <= LogLevel.DEBUG) {
      console.groupEnd();
    }
  }
}

export const logger = Logger.getInstance();
