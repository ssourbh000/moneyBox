import { IsString, IsEnum, IsDateString, IsOptional, IsIn } from 'class-validator';

const INTERVALS = [
  'minute', '3minute', '5minute', '10minute', '15minute',
  '30minute', '60minute', 'day', 'week', 'month',
] as const;

export class FetchCandlesDto {
  @IsString()
  symbol: string;

  @IsString()
  exchange: string;

  @IsIn(INTERVALS)
  interval: typeof INTERVALS[number];

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class GetCandlesQueryDto {
  @IsString()
  symbol: string;

  @IsString()
  exchange: string;

  @IsIn(INTERVALS)
  interval: typeof INTERVALS[number];

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class SyncInstrumentsDto {
  @IsOptional()
  @IsString({ each: true })
  exchanges?: string[];
}
