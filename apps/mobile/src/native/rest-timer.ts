export class RestTimer {
  constructor(public end: number) {}
  remaining(now: number) {
    return Math.max(0, Math.ceil((this.end - now) / 1000));
  }
}
