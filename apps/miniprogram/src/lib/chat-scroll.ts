import { client } from './page';

function current(page: any, c: any, scope: string, life: number) {
  return (
    page._chatVisible &&
    page._chatLife === life &&
    client() === c &&
    c.storageKey === scope &&
    page._chatClient === c &&
    page._chatScope === scope
  );
}

function bottomAfterPaint(page: any) {
  if (
    !page._chatReady ||
    !page._chatNeedsBottom ||
    !page._chatVisible ||
    page._chatCommittedRender !== page._chatRender
  )
    return;
  const c = page._chatClient,
    scope = page._chatScope,
    life = page._chatLife,
    render = page._chatRender,
    job = (page._chatBottomJob = (page._chatBottomJob || 0) + 1);
  wx.nextTick(() => {
    if (
      !current(page, c, scope, life) ||
      page._chatRender !== render ||
      page._chatBottomJob !== job ||
      !page._chatFollowLatest ||
      !page._chatNeedsBottom
    )
      return;
    page._chatNeedsBottom = false;
    page._chatPositioned = true;
    // The anchor is committed and the page is ready before native scrolling.
    wx.pageScrollTo({ selector: '#chat-bottom', duration: 0 });
  });
}

export function showChat(page: any) {
  page._chatVisible = true;
  page._chatLife = (page._chatLife || 0) + 1;
  page._chatFollowLatest = true;
  page._chatNeedsBottom = true;
  page._chatPositioned = false;
}

export function hideChat(page: any) {
  stopChatPending(page);
  page._chatVisible = false;
  page._chatLife = (page._chatLife || 0) + 1;
}

export function readyChat(page: any) {
  page._chatReady = true;
  bottomAfterPaint(page);
}

export function followChat(page: any) {
  page._chatMeasurement = (page._chatMeasurement || 0) + 1;
  page._chatMeasuring = null;
  page._chatFollowLatest = true;
  page._chatNeedsBottom = true;
  page._chatPositioned = false;
}

export function renderChat(page: any, c: any, data: any) {
  if (client() !== c) return;
  if (page._chatClient !== c || page._chatScope !== c.storageKey) {
    if (page._chatClient) {
      data.busy = false;
      data.error = '';
    }
    page._chatClient = c;
    page._chatScope = c.storageKey;
    page._chatLife = (page._chatLife || 0) + 1;
    page._chatTail = undefined;
    page._chatPositioned = false;
    followChat(page);
    data.expanded = {};
  }
  // Compare only the latest visible message: unchanged minute refreshes preserve
  // the reader's position; a pending message gaining a result counts as new.
  const tail = JSON.stringify(data.messages.at(-1) || null);
  if (
    tail !== page._chatTail &&
    (page._chatFollowLatest || page._chatMeasuring)
  )
    page._chatNeedsBottom = true;
  page._chatTail = tail;
  const render = (page._chatRender = (page._chatRender || 0) + 1),
    life = page._chatLife,
    scope = c.storageKey;
  page.setData(data, () => {
    if (current(page, c, scope, life) && page._chatRender === render) {
      page._chatCommittedRender = render;
      bottomAfterPaint(page);
    }
  });
}

export function scrollChat(page: any) {
  if (!page._chatVisible || !page._chatPositioned) return;
  const c = page._chatClient,
    scope = page._chatScope,
    life = page._chatLife,
    measurement = (page._chatMeasurement = (page._chatMeasurement || 0) + 1);
  // Stop following immediately while the native viewport measurement is pending.
  page._chatFollowLatest = false;
  page._chatMeasuring = measurement;
  wx.createSelectorQuery()
    .in(page)
    .select('#chat-bottom')
    .boundingClientRect()
    .exec((rects) => {
      if (
        !current(page, c, scope, life) ||
        page._chatMeasurement !== measurement
      )
        return;
      const bottom = rects[0] as { top: number } | null,
        height = wx.getWindowInfo().windowHeight;
      page._chatMeasuring = null;
      page._chatFollowLatest = !!bottom && bottom.top <= height + 80;
      if (page._chatFollowLatest) bottomAfterPaint(page);
      else page._chatNeedsBottom = false;
    });
}

export function queuedChatMessages(messages: any[], pending: any[]) {
  const known = new Set(messages.map((message) => message.message_id));
  return [
    ...messages,
    ...pending
      .filter(
        (input) => input.path === '/chat' && !known.has(input.body.message_id),
      )
      .map((input) => ({
        message_id: input.body.message_id,
        text: input.body.text,
        created_at: input.body.captured_at || input.created_at,
        status: input.error ? 'failed' : 'pending',
        result: null,
      })),
  ];
}

export function stopChatPending(page: any) {
  clearTimeout(page._chatPendingTimer);
  page._chatPendingTimer = null;
  page._chatPendingJob = (page._chatPendingJob || 0) + 1;
}

export function watchChatPending(page: any, c: any, scope: string) {
  stopChatPending(page);
  const life = page._chatLife,
    job = page._chatPendingJob;
  const project = () => {
    if (page._chatPendingJob !== job) return;
    page._chatPendingTimer = null;
    if (!current(page, c, scope, life)) return;
    if (c.pending().some((input: any) => input.path === '/chat')) {
      page.render(c);
      return;
    }
    // Reading the outbox does not refresh or mutate it. Context resolution can
    // finish later than the first tick, so wait for the real queued message ID.
    page._chatPendingTimer = setTimeout(project, 50);
  };
  page._chatPendingTimer = setTimeout(project, 0);
  return () => {
    if (page._chatPendingJob === job) stopChatPending(page);
  };
}
