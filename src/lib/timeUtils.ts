import { mathRandomSource } from '@/domain/report/random-source';
import { generateWorkingTimes } from '@/domain/report/time-sequence';

/**
 * 时间范围限制配置
 * 上午: 9:00 - 12:00
 * 下午: 13:00 - 18:00
 */
export const TIME_RANGES = {
  morning: { start: 9, end: 12 },
  afternoon: { start: 13, end: 18 }
} as const;

/**
 * 生成指定日期的随机时间（在工作时间范围内）
 * @param date 日期字符串 (格式: DD-MM-YYYY)
 * @returns 完整的日期时间字符串 (格式: DD-MM-YYYY HH:MM:SS AM/PM)
 */
export function generateWorkingDateTime(date: string): string {
  // 随机选择上午或下午
  const isMorning = Math.random() > 0.5;
  const range = isMorning ? TIME_RANGES.morning : TIME_RANGES.afternoon;
  
  // 生成随机小时和分钟
  const hour = Math.floor(Math.random() * (range.end - range.start)) + range.start;
  const minute = Math.floor(Math.random() * 60);
  const second = Math.floor(Math.random() * 60);
  
  // 格式化为 12 小时制
  const hour12 = hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  
  // 格式化时间字符串
  const timeStr = `${hour12.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')} ${ampm}`;
  
  return `${date} ${timeStr}`;
}

/**
 * 生成一系列递增的时间
 * @param baseDate 日期字符串 (格式: DD-MM-YYYY)
 * @param count 需要生成的时间数量
 * @param startHour 起始小时（默认9点）
 * @returns 日期时间字符串数组
 */
export function generateSequentialWorkingTimes(
  baseDate: string, 
  count: number, 
  startHour: number = 9
): string[] {
  const times: string[] = [];
  let currentHour = startHour;
  let currentMinute = 0;
  
  for (let i = 0; i < count; i++) {
    // 检查是否需要跳到下午
    if (currentHour === 12) {
      currentHour = 13; // 跳过中午12点
    }
    
    // 检查是否超过下午6点
    if (currentHour >= 18) {
      currentHour = 9; // 重置到上午9点
    }
    
    // 格式化为 12 小时制
    const hour12 = currentHour > 12 ? currentHour - 12 : currentHour;
    const ampm = currentHour >= 12 ? 'PM' : 'AM';
    
    const timeStr = `${hour12.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}:00 ${ampm}`;
    times.push(`${baseDate} ${timeStr}`);
    
    // 增加时间（随机1-5分钟）
    currentMinute += Math.floor(Math.random() * 5) + 1;
    if (currentMinute >= 60) {
      currentMinute -= 60;
      currentHour++;
    }
  }
  
  return times;
}

/**
 * 验证时间是否在工作范围内
 * @param timeStr 时间字符串 (格式: HH:MM:SS AM/PM)
 * @returns 是否有效
 */
export function isValidWorkingTime(timeStr: string): boolean {
  // 解析时间字符串
  const match = timeStr.match(/(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return false;
  
  let hour = parseInt(match[1]);
  const ampm = match[4].toUpperCase();
  
  // 转换为24小时制
  if (ampm === 'PM' && hour !== 12) {
    hour += 12;
  } else if (ampm === 'AM' && hour === 12) {
    hour = 0;
  }
  
  // 检查是否在工作时间范围内
  const inMorning = hour >= TIME_RANGES.morning.start && hour < TIME_RANGES.morning.end;
  const inAfternoon = hour >= TIME_RANGES.afternoon.start && hour < TIME_RANGES.afternoon.end;
  
  return inMorning || inAfternoon;
}

/**
 * 格式化日期
 * @param day 日
 * @param month 月
 * @param year 年
 * @returns 格式化的日期字符串 (DD-MM-YYYY)
 */
export function formatDate(day: number, month: number, year: number): string {
  return `${day.toString().padStart(2, '0')}-${month.toString().padStart(2, '0')}-${year}`;
}

/**
 * 获取当前日期
 * @returns 格式化的日期字符串 (DD-MM-YYYY)
 */
export function getCurrentDate(): string {
  const now = new Date();
  return formatDate(now.getDate(), now.getMonth() + 1, now.getFullYear());
}

/**
 * 获取默认起始时间（AM 9点，分钟1-30随机，秒数随机）
 * @returns 格式化的日期时间字符串 (DD-MM-YYYY 09:MM:SS AM)
 */
export function getDefaultStartingDateTime(): string {
  const now = new Date();
  // 确保使用正确的日期值
  const day = now.getDate();
  const month = now.getMonth() + 1; // JavaScript months are 0-11
  const year = now.getFullYear();
  
  // 严格格式化，确保两位数
  const dayStr = day < 10 ? `0${day}` : `${day}`;
  const monthStr = month < 10 ? `0${month}` : `${month}`;
  
  const randomMinute = Math.floor(Math.random() * 30) + 1; // 1-30
  const randomSecond = Math.floor(Math.random() * 60); // 0-59
  
  return `${dayStr}-${monthStr}-${year} 09:${randomMinute.toString().padStart(2, '0')}:${randomSecond.toString().padStart(2, '0')} AM`;
}

export function generateIncreasingTimes(startTime: string, count: number): string[] {
  return generateWorkingTimes(startTime, count, mathRandomSource);
}

/** @deprecated 使用 generateIncreasingTimes 替代 */
export function generateDecreasingTimes(startTime: string, count: number): string[] {
  return generateWorkingTimes(startTime, count, mathRandomSource);
}
