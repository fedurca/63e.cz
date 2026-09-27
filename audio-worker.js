importScripts("audio-codec.js?v=1.1.10");

let listener = AudioCodec.createListener();

onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type === "reset") {
        listener = AudioCodec.createListener();
        return;
    }
    if (msg.type === "forget") {
        listener.forget(msg.freq);
        return;
    }
    if (msg.type !== "mic" || !msg.samples) return;
    listener.push(new Float32Array(msg.samples));
    postMessage({ type: "morse", report: listener.poll() });
};
