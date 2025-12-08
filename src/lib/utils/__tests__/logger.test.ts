import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, LogLevel } from '../logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: {
    log: any;
    warn: any;
    error: any;
  };

  beforeEach(() => {
    logger = Logger.getInstance();
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Log Levels', () => {
    it('DEBUG 레벨에서 모든 로그를 출력해야 함', () => {
      logger.setLevel(LogLevel.DEBUG);

      logger.debug('디버그 메시지');
      logger.info('정보 메시지');
      logger.warn('경고 메시지');
      logger.error('에러 메시지');

      expect(consoleSpy.log).toHaveBeenCalledTimes(2);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    it('INFO 레벨에서 DEBUG를 제외한 로그를 출력해야 함', () => {
      logger.setLevel(LogLevel.INFO);

      logger.debug('디버그 메시지');
      logger.info('정보 메시지');
      logger.warn('경고 메시지');
      logger.error('에러 메시지');

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    it('ERROR 레벨에서 에러만 출력해야 함', () => {
      logger.setLevel(LogLevel.ERROR);

      logger.debug('디버그 메시지');
      logger.info('정보 메시지');
      logger.warn('경고 메시지');
      logger.error('에러 메시지');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    it('NONE 레벨에서 아무것도 출력하지 않아야 함', () => {
      logger.setLevel(LogLevel.NONE);

      logger.debug('디버그 메시지');
      logger.info('정보 메시지');
      logger.warn('경고 메시지');
      logger.error('에러 메시지');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });
  });

  describe('Context', () => {
    it('컨텍스트가 있는 로거를 생성할 수 있어야 함', () => {
      logger.setLevel(LogLevel.DEBUG);
      const contextLogger = logger.setContext('TestContext');

      contextLogger.info('테스트 메시지');

      expect(consoleSpy.log).toHaveBeenCalled();
      const callArg = consoleSpy.log.mock.calls[0][0];
      expect(callArg).toContain('[TestContext]');
      expect(callArg).toContain('테스트 메시지');
    });
  });

  describe('Singleton Pattern', () => {
    it('항상 같은 인스턴스를 반환해야 함', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();

      expect(instance1).toBe(instance2);
    });
  });
});
