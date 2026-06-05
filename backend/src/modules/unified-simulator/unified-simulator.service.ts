import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OrbSimulatorService } from '../orb-simulator/orb-simulator.service';
import { IVCrushSimulatorService } from '../iv-crush-simulator/iv-crush-simulator.service';
import { EventAlphaSimulatorService } from '../event-alpha-simulator/event-alpha-simulator.service';
import { UnifiedSimParams } from './unified-simulator.controller';
import { UnifiedSimRun, UnifiedSimRunDocument, USRStatus } from './schemas/unified-sim-run.schema';

@Injectable()
export class UnifiedSimulatorService {
  constructor(
    @InjectModel(UnifiedSimRun.name) private readonly model: Model<UnifiedSimRunDocument>,
    private readonly orbSvc:        OrbSimulatorService,
    private readonly ivCrushSvc:    IVCrushSimulatorService,
    private readonly eventAlphaSvc: EventAlphaSimulatorService,
  ) {}

  async run(userId: string, p: UnifiedSimParams) {
    const tasks: Promise<any>[] = [];
    const keys: string[] = [];

    const base = { fromDate: p.fromDate, toDate: p.toDate, capital: p.capital };

    if (p.strategies.a) { tasks.push(this.orbSvc.run({ ...base, ...p.strategies.a }));             keys.push('a'); }
    if (p.strategies.b) { tasks.push(this.ivCrushSvc.simulate({ ...base, ...p.strategies.b }));    keys.push('b'); }
    if (p.strategies.c) { tasks.push(this.eventAlphaSvc.simulate({ ...base, ...p.strategies.c })); keys.push('c'); }

    const rawResults = await Promise.all(tasks);

    const results: Record<string, any> = {};
    keys.forEach((k, idx) => { results[k] = rawResults[idx]; });

    const doc = await this.model.create({
      userId:     new Types.ObjectId(userId),
      fromDate:   new Date(p.fromDate),
      toDate:     new Date(p.toDate),
      capital:    p.capital,
      comboParams: p,
      status:     USRStatus.COMPLETED,
      results,
    });

    return doc.toObject();
  }

  async list(userId: string) {
    return this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('-results')
      .lean();
  }

  async get(id: string) {
    return this.model.findById(id).lean();
  }
}
