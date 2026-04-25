import {
  IsMongoId, IsDateString, IsOptional, IsNumber, Min, Max, IsObject,
} from 'class-validator';

export class CostConfigDto {
  @IsOptional() @IsNumber() @Min(0) brokeragePerSide?: number;
  @IsOptional() @IsNumber() @Min(0) brokerageRatePct?: number;
  @IsOptional() @IsNumber() @Min(0) otherChargesPct?: number;
}

export class RunBacktestDto {
  @IsMongoId()
  strategyId: string;

  @IsDateString()
  fromDate: string;

  @IsDateString()
  toDate: string;

  /**
   * Fraction of date range to use as in-sample (0–1). Out-of-sample = remainder.
   * Default 0.7 (70% in-sample, 30% out-of-sample).
   */
  @IsOptional() @IsNumber() @Min(0.1) @Max(0.95)
  inSampleRatio?: number;

  @IsOptional()
  costConfig?: CostConfigDto;
}
