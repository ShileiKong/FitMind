import type { CommandContext, NutritionAnalysis } from '@fitmind/contracts';
import { NutritionAnalysisSchema } from '@fitmind/contracts';
import { Value } from 'typebox/value';
import { MediaService } from '../media/service.js';
import { invariant } from '../../http/errors.js';
export class NutritionAnalyzer {
  constructor(
    private media: MediaService,
    private provider: any,
  ) {}
  async analyze(ctx: CommandContext, request: any): Promise<NutritionAnalysis> {
    invariant(
      ['label', 'meal'].includes(request.mode),
      'INVALID_MODE',
      '请选择标签或餐食',
    );
    const data_url = this.media.imageData(ctx.user_id, request.asset_id);
    const result = await this.provider.analyze(
      { ...request, data_url },
      AbortSignal.timeout(30000),
    );
    const valid: boolean = Value.Check(NutritionAnalysisSchema, result);
    invariant(valid, 'VISION_FORMAT', '图片解析结果格式无效', 502);
    if (request.mode === 'label') result.type = 'label_draft';
    if (
      result.type === 'estimated_food' &&
      (!result.assumptions || !result.portion_description)
    ) {
      result.type = 'needs_input';
      result.question = '请补充食用份量，才能估算营养';
    }
    return result;
  }
}
