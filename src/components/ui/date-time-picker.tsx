'use client';

import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value: string; // 格式: DD-MM-YYYY HH:MM:SS AM/PM
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export function DateTimePicker({ value, onChange, className, disabled }: DateTimePickerProps) {
  // 使用 ref 来追踪最新的 value，避免闭包陷阱
  const valueRef = React.useRef(value);
  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);
  
  // 解析当前值 - 使用严格验证
  const parseValue = (val: string) => {
    // 首先检查值是否为空或无效
    if (!val || typeof val !== 'string') {
      const now = new Date();
      return {
        day: now.getDate(),
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        hour: 9,
        minute: 15,
        second: 30,
        ampm: 'AM' as 'AM' | 'PM',
      };
    }
    
    const match = val.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);
      
      // 验证日期有效性（月份必须是1-12）
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000) {
        return {
          day,
          month,
          year,
          hour: parseInt(match[4], 10),
          minute: parseInt(match[5], 10),
          second: parseInt(match[6], 10),
          ampm: match[7].toUpperCase() as 'AM' | 'PM',
        };
      }
    }
    
    // 默认值（使用固定值而非随机值）
    const now = new Date();
    return {
      day: now.getDate(),
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      hour: 9,
      minute: 15,  // 固定默认值
      second: 30,  // 固定默认值
      ampm: 'AM' as 'AM' | 'PM',
    };
  };

  const parsed = parseValue(value);
  
  // 辅助函数：从 ref 获取最新值并解析，避免闭包陷阱
  const parseLatestValue = () => parseValue(valueRef.current);

  // 创建Date对象用于Calendar
  const selectedDate = new Date(parsed.year, parsed.month - 1, parsed.day);

  // 格式化显示日期
  const formatDisplayDate = `${parsed.day.toString().padStart(2, '0')}-${parsed.month.toString().padStart(2, '0')}-${parsed.year}`;

  const handleDateChange = (date: Date | undefined) => {
    if (!date) return;
    const latest = parseLatestValue();
    const newDay = date.getDate();
    const newMonth = date.getMonth() + 1;
    const newYear = date.getFullYear();
    const newValue = `${newDay.toString().padStart(2, '0')}-${newMonth.toString().padStart(2, '0')}-${newYear} ${latest.hour.toString().padStart(2, '0')}:${latest.minute.toString().padStart(2, '0')}:${latest.second.toString().padStart(2, '0')} ${latest.ampm}`;
    onChange(newValue);
  };

  const handleHourChange = (hour: string) => {
    const newHour = parseInt(hour);
    const latest = parseLatestValue();
    const newValue = `${latest.day.toString().padStart(2, '0')}-${latest.month.toString().padStart(2, '0')}-${latest.year} ${newHour.toString().padStart(2, '0')}:${latest.minute.toString().padStart(2, '0')}:${latest.second.toString().padStart(2, '0')} ${latest.ampm}`;
    onChange(newValue);
  };

  const handleMinuteChange = (minute: string) => {
    // 只允许输入数字
    const numericValue = minute.replace(/\D/g, '');
    let newMinute = parseInt(numericValue);
    
    // 验证范围1-59
    if (isNaN(newMinute) || newMinute < 1) {
      newMinute = 1;
    } else if (newMinute > 59) {
      newMinute = 59;
    }
    
    // 使用 ref 获取最新值，避免闭包陷阱
    const latest = parseLatestValue();
    const newValue = `${latest.day.toString().padStart(2, '0')}-${latest.month.toString().padStart(2, '0')}-${latest.year} ${latest.hour.toString().padStart(2, '0')}:${newMinute.toString().padStart(2, '0')}:${latest.second.toString().padStart(2, '0')} ${latest.ampm}`;
    onChange(newValue);
  };

  const handleAmPmChange = (ampm: string) => {
    const latest = parseLatestValue();
    const newValue = `${latest.day.toString().padStart(2, '0')}-${latest.month.toString().padStart(2, '0')}-${latest.year} ${latest.hour.toString().padStart(2, '0')}:${latest.minute.toString().padStart(2, '0')}:${latest.second.toString().padStart(2, '0')} ${ampm}`;
    onChange(newValue);
  };

  // 生成小时选项 (1-12)
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  


  return (
    <div className={cn("flex gap-2 items-center", className)}>
      {/* 日期选择器 */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-[140px] justify-start text-left font-normal",
              !selectedDate && "text-muted-foreground"
            )}
            disabled={disabled}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {formatDisplayDate}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateChange}
            disabled={(date) => {
              // 禁用周末（周六=6, 周日=0）和未来日期
              const day = date.getDay();
              const today = new Date();
              today.setHours(23, 59, 59, 999); // 设置为今天结束时间
              return day === 0 || day === 6 || date > today;
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {/* 时间选择器 */}
      <div className="flex items-center gap-1">
        {/* 小时 */}
        <Select
          value={parsed.hour.toString()}
          onValueChange={handleHourChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-[70px]">
            <SelectValue placeholder="时" />
          </SelectTrigger>
          <SelectContent>
            {hours.map((h) => (
              <SelectItem key={h} value={h.toString()}>
                {h.toString().padStart(2, '0')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm font-bold">:</span>

        {/* 分钟 - 输入框 */}
        <Input
          type="text"
          inputMode="numeric"
          value={parsed.minute.toString().padStart(2, '0')}
          onChange={(e) => handleMinuteChange(e.target.value)}
          disabled={disabled}
          className="w-[70px] h-9 text-center"
          min={1}
          max={59}
          placeholder="分"
        />
      </div>

      {/* AM/PM 选择器 */}
      <Select
        value={parsed.ampm}
        onValueChange={handleAmPmChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-[80px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * 生成递增的时间序列（支持跨天）
 * @param startTime 起始时间 (格式: DD-MM-YYYY HH:MM:SS AM/PM) - 第一条记录的时间
 * @param count 需要生成的时间数量
 * @returns 时间字符串数组 - 第一个时间就是起始时间
 */
export function generateIncreasingTimes(startTime: string, count: number): string[] {
  const times: string[] = [];
  
  // 解析起始时间 - 使用严格验证
  if (!startTime || typeof startTime !== 'string') {
    return times;
  }
  
  const match = startTime.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return times;
  
  let day = parseInt(match[1], 10);
  let month = parseInt(match[2], 10); // 1-12
  let year = parseInt(match[3], 10);
  
  // 验证日期有效性（月份必须是1-12）
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) {
    return times;
  }
  
  let hour = parseInt(match[4]);
  let minute = parseInt(match[5]);
  let second = parseInt(match[6]);
  const ampm = match[7].toUpperCase();
  
  // 转换为24小时制
  if (ampm === 'PM' && hour !== 12) {
    hour += 12;
  } else if (ampm === 'AM' && hour === 12) {
    hour = 0;
  }
  
  // 创建Date对象用于日期操作
  const createDate = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  
  // 确保日期有效（防止 day = 0 等异常情况）
  const ensureValidDay = (y: number, m: number, d: number): number => {
    if (d < 1) d = 1;
    if (d > 31) d = 31;
    // 检查该月的实际最大天数
    const tempDate = new Date(y, m - 1, 1);
    const maxDay = new Date(y, m, 0).getDate();
    if (d > maxDay) d = maxDay;
    return d;
  };
  
  // 确保月份有效
  const ensureValidMonth = (m: number): number => {
    if (m < 1) m = 1;
    if (m > 12) m = 12;
    return m;
  };
  
  // 获取下一个工作日
  const getNextWorkDay = (date: Date): Date => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    // 跳过周末
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  };
  
  // 检查是否在工作时间范围内（严格边界）
  // 上午: 09:00-11:59 (540-719分钟)
  // 中午休息: 12:00-12:59 (720-779分钟)
  // 下午: 13:00-17:59 (780-1079分钟)
  // 非工作: 18:00及之后 (>=1080分钟)
  const isWorkingHour = (h: number, m: number) => {
    const timeInMinutes = h * 60 + m;
    // 上午: 09:00-11:59
    if (timeInMinutes >= 540 && timeInMinutes < 720) return true;
    // 下午: 13:00-17:59
    if (timeInMinutes >= 780 && timeInMinutes < 1080) return true;
    return false;
  };
  
  // 跳到下一个工作时间段开始点（可能跨天）
  const jumpToNextWorkPeriod = (y: number, mo: number, d: number, h: number, m: number, s: number) => {
    const timeInMinutes = h * 60 + m;
    const currentDate = createDate(y, mo, d);
    
    // 如果早于上午9点（<540分钟），跳到上午工作时间开始点
    if (timeInMinutes < 540) {
      return { 
        year: y, month: mo, day: d,
        hour: 9, 
        minute: Math.floor(Math.random() * 5) + 1,
        second: Math.floor(Math.random() * 60) 
      };
    }
    
    // 如果在中午休息时间（12:00-12:59，720-779分钟），跳到下午工作时间开始点
    if (timeInMinutes >= 720 && timeInMinutes < 780) {
      return { 
        year: y, month: mo, day: d,
        hour: 13, 
        minute: Math.floor(Math.random() * 5) + 1,
        second: Math.floor(Math.random() * 60) 
      };
    }
    
    // 如果晚于或等于下午6点（18:00，>=1080分钟），跳到下一个工作日的上午工作时间
    if (timeInMinutes >= 1080) {
      const nextWorkDay = getNextWorkDay(currentDate);
      return { 
        year: nextWorkDay.getFullYear(),
        month: nextWorkDay.getMonth() + 1,
        day: nextWorkDay.getDate(),
        hour: 9, 
        minute: Math.floor(Math.random() * 5) + 1,
        second: Math.floor(Math.random() * 60) 
      };
    }
    
    // 已经在工作时间范围内，返回原值
    return { year: y, month: mo, day: d, hour: h, minute: m, second: s };
  };
  
  // 格式化时间为12小时制
  const formatTime = (y: number, mo: number, d: number, h: number, mi: number, s: number) => {
    // 确保日期有效性
    const validDay = ensureValidDay(y, mo, d);
    const validMonth = ensureValidMonth(mo);
    
    let displayHour = h;
    let displayAmpm = 'AM';
    
    if (h === 0) {
      displayHour = 12;
      displayAmpm = 'AM';
    } else if (h < 12) {
      displayHour = h;
      displayAmpm = 'AM';
    } else if (h === 12) {
      displayHour = 12;
      displayAmpm = 'PM';
    } else {
      displayHour = h - 12;
      displayAmpm = 'PM';
    }
    
    return `${validDay.toString().padStart(2, '0')}-${validMonth.toString().padStart(2, '0')}-${y} ${displayHour.toString().padStart(2, '0')}:${mi.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} ${displayAmpm}`;
  };
  
  // 如果不在工作时间范围内，先跳到下一个工作时间段开始点
  if (!isWorkingHour(hour, minute)) {
    const jumped = jumpToNextWorkPeriod(year, month, day, hour, minute, second);
    year = jumped.year;
    month = jumped.month;
    day = jumped.day;
    hour = jumped.hour;
    minute = jumped.minute;
    second = jumped.second;
  }
  
  // 添加第一个时间（就是起始时间）
  times.push(formatTime(year, month, day, hour, minute, second));
  
  // 生成剩余的时间（递增）
  for (let i = 1; i < count; i++) {
    // 递增50-90秒
    const increaseSeconds = Math.floor(Math.random() * 41) + 50;
    second += increaseSeconds;
    
    while (second >= 60) {
      second -= 60;
      minute += 1;
    }
    
    while (minute >= 60) {
      minute -= 60;
      hour += 1;
    }
    
    // 如果小时超过23，跳到下一天
    if (hour >= 24) {
      const currentDate = createDate(year, month, day);
      const nextWorkDay = getNextWorkDay(currentDate);
      year = nextWorkDay.getFullYear();
      month = nextWorkDay.getMonth() + 1;
      day = nextWorkDay.getDate();
      hour = 9;
      minute = Math.floor(Math.random() * 5) + 1;
      second = Math.floor(Math.random() * 60);
    }
    
    // 如果不在工作时间范围内，跳到下一个工作时间段
    if (!isWorkingHour(hour, minute)) {
      const jumped = jumpToNextWorkPeriod(year, month, day, hour, minute, second);
      year = jumped.year;
      month = jumped.month;
      day = jumped.day;
      hour = jumped.hour;
      minute = jumped.minute;
      second = jumped.second;
    }
    
    times.push(formatTime(year, month, day, hour, minute, second));
  }
  
  return times;
}

/**
 * 生成递减的时间序列（日期保持不变）- 保留兼容性
 * @deprecated 使用 generateIncreasingTimes 替代
 */
export function generateDecreasingTimes(startTime: string, count: number): string[] {
  // 调用递增函数，保持接口兼容
  return generateIncreasingTimes(startTime, count);
}
