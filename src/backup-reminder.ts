export const BACKUP_REMINDER_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupReminderState {
  due: boolean;
  message: string;
}

/** The timestamp records when the app initiated a full JSON export, not proof the file was safely stored elsewhere. */
export function getBackupReminder(
  lastBackupAt: string | null,
  hasData: boolean,
  nowMs = Date.now(),
): BackupReminderState {
  if (!hasData) return { due: false, message: '' };
  if (!lastBackupAt) return { due: true, message: '尚未发起过完整 JSON 备份导出。' };
  const lastExportMs = Date.parse(lastBackupAt);
  if (!Number.isFinite(lastExportMs) || lastExportMs > nowMs) {
    return { due: true, message: '无法确认上次完整 JSON 备份导出时间。' };
  }
  const elapsedDays = Math.floor((nowMs - lastExportMs) / DAY_MS);
  if (elapsedDays >= BACKUP_REMINDER_INTERVAL_DAYS) {
    return { due: true, message: `距上次发起完整 JSON 备份导出已 ${elapsedDays} 天（提醒周期 ${BACKUP_REMINDER_INTERVAL_DAYS} 天）。` };
  }
  return { due: false, message: '' };
}
