import { expect, it, vi } from 'vitest';
import { LocalVision } from '../src/local/vision';
const settings = { api_key: 'synthetic-photo-key', model: 'deepseek-flash' };
const draft = {
  type: 'estimated_food',
  name: '米饭鸡肉',
  nutrition: { calories_kcal: 500, carbs_g: 60, protein_g: 35, fat_g: 12 },
  basis_quantity: null,
  basis_unit: null,
  portion_description: '一碗',
  assumptions: '米饭150g和鸡肉100g，少量用油',
  question: null,
};
function fixture(content: any = draft, reason = 'stop') {
  let request: any;
  const platform = {
    request: vi.fn((o: any) => {
      request = o;
      o.success({
        statusCode: 200,
        data: {
          choices: [
            {
              finish_reason: reason,
              message: {
                content:
                  typeof content === 'string'
                    ? content
                    : JSON.stringify(content),
              },
            },
          ],
        },
      });
      return { abort: vi.fn() };
    }),
  };
  return {
    platform,
    vision: new LocalVision(platform, () => settings),
    get request() {
      return request;
    },
  };
}
const image = 'data:image/png;base64,iVBORw0KGgo=';
it('sends only the selected image and description using the current DeepSeek Key', async () => {
  const f = fixture();
  expect(
    await f.vision.analyze(image, {
      asset_id: 'image',
      mode: 'meal',
      description: '半碗米饭',
    }),
  ).toEqual(draft);
  expect(f.request.url).toBe('https://api.deepseek.com/chat/completions');
  expect(f.request.header.Authorization).toBe('Bearer ' + settings.api_key);
  expect(JSON.stringify(f.request.data)).not.toContain(settings.api_key);
  expect(f.request.data).toMatchObject({
    model: 'deepseek-flash',
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    stream: false,
  });
  expect(f.request.data.messages[1].content[1]).toEqual({
    type: 'image_url',
    image_url: { url: image, detail: 'original' },
  });
  expect(f.request.data.messages[1].content[0].text).toContain('半碗米饭');
});
it.each(['length', 'content_filter'])(
  'rejects %s before returning any partial nutrition',
  async (reason) => {
    await expect(
      fixture(draft, reason).vision.analyze(image, {
        asset_id: 'image',
        mode: 'meal',
      }),
    ).rejects.toThrow('完整');
  },
);
it.each([
  '',
  '```json {} ```',
  { ...draft, nutrition: { ...draft.nutrition, fat_g: -1 } },
  { ...draft, nutrition: { ...draft.nutrition, fat_g: '12' } },
])(
  'rejects empty, malformed or invalid structured results %j',
  async (content) => {
    await expect(
      fixture(content).vision.analyze(image, {
        asset_id: 'image',
        mode: 'meal',
      }),
    ).rejects.toThrow();
  },
);
it('requires estimate basis and keeps label missing values unknown without assuming a portion', async () => {
  await expect(
    fixture({ ...draft, assumptions: null }).vision.analyze(image, {
      asset_id: 'i',
      mode: 'meal',
    }),
  ).rejects.toThrow('份量');
  const label = {
    ...draft,
    type: 'label_draft',
    basis_quantity: 100,
    basis_unit: 'g',
    nutrition: { calories_kcal: null, carbs_g: 30, protein_g: 4, fat_g: null },
    portion_description: null,
    assumptions: null,
  };
  expect(
    await fixture(label).vision.analyze(image, {
      asset_id: 'i',
      mode: 'label',
    }),
  ).toEqual(label);
  await expect(
    fixture(draft).vision.analyze(image, { asset_id: 'i', mode: 'label' }),
  ).rejects.toThrow('营养表');
});
it('returns an irrelevant image as needs_input and rejects all fabricated label basis units', async () => {
  const missing = {
    ...draft,
    type: 'needs_input',
    name: '',
    question: '请拍摄食物或清晰的营养表。',
    nutrition: {
      calories_kcal: null,
      carbs_g: null,
      protein_g: null,
      fat_g: null,
    },
  };
  expect(
    await fixture(missing).vision.analyze(image, {
      asset_id: 'i',
      mode: 'meal',
    }),
  ).toEqual(missing);
  await expect(
    fixture({
      ...draft,
      type: 'label_draft',
      basis_quantity: 100,
      basis_unit: 'kg',
    }).vision.analyze(image, { asset_id: 'i', mode: 'label' }),
  ).rejects.toThrow('格式');
});
it('never echoes provider errors or the key and aborts an unresponsive request', async () => {
  const bad = new LocalVision(
    {
      request: (o: any) =>
        o.success({ statusCode: 401, data: settings.api_key }),
    },
    () => settings,
  );
  await expect(
    bad.analyze(image, { asset_id: 'i', mode: 'meal' }),
  ).rejects.toThrow('密钥');
  vi.useFakeTimers();
  const abort = vi.fn();
  const v = new LocalVision({ request: () => ({ abort }) }, () => settings);
  const result = v.analyze(image, { asset_id: 'i', mode: 'meal' });
  const assertion = expect(result).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(120000);
  await assertion;
  expect(abort).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
