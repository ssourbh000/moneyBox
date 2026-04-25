import {
  IsString, IsOptional, IsArray, IsNumber, IsObject,
  ArrayMinSize, Min, Max,
} from 'class-validator';

export class RiskLimitsDto {
  @IsOptional() @IsNumber() @Min(0) maxDailyLoss?: number;
  @IsOptional() @IsNumber() @Min(1) maxOpenPositions?: number;
  @IsOptional() @IsNumber() @Min(0) maxPositionSize?: number;
  @IsOptional() @IsNumber() @Min(0) paperCapital?: number;
  @IsOptional() @IsNumber() @Min(0.1) @Max(5) riskPercentPerTrade?: number;
}

export class CreateStrategyDto {
  @IsString() name: string;

  @IsOptional() @IsString() description?: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  universe: string[];

  @IsString() exchange: string;

  @IsOptional() riskLimits?: RiskLimitsDto;

  @IsOptional() @IsObject()
  parameters?: {
    dailyEma1?: number;
    dailyEma2?: number;
    hourlyEmaPeriod?: number;
    hourlyAdxPeriod?: number;
    hourlyAdxMin?: number;
    hourlyRsiPeriod?: number;
    hourlyRsiMin?: number;
    hourlyRsiMax?: number;
    entryEmaPeriod?: number;
    entryAtrPeriod?: number;
    entryVolumeRatioMin?: number;
    stopAtrMultiplier?: number;
    targetRiskRatio?: number;
  };
}

export class UpdateStrategyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) universe?: string[];
  @IsOptional() riskLimits?: RiskLimitsDto;
  @IsOptional() @IsObject() parameters?: Record<string, number>;
}
