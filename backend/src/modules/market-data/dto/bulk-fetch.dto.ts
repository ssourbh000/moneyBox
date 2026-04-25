import { IsString, IsIn, IsDateString, IsArray, ArrayMinSize } from 'class-validator';

const INTERVALS = [
  'minute', '3minute', '5minute', '10minute', '15minute',
  '30minute', '60minute', 'day', 'week', 'month',
] as const;

export class BulkFetchDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  symbols: string[];

  @IsString()
  exchange: string;

  @IsIn(INTERVALS)
  interval: typeof INTERVALS[number];

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
