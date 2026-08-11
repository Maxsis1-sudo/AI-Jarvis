(() => {
  const start = document.getElementById('startBtn');
  if (!start) return;

  start.onclick = async () => {
    resetMeeting();
    const name = document.getElementById('meetingName')?.value.trim() || 'Meeting';
    document.getElementById('recordTitle').textContent = name;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Mikrofon není v tomto prohlížeči dostupný.');
      }

      // Speaker diarization benefits from preserving more voice detail than a
      // speech-only 32 kb/s recording. Keep mono, but use 64 kb/s and request
      // a normal speech sample rate where the browser supports it.
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: { ideal: 48000 }
        }
      });

      if (!window.MediaRecorder) {
        throw new Error('Nahrávání audia není v tomto prohlížeči podporované.');
      }

      const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
      const mime = types.find(t => MediaRecorder.isTypeSupported?.(t));
      const options = { audioBitsPerSecond: 64000 };
      if (mime) options.mimeType = mime;

      try {
        state.recorder = new MediaRecorder(state.stream, options);
      } catch {
        state.recorder = mime
          ? new MediaRecorder(state.stream, { mimeType: mime })
          : new MediaRecorder(state.stream);
      }

      state.recorder.ondataavailable = event => {
        if (event.data?.size) state.chunks.push(event.data);
      };
      state.recorder.onerror = () => toast('Nahrávání bylo přerušeno. Zkus meeting spustit znovu.');
      state.recorder.start(1000);

      state.recording = true;
      state.startedAt = Date.now();
      state.timerId = setInterval(() => {
        document.getElementById('timer').textContent = fmtTime(elapsed());
      }, 500);

      if (SpeechRecognition) startRecognition();
      else document.getElementById('liveTranscript').textContent = 'Živý kontrolní přepis není dostupný. Finální přepis vznikne po ukončení meetingu.';

      showView('recordView');
    } catch (error) {
      try { state.stream?.getTracks().forEach(track => track.stop()); } catch {}
      toast(error.message || 'Nepodařilo se spustit mikrofon.');
    }
  };
})();
