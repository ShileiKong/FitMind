import type { ApiClient } from '../api/client';
export class WorkoutController {
  constructor(private api: ApiClient) {}
  async resume(id: string) {
    return (await this.api.request('GET', '/workout-sessions/' + id)).data;
  }
}
