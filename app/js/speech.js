// Japanese pronunciation using the device's built-in voice (on iPhone/iPad: Kyoko, O-ren, etc.).
import { store } from "./store.js";

function jaVoice() {
  const vs = window.speechSynthesis?.getVoices() || [];
  return vs.find((v) => /ja[-_]JP/i.test(v.lang) && /enhanced|premium|o-ren|kyoko|nanami|google/i.test(v.name))
    || vs.find((v) => /^ja/i.test(v.lang)) || null;
}

export function hasJapaneseVoice() { return Boolean(jaVoice()); }

export function say(text, rate) {
  if (!window.speechSynthesis || !text) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = jaVoice();
    if (v) u.voice = v;
    u.lang = "ja-JP";
    u.rate = rate || store.settings.voiceRate || 0.9;
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
    setTimeout(resolve, 2000 + text.length * 400);
  });
}

if (window.speechSynthesis) speechSynthesis.getVoices();
