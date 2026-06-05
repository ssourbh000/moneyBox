import { Injectable } from '@nestjs/common';
import { OrbSimulatorService } from '../orb-simulator/orb-simulator.service';
import { IVCrushSimulatorService } from '../iv-crush-simulator/iv-crush-simulator.service';
import { EventAlphaSimulatorService } from '../event-alpha-simulator/event-alpha-simulator.service';
import { UnifiedSimParams } from './unified-simulator.controller';

@Injectable()
export class UnifiedSimulatorService {
  constructor(
    private readonly orbSvc:       OrbSimulatorService,
    private readonly ivCrushSvc:   IVCrushSimulatorService,
    private readonly eventAlphaSvc: EventAlphaSimulatorService,
  ) {}

  async run(p: UnifiedSimParams) {
    const tasks: Promise<any>[] = [];
    const keys: string[] = [];

    if (p.strategies.a) { tasks.push(this.orbSvc.run(p.strategies.a));           keys.push('a'); }
    if (p.strategies.b) { tasks.push(this.ivCrushSvc.simulate(p.strategies.b));  keys.push('b'); }
    if (p.strategies.c) { tasks.push(this.eventAlphaSvc.simulate(p.strategies.c)); keys.push('c'); }

    const results = await Promise.all(tasks);

    const out: Record<string, any> = {};
    keys.forEach((k, idx) => { out[k] = results[idx]; });
    return out;
  }
}
