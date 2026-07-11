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
    
    // 验证范围0-59
    if (isNaN(newMinute) || newMinute < 0) {
      newMinute = 0;
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
            aria-label="日期"
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
          <SelectTrigger className="w-[70px]" aria-label="小时">
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
          min={0}
          max={59}
          placeholder="分"
          aria-label="分钟"
        />
      </div>

      {/* AM/PM 选择器 */}
      <Select
        value={parsed.ampm}
        onValueChange={handleAmPmChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-[80px]" aria-label="上午或下午">
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

export {
  generateDecreasingTimes,
  generateIncreasingTimes,
} from '@/lib/timeUtils';
