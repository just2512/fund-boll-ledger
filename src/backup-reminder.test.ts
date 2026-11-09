import { describe, expect, it } from 'vitest';
import { BACKUP_REMINDER_INTERVAL_DAYS, getBackupReminder } from './backup-reminder';

describe('本地完整备份提醒', () => {
  const now = Date.UTC(2026, 10, 9, 0, 0, 0);
  it('没有任何账本数据时不提醒', () => {
    expect(getBackupReminder(null, false, now)).toEqual({ due: false, message: '' });
  });
  it('有账本但从未发起完整 JSON 导出时提醒', () => {
    expect(getBackupReminder(null, true, now).due).toBe(true);
  });
  it('未达到七天周期时不提醒', () => {
    const recent = new Date(now - (BACKUP_REMINDER_INTERVAL_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(getBackupReminder(recent, true, now).due).toBe(false);
  });
  it('达到七天周期时提醒', () => {
    const due = new Date(now - BACKUP_REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(getBackupReminder(due, true, now).due).toBe(true);
  });
  it('时间戳无效或来自未来时按无法确认处理', () => {
    expect(getBackupReminder('not-a-date', true, now).due).toBe(true);
    expect(getBackupReminder(new Date(now + 1000).toISOString(), true, now).due).toBe(true);
  });
});
