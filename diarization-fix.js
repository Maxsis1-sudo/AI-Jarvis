(() => {
  const nativeFetch = window.fetch.bind(window);

  function smoothPayload(payload) {
    if (!payload || !Array.isArray(payload.segments) || !payload.segments.length) return payload;

    let segments = payload.segments.map(s => ({
      ...s,
      start: Number(s.start || 0),
      end: Number(s.end || 0),
      text: String(s.text || '').trim()
    })).filter(s => s.text);

    // Fix a very short speaker flip surrounded by the same speaker.
    // Example A -> B (0.8 s) -> A is usually more likely a diarization glitch
    // than a meaningful speaker turn in a meeting context.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < segments.length - 1; i++) {
        const prev = segments[i - 1];
        const cur = segments[i];
        const next = segments[i + 1];
        const duration = Math.max(0, cur.end - cur.start);
        const gapBefore = Math.max(0, cur.start - prev.end);
        const gapAfter = Math.max(0, next.start - cur.end);
        const veryShortText = cur.text.split(/\s+/).filter(Boolean).length <= 5;

        if (
          prev.speakerId &&
          prev.speakerId === next.speakerId &&
          cur.speakerId !== prev.speakerId &&
          (duration <= 1.6 || veryShortText) &&
          gapBefore <= 1.0 &&
          gapAfter <= 1.0
        ) {
          cur.speakerId = prev.speakerId;
        }
      }
    }

    // Merge consecutive segments assigned to the same speaker.
    const merged = [];
    for (const seg of segments) {
      const last = merged[merged.length - 1];
      if (last && last.speakerId === seg.speakerId && seg.start - last.end <= 1.0) {
        last.end = Math.max(last.end, seg.end);
        last.text = `${last.text} ${seg.text}`.replace(/\s+/g, ' ').trim();
      } else {
        merged.push({ ...seg });
      }
    }

    // Rebuild speaker cards from the cleaned segments.
    const speakerOrder = [];
    for (const seg of merged) {
      if (seg.speakerId && !speakerOrder.includes(seg.speakerId)) speakerOrder.push(seg.speakerId);
    }

    const speakers = speakerOrder.map((id, index) => {
      const owned = merged.filter(s => s.speakerId === id);
      const seconds = owned.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
      const quote = owned.find(s => (s.end - s.start) >= 2 && s.text.length >= 20)?.text || owned[0]?.text || '';
      return { id, label: `Řečník ${index + 1}`, seconds, quote };
    });

    return { ...payload, segments: merged, speakers };
  }

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!String(url).includes('/process-meeting') || !response.ok) return response;

    try {
      const payload = smoothPayload(await response.clone().json());
      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (err) {
      console.warn('Diarization smoothing skipped:', err);
      return response;
    }
  };
})();
