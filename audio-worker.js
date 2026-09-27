importScripts("audio-codec.js?v=1.1.8");

const listener = AudioCodec.createListener();

onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type === "reset") return;
    if (msg.type !== "mic" || !msg.samples) return;
    listener.push(new Float32Array(msg.samples));
    postMessage({ type: "morse", report: listener.poll() });
};
