class ConsoleLogger {
  private logs: string[] = [];
  private originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  constructor() {
    this.interceptConsole();
  }

  private interceptConsole() {
    // Override console methods to capture logs
    console.log = (...args: any[]) => {
      const message = this.formatMessage('LOG', args);
      this.logs.push(message);
      this.originalConsole.log.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      const message = this.formatMessage('WARN', args);
      this.logs.push(message);
      this.originalConsole.warn.apply(console, args);
    };

    console.error = (...args: any[]) => {
      const message = this.formatMessage('ERROR', args);
      this.logs.push(message);
      this.originalConsole.error.apply(console, args);
    };
  }

  private formatMessage(level: string, args: any[]): string {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    return `[${timestamp}] [${level}] ${message}`;
  }

  getLogs(): string {
    return this.logs.join('\n');
  }

  clearLogs() {
    this.logs = [];
  }

  downloadLogs(filename: string = 'console-logs.txt') {
    const logs = this.getLogs();
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Create singleton instance
export const consoleLogger = new ConsoleLogger();