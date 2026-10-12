import type { CommandContext, Profile, ProfilePatch } from '@fitmind/contracts';
import { ProfilePatchSchema } from '@fitmind/contracts';
import { Value } from 'typebox/value';
import type { EntityStore } from '@fitmind/contracts';
import { validateTimezone } from '../time/service.js';
import { invariant } from '../../http/errors.js';
export class ProfileService {
  constructor(private store: EntityStore) {}
  get(user: string): Profile {
    return (
      this.store.list<Profile>(user, 'profile')[0] ?? {
        id: 'profile-' + user,
        version: 0,
        name: '',
        timezone: 'Asia/Shanghai',
        reminder_time: '21:00',
        notifications_enabled: true,
      }
    );
  }
  async update(ctx: CommandContext, patch: ProfilePatch) {
    invariant(
      Value.Check(ProfilePatchSchema, patch),
      'INVALID_INPUT',
      '资料格式不正确',
    );
    if (patch.timezone !== undefined) validateTimezone(patch.timezone);
    if (patch.reminder_time)
      invariant(
        /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(patch.reminder_time),
        'INVALID_TIME',
        '提醒时间格式为 HH:mm',
      );
    return this.store.mutate(ctx, 'profile.update', patch, () => {
      const p = this.get(ctx.user_id);
      invariant(
        p.version === patch.expected_version,
        'VERSION_CONFLICT',
        '资料已更新，请刷新后重试',
        409,
      );
      const { expected_version, ...fields } = patch;
      const result = {
        ...p,
        ...fields,
        ...(fields.fitness
          ? { fitness: { ...p.fitness, ...fields.fitness } }
          : {}),
        version: p.version + 1,
      };
      if (result.onboarding_status === 'completed')
        invariant(
          result.fitness?.height_cm &&
            result.fitness.weight_kg &&
            result.fitness.goal?.trim() &&
            result.fitness.strength_training,
          'SETUP_INCOMPLETE',
          '先补充身高、体重、目标和训练意愿，再完成设置',
        );
      this.store.put(ctx.user_id, 'profile', result);
      return result;
    });
  }
}
