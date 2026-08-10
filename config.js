// HOPI Meeting Assistant configuration.
// Never place an OpenAI API key in this file.
// On Render, frontend and AI API run on the same origin.
// On GitHub Pages, apiUrl remains empty and the app works in demo/local fallback mode.
const isRender = window.location.hostname.endsWith('.onrender.com');
window.HOPI_CONFIG = {
  apiUrl: isRender ? window.location.origin : ''
};
